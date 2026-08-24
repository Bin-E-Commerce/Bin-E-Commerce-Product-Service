import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Brackets, In, Repository, SelectQueryBuilder } from "typeorm";
import { Product } from "../../../../../database/entities/product.entity";
import { ListSellerProductsQueryDto } from "../../dto/queries/list-seller-products-query.dto";
import { ProductOriginType } from "../../../shared/enums/product-origin-type.enum";
import { ProductStatus } from "../../../shared/enums/product-status.enum";
import { SellerProductSortBy } from "../../enums/seller-product-sort.enum";
import type {
  SellerProductListItem,
  SellerProductListResponse,
  SellerProductSummary,
} from "../../types/seller-product-list-response.type";

const SORT_COLUMN_BY_FIELD: Record<SellerProductSortBy, string> = {
  [SellerProductSortBy.UPDATED_AT]: "product.updatedAt",
  [SellerProductSortBy.CREATED_AT]: "product.createdAt",
  [SellerProductSortBy.NAME]: "product.name",
  [SellerProductSortBy.MIN_PRICE]: "product.minPrice",
  [SellerProductSortBy.TOTAL_SOLD]: "product.totalSold",
};

interface SellerProductSummaryRow {
  total: string;
  active: string;
  draft: string;
  inactive: string;
  outOfStock: string;
}

@Injectable()
export class SellerProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  // Lấy danh sách sản phẩm nội bộ thuộc đúng tài khoản seller đã được API Gateway xác thực.
  // sellerOwnerId chỉ đến từ header tin cậy, vì vậy trình duyệt không thể đổi query để đọc sản phẩm của shop khác.
  async listOwnedProducts(
    sellerOwnerId: string | undefined,
    query: ListSellerProductsQueryDto,
  ): Promise<SellerProductListResponse> {
    const ownerId = this.requireSellerOwnerId(sellerOwnerId);
    const baseQuery = this.createOwnedProductsQuery(
      ownerId,
      query.status === ProductStatus.DELETED,
    );

    this.applyFilters(baseQuery, query);

    const [summary, totalItems, idRows] = await Promise.all([
      this.getSummary(ownerId),
      baseQuery.clone().getCount(),
      baseQuery
        .clone()
        .select("product.id", "id")
        .orderBy(SORT_COLUMN_BY_FIELD[query.sortBy], query.sortOrder)
        .addOrderBy("product.id", "ASC")
        .offset((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .getRawMany<{ id: string }>(),
    ]);

    const productIds = idRows.map((row) => row.id);
    const items =
      productIds.length > 0
        ? await this.loadSellerProductItems(productIds)
        : [];

    return {
      items,
      summary,
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  // Nạp đầy đủ dữ liệu vận hành của một sản phẩm và khóa truy vấn theo owner để seller không thể đọc sản phẩm shop khác.
  async getOwnedProductById(
    sellerOwnerId: string | undefined,
    productId: string,
  ): Promise<Product> {
    const ownerId = this.requireSellerOwnerId(sellerOwnerId);
    const product = await this.productRepository.findOne({
      where: {
        id: productId,
        sellerOwnerId: ownerId,
        originType: ProductOriginType.INTERNAL,
      },
      relations: {
        brand: true,
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
        reviews: true,
      },
      order: {
        images: { sortOrder: "ASC" },
        options: { position: "ASC", values: { position: "ASC" } },
      },
    });

    if (!product || product.status === ProductStatus.DELETED) {
      // Dùng cùng phản hồi not-found cho ID không tồn tại và ID thuộc shop khác để không làm lộ ownership.
      throw new NotFoundException("Không tìm thấy sản phẩm trong shop của bạn.");
    }

    return product;
  }

  // Bắt buộc request phải có UUID người dùng đã được gateway xác thực và chuyển tiếp xuống.
  // Thiếu header này là lỗi xác thực, không dùng sellerId từ body/query làm giá trị thay thế.
  private requireSellerOwnerId(sellerOwnerId: string | undefined): string {
    if (!sellerOwnerId) {
      throw new UnauthorizedException(
        "Không xác định được tài khoản sở hữu shop.",
      );
    }

    return sellerOwnerId;
  }

  // Tạo điều kiện ownership dùng chung cho count, filter và pagination.
  // Chỉ sản phẩm INTERNAL mới thuộc Seller Center; sản phẩm crawl EXTERNAL không được trộn vào shop thật.
  private createOwnedProductsQuery(
    sellerOwnerId: string,
    includeDeleted = false,
  ): SelectQueryBuilder<Product> {
    const queryBuilder = this.productRepository
      .createQueryBuilder("product")
      .where("product.sellerOwnerId = :sellerOwnerId", { sellerOwnerId })
      .andWhere("product.originType = :originType", {
        originType: ProductOriginType.INTERNAL,
      });

    if (!includeDeleted) {
      queryBuilder.andWhere("product.status != :deletedStatus", {
        deletedStatus: ProductStatus.DELETED,
      });
    }

    return queryBuilder;
  }

  // Áp dụng bộ lọc seller trên query đã khóa ownership; query DELETED được mở riêng từ listOwnedProducts.
  private applyFilters(
    queryBuilder: SelectQueryBuilder<Product>,
    query: ListSellerProductsQueryDto,
  ): void {
    if (query.status) {
      queryBuilder.andWhere("product.status = :status", {
        status: query.status,
      });
    }

    if (!query.search) return;

    const keyword = `%${query.search}%`;
    // Tìm cả SKU bằng EXISTS để không JOIN variants trực tiếp, tránh nhân bản product và làm sai phân trang.
    queryBuilder.andWhere(
      new Brackets((builder) => {
        builder
          .where("product.name ILIKE :keyword", { keyword })
          .orWhere("product.slug ILIKE :keyword", { keyword })
          .orWhere(
            `EXISTS (
              SELECT 1
              FROM product_variants searched_variant
              WHERE searched_variant.product_id = product.id
                AND searched_variant.sku ILIKE :keyword
            )`,
            { keyword },
          );
      }),
    );
  }

  // Tổng hợp số lượng theo trạng thái trên toàn bộ shop để tab vẫn giữ số đúng khi người dùng đang tìm kiếm.
  // Truy vấn dùng FILTER của PostgreSQL để lấy toàn bộ chỉ số trong một lần đọc database.
  private async getSummary(
    sellerOwnerId: string,
  ): Promise<SellerProductSummary> {
    const activeRow = await this.createOwnedProductsQuery(sellerOwnerId)
      .select("COUNT(product.id)", "total")
      .addSelect(
        `COUNT(product.id) FILTER (WHERE product.status = :activeStatus)`,
        "active",
      )
      .addSelect(
        `COUNT(product.id) FILTER (WHERE product.status = :draftStatus)`,
        "draft",
      )
      .addSelect(
        `COUNT(product.id) FILTER (WHERE product.status = :inactiveStatus)`,
        "inactive",
      )
      .addSelect(
        `COUNT(product.id) FILTER (
          WHERE COALESCE(
            (
              SELECT SUM(summary_variant.stock_quantity)
              FROM product_variants summary_variant
              WHERE summary_variant.product_id = product.id
            ),
            0
          ) = 0
        )`,
        "outOfStock",
      )
      .setParameters({
        activeStatus: ProductStatus.ACTIVE,
        draftStatus: ProductStatus.DRAFT,
        inactiveStatus: ProductStatus.INACTIVE,
      })
      .getRawOne<SellerProductSummaryRow>();
    const deleted = await this.createOwnedProductsQuery(sellerOwnerId, true)
      .andWhere("product.status = :deletedStatus", {
        deletedStatus: ProductStatus.DELETED,
      })
      .getCount();

    return {
      total: Number(activeRow?.total ?? 0),
      active: Number(activeRow?.active ?? 0),
      draft: Number(activeRow?.draft ?? 0),
      inactive: Number(activeRow?.inactive ?? 0),
      outOfStock: Number(activeRow?.outOfStock ?? 0),
      deleted,
    };
  }

  // Nạp ảnh và variant sau khi đã phân trang trên products để một sản phẩm nhiều SKU vẫn chỉ chiếm một dòng.
  // Kết quả được sắp lại theo danh sách ID ban đầu vì điều kiện IN không bảo toàn thứ tự SQL.
  private async loadSellerProductItems(
    productIds: string[],
  ): Promise<SellerProductListItem[]> {
    const products = await this.productRepository.find({
      where: { id: In(productIds) },
      relations: {
        images: true,
        variants: true,
      },
    });
    const positionById = new Map(
      productIds.map((productId, index) => [productId, index]),
    );

    products.sort(
      (left, right) =>
        (positionById.get(left.id) ?? 0) -
        (positionById.get(right.id) ?? 0),
    );

    return products.map((product) => this.toListItem(product));
  }

  // Chuyển entity đầy đủ thành DTO gọn cho bảng seller, đồng thời tính tồn kho từ các variant hiện tại.
  private toListItem(product: Product): SellerProductListItem {
    const sortedImages = [...product.images].sort(
      (left, right) => left.sortOrder - right.sortOrder,
    );
    const thumbnail =
      sortedImages.find((image) => image.isThumbnail) ?? sortedImages[0];
    const totalStock = product.variants.reduce(
      (total, variant) => total + Math.max(variant.stockQuantity, 0),
      0,
    );

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      thumbnailUrl: thumbnail?.imageUrl ?? null,
      status: product.status,
      minPrice: product.minPrice,
      maxPrice: product.maxPrice,
      totalStock,
      variantCount: product.variants.length,
      primarySku: product.variants[0]?.sku ?? null,
      totalSold: product.totalSold,
      ratingAvg: product.ratingAvg,
      reviewCount: product.reviewCount,
      updatedAt: product.updatedAt,
      deletedAt: product.deletedAt,
    };
  }
}
