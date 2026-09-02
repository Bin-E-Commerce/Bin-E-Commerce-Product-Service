// Service này đọc product public theo read model storefront và chỉ trả dữ liệu ở trạng thái được phép bán.
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Brackets, In, Repository } from "typeorm";
import { Product } from "../../database/catalog/entities/product.entity";
import { ProductStatus } from "../../database/catalog/enums/product-status.enum";
import { ProductReviewLike } from "../../database/reviews/entities/product-review-like.entity";
import type { PaginatedProductResponse } from "../shared/types/paginated-product-response.type";
import { ListStorefrontProductsQueryDto } from "./dto/list-storefront-products-query.dto";
import { ReviewerProfileClient } from "../reviews/integrations/reviewer-profile.client";
import { OrderSalesClient } from "../seller-products/integrations/order-sales.client";

@Injectable()
export class StorefrontProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(ProductReviewLike)
    private readonly reviewLikeRepository: Repository<ProductReviewLike>,
    private readonly reviewerProfileClient: ReviewerProfileClient,
    private readonly orderSalesClient: OrderSalesClient,
  ) {}

  // Lấy danh sách sản phẩm theo bộ lọc và phân trang để giao diện công khai và công cụ kiểm tra import dùng chung.
  async listStorefrontProducts(
    query: ListStorefrontProductsQueryDto,
  ): Promise<PaginatedProductResponse<Product>> {
    const page = query.page;
    const pageSize = query.pageSize;
    const qb = this.productRepository.createQueryBuilder("product");

    // DELETED là trạng thái nội bộ, luôn loại khỏi storefront dù client có truyền status nào trong query.
    qb.andWhere("product.status != :deletedStatus", {
      deletedStatus: ProductStatus.DELETED,
    });

    if (query.categoryId) {
      qb.andWhere("product.categoryId = :categoryId", {
        categoryId: query.categoryId,
      });
    }

    if (query.sellerShopId) {
      qb.andWhere("product.sellerShopId = :sellerShopId", {
        sellerShopId: query.sellerShopId,
      });
    }

    if (query.externalShopId) {
      qb.andWhere("product.externalShopId = :externalShopId", {
        externalShopId: query.externalShopId,
      });
    }

    if (query.originType) {
      qb.andWhere("product.originType = :originType", {
        originType: query.originType,
      });
    }

    if (query.status) {
      qb.andWhere("product.status = :status", { status: query.status });
    }

    if (query.search?.trim()) {
      const keyword = `%${query.search.trim()}%`;
      // Tìm trên tên, slug và ID nguồn để kiểm tra sản phẩm import mà không phụ thuộc một trường duy nhất.
      qb.andWhere(
        new Brackets((builder) => {
          builder
            .where("product.name ILIKE :keyword", { keyword })
            .orWhere("product.slug ILIKE :keyword", { keyword })
            .orWhere("product.externalProductId ILIKE :keyword", { keyword });
        }),
      );
    }

    // Chỉ phân trang trên bảng products vì JOIN trực tiếp với images sẽ khiến nhiều ảnh của
    // cùng một sản phẩm chiếm giới hạn trang và làm API trả thiếu sản phẩm.
    const [total, idRows] = await Promise.all([
      qb.clone().getCount(),
      qb
        .clone()
        .select("product.id", "id")
        .orderBy("product.createdAt", "DESC")
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .getRawMany<{ id: string }>(),
    ]);

    const productIds = idRows.map((row) => row.id);
    if (productIds.length === 0) {
      return {
        items: [],
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    }

    const items = await this.productRepository.find({
      where: { id: In(productIds) },
      relations: {
        brand: true,
        externalShop: true,
        images: true,
      },
    });

    // Repository.find không bảo toàn thứ tự của danh sách IN, vì vậy cần sắp xếp lại theo
    // thứ tự ID đã được phân trang và sắp xếp ảnh theo vị trí hiển thị của từng sản phẩm.
    const positionById = new Map(
      productIds.map((productId, index) => [productId, index]),
    );
    items.sort(
      (left, right) =>
        (positionById.get(left.id) ?? 0) - (positionById.get(right.id) ?? 0),
    );
    items.forEach((product) => {
      product.images.sort((left, right) => left.sortOrder - right.sortOrder);
    });
    await this.syncCompletedSales(items);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // Lấy chi tiết sản phẩm theo UUID cùng toàn bộ quan hệ cần cho màn hình chi tiết.
  async getStorefrontProductById(id: string, userId?: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: {
        brand: true,
        externalShop: true,
        images: true,
        variants: {
          inventory: true,
          optionChoices: {
            optionValue: {
              option: true,
            },
          },
        },
        options: {
          values: true,
        },
        attributeValues: true,
        reviews: {
          variant: true,
        },
      },
      order: {
        images: { sortOrder: "ASC" },
        options: { position: "ASC", values: { position: "ASC" } },
      },
    });

    if (!product || product.status === ProductStatus.DELETED) {
      throw new NotFoundException("Không tìm thấy sản phẩm.");
    }

    // Public response chỉ chứa review approved; likeCount được tổng hợp riêng để không serialize userId của bảng like.
    const publicReviews = product.reviews.filter(
      (review) => review.status.toLowerCase() === "approved",
    );
    const reviewerProfiles = await this.reviewerProfileClient.getPublicProfiles(
      publicReviews.filter((review) => !review.isAnonymous).map((review) => review.userId ?? ""),
    );
    const reviewIds = publicReviews.map((review) => review.id);
    const likes = reviewIds.length
      ? await this.reviewLikeRepository.find({ where: { reviewId: In(reviewIds) } })
      : [];
    const likeCountByReview = new Map<string, number>();
    const likedReviewIds = new Set<string>();
    likes.forEach((like) => {
      likeCountByReview.set(like.reviewId, (likeCountByReview.get(like.reviewId) ?? 0) + 1);
      if (userId && like.userId === userId) likedReviewIds.add(like.reviewId);
    });
    product.reviews = publicReviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      title: review.title,
      content: review.content,
      images: review.images ?? [],
      videos: review.videos ?? [],
      status: review.status,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      isAnonymous: review.isAnonymous ?? false,
      reviewerName: review.isAnonymous
        ? null
        : review.reviewerName ?? reviewerProfiles.get(review.userId ?? "")?.name ?? null,
      reviewerAvatarUrl: review.isAnonymous
        ? null
        : review.reviewerAvatarUrl ?? reviewerProfiles.get(review.userId ?? "")?.avatarUrl ?? null,
      variantName: review.variant?.name ?? null,
      likeCount: likeCountByReview.get(review.id) ?? 0,
      likedByCurrentUser: likedReviewIds.has(review.id),
    })) as unknown as Product["reviews"];

    // Tính lại summary từ review đang hiển thị để dữ liệu cũ không làm lệch điểm và số lượng trên storefront.
    product.reviewCount = product.reviews.length;
    product.ratingAvg = product.reviews.length
      ? (product.reviews.reduce((total, review) => total + review.rating, 0) / product.reviews.length).toFixed(2)
      : null;
    await this.syncCompletedSales([product]);

    return product;
  }

  // Đồng bộ số lượng đã bán từ Order Service để storefront không lấy counter tăng ngay lúc checkout.
  // Khi Order Service tạm thời lỗi, giữ nguyên counter đã đọc từ Product DB thay vì ghi đè thành 0.
  private async syncCompletedSales(products: Product[]): Promise<void> {
    const productsByOwner = new Map<string, Product[]>();
    products.forEach((product) => {
      if (!product.sellerOwnerId) return;
      const ownerProducts = productsByOwner.get(product.sellerOwnerId) ?? [];
      ownerProducts.push(product);
      productsByOwner.set(product.sellerOwnerId, ownerProducts);
    });

    const ownerResults = await Promise.all(
      [...productsByOwner.entries()].map(async ([sellerOwnerId, ownerProducts]) => ({
        products: ownerProducts,
        soldQuantities: await this.orderSalesClient.getSoldQuantities(
          sellerOwnerId,
          ownerProducts.map((product) => product.id),
        ),
      })),
    );

    ownerResults.forEach(({ products: ownerProducts, soldQuantities }) => {
      // null nghĩa là nguồn authoritative đang tạm thời không khả dụng; không được biến lỗi tích hợp thành dữ liệu 0.
      if (soldQuantities === null) return;
      ownerProducts.forEach((product) => {
        product.totalSold = soldQuantities.get(product.id) ?? 0;
      });
    });
  }
}
