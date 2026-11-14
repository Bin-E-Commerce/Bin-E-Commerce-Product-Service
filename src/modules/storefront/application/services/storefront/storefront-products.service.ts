// Service này đọc product public theo read model storefront và chỉ trả dữ liệu ở trạng thái được phép bán.
import {
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Product } from '@/database/catalog/entities/product.entity';
import { ProductVariant } from '@/database/catalog/entities/product-variant.entity';
import { ProductStatus } from '@/database/catalog/enums/product-status.enum';
import { ProductReviewLike } from '@/database/reviews/entities/product-review-like.entity';
import type { PaginatedProductResponse } from '@/modules/shared/application/types/paginated-product-response.type';
import { ListStorefrontProductsQueryDto } from '@/modules/storefront/presentation/dto/list-storefront-products-query.dto';
import { ReviewerProfileClient } from '@/modules/reviews/application/clients/reviewer-profile.client';
import { OrderSalesClient } from '@/modules/seller-products/application/clients/order-sales.client';
import { ProductReview } from '@/database/reviews/entities/product-review.entity';
import { ProductVariantStatus } from '@/database/catalog/enums/product-variant-status.enum';
import type { StorefrontSearchFilters } from '@/modules/storefront/application/ports/storefront-search.repository.port';
import { StorefrontSearchRankingService } from '@/modules/storefront/application/services/storefront/search/storefront-search-ranking.service';
import type { ProductSearchSuggestion } from '@/modules/storefront/application/types/product-search-suggestion.type';

export interface ShopCatalogSummary {
    shopId: string;
    productCount: number;
    ratingAvg: string | null;
    reviewCount: number;
    categoryIds: string[];
}

// Read model public bổ sung cặp giá của cùng một variant để storefront hiển thị ưu đãi không bị lệch.
export type StorefrontProduct = Product & {
    displayPrice: string;
    displayOriginalPrice: string | null;
};

// Application service phục vụ storefront và shop catalog với boundary public cố định.
@Injectable()
export class StorefrontProductsService {
    constructor(
        @InjectRepository(Product)
        private readonly productRepository: Repository<Product>,
        @InjectRepository(ProductVariant)
        private readonly productVariantRepository: Repository<ProductVariant>,
        @InjectRepository(ProductReviewLike)
        private readonly reviewLikeRepository: Repository<ProductReviewLike>,
        @InjectRepository(ProductReview)
        private readonly reviewRepository: Repository<ProductReview>,
        private readonly reviewerProfileClient: ReviewerProfileClient,
        private readonly orderSalesClient: OrderSalesClient,
        private readonly storefrontSearchRankingService: StorefrontSearchRankingService,
    ) {}

    // Lấy danh sách sản phẩm theo bộ lọc và phân trang để giao diện công khai và công cụ kiểm tra import dùng chung.
    async listStorefrontProducts(
        query: ListStorefrontProductsQueryDto,
    ): Promise<PaginatedProductResponse<StorefrontProduct>> {
        const page = query.page;
        const pageSize = query.pageSize;
        const filters: StorefrontSearchFilters = {
            query: query.search,
            categoryId: query.categoryId,
            sellerShopId: query.sellerShopId,
            minPrice: query.minPrice,
            maxPrice: query.maxPrice,
            minRating: query.minRating,
            inStock: query.inStock,
            sort: query.sort as StorefrontSearchFilters['sort'],
            page,
            pageSize,
        };
        const isPublicQuery =
            !query.status || query.status === ProductStatus.ACTIVE;
        const result = await this.storefrontSearchRankingService.search(
            filters,
            isPublicQuery,
        );
        const total = result.total;
        const productIds = result.ids;

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
            where: {
                id: In(productIds),
                ...(isPublicQuery ? { status: ProductStatus.ACTIVE } : {}),
            },
            relations: {
                brand: true,
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
                (positionById.get(left.id) ?? 0) -
                (positionById.get(right.id) ?? 0),
        );
        items.forEach((product) => {
            product.images.sort(
                (left, right) => left.sortOrder - right.sortOrder,
            );
        });
        const [displayVariantByProductId] = await Promise.all([
            this.findDisplayVariants(productIds),
            this.syncApprovedReviewSummaries(items),
        ]);
        const storefrontItems = items.map((product) =>
            this.toStorefrontProduct(
                product,
                displayVariantByProductId.get(product.id),
            ),
        );
        await this.syncCompletedSales(storefrontItems);

        return {
            items: storefrontItems,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        };
    }

    // Trả tối đa sáu gợi ý gọn; endpoint này không đồng bộ review hay gọi Order Service như listing đầy đủ.
    async getProductSearchSuggestions(
        rawSearch: string,
    ): Promise<ProductSearchSuggestion[]> {
        return this.storefrontSearchRankingService.getProductSearchSuggestions(rawSearch);
    }

    // Giữ phương thức UUID cũ cho các caller hiện tại; cùng luồng xử lý bên dưới cũng nhận slug public.
    getStorefrontProductById(
        id: string,
        userId?: string,
    ): Promise<StorefrontProduct> {
        return this.getStorefrontProductByIdentifier(id, userId);
    }

    // Đọc chi tiết public bằng UUID hoặc slug, chỉ trả sản phẩm ACTIVE và giữ nguyên read model hiện có.
    // Slug là đường dẫn người dùng thấy; UUID vẫn được hỗ trợ cho các link cũ và dữ liệu giỏ hàng.
    // Nhận diện UUID trước khi tạo điều kiện truy vấn để PostgreSQL không ép slug chữ sang cột UUID.
    // Dù tìm theo cách nào, phần hydrate quan hệ, lọc review và đồng bộ lượt bán đều dùng chung một luồng.
    async getStorefrontProductByIdentifier(
        identifier: string,
        userId?: string,
    ): Promise<StorefrontProduct> {
        // Với UUID, thử cả hai khóa để không làm mất trường hợp slug hợp lệ có hình thức UUID; với slug thường chỉ truy vấn cột text.
        const where = isUUID(identifier)
            ? [
                  { id: identifier, status: ProductStatus.ACTIVE },
                  { slug: identifier, status: ProductStatus.ACTIVE },
              ]
            : { slug: identifier, status: ProductStatus.ACTIVE };
        const product = await this.productRepository.findOne({
            where,
            // Tách query cho các quan hệ 1-n để tránh tích Descartes giữa variants, options và reviews.
            // Response vẫn giữ nguyên nhưng database chỉ trả từng tập quan hệ độc lập, phù hợp với product có nhiều tập/variant.
            relationLoadStrategy: 'query',
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
                reviews: {
                    variant: true,
                },
            },
        });

        if (!product) {
            throw new NotFoundException('Không tìm thấy sản phẩm.');
        }

        // Public response chỉ chứa review approved; likeCount được tổng hợp riêng để không serialize userId của bảng like.
        // Query strategy khong ap order nested an toan tren TypeORM/PostgreSQL; sort sau khi hydrate.
        // Cach nay giu response nguyen ven ma khong tao join phinh lon voi quan he 1-n.
        this.sortProductDetailRelations(product);

        const publicReviews = product.reviews.filter(
            (review) => review.status.toLowerCase() === 'approved',
        );
        const reviewIds = publicReviews.map((review) => review.id);
        // Profile reviewer và like độc lập nhau; chạy song song để không cộng dồn latency của hai service/query phụ trợ.
        const [reviewerProfiles, likes] = await Promise.all([
            this.reviewerProfileClient.getPublicProfiles(
                publicReviews
                    .filter((review) => !review.isAnonymous)
                    .map((review) => review.userId ?? ''),
            ),
            reviewIds.length
                ? this.reviewLikeRepository.find({
                      where: { reviewId: In(reviewIds) },
                  })
                : Promise.resolve([]),
        ]);
        const likeCountByReview = new Map<string, number>();
        const likedReviewIds = new Set<string>();
        likes.forEach((like) => {
            likeCountByReview.set(
                like.reviewId,
                (likeCountByReview.get(like.reviewId) ?? 0) + 1,
            );
            if (userId && like.userId === userId)
                likedReviewIds.add(like.reviewId);
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
                : (reviewerProfiles.get(review.userId ?? '')?.name ??
                  review.reviewerName ??
                  null),
            reviewerAvatarUrl: review.isAnonymous
                ? null
                : (reviewerProfiles.get(review.userId ?? '')?.avatarUrl ??
                  review.reviewerAvatarUrl ??
                  null),
            variantName: review.variant?.name ?? null,
            likeCount: likeCountByReview.get(review.id) ?? 0,
            likedByCurrentUser: likedReviewIds.has(review.id),
        })) as unknown as Product['reviews'];

        // Tính lại summary từ review đang hiển thị để dữ liệu cũ không làm lệch điểm và số lượng trên storefront.
        product.reviewCount = product.reviews.length;
        product.ratingAvg = product.reviews.length
            ? (
                  product.reviews.reduce(
                      (total, review) => total + review.rating,
                      0,
                  ) / product.reviews.length
              ).toFixed(2)
            : null;
        const storefrontProduct = this.toStorefrontProduct(
            product,
            this.selectDisplayVariant(product.variants ?? []),
        );
        await this.syncCompletedSales([storefrontProduct]);

        return storefrontProduct;
    }

    // Tổng hợp catalog public của shop bằng các query độc lập để header hiển thị nhanh và không lộ product inactive.
    async getShopSummary(shopId: string): Promise<ShopCatalogSummary> {
        const productQuery = this.productRepository
            .createQueryBuilder('product')
            .where('product.sellerShopId = :shopId', { shopId })
            .andWhere('product.status = :activeStatus', {
                activeStatus: ProductStatus.ACTIVE,
            });

        const [productCount, categoryRows, reviewSummary] = await Promise.all([
            productQuery.clone().getCount(),
            productQuery
                .clone()
                .select('product.categoryId', 'categoryId')
                .distinct(true)
                .getRawMany<{ categoryId: string }>(),
            this.reviewRepository
                .createQueryBuilder('review')
                .innerJoin(Product, 'product', 'product.id = review.product_id')
                .select('COUNT(review.id)', 'reviewCount')
                .addSelect('AVG(review.rating)', 'ratingAvg')
                .where('product.seller_shop_id = :shopId', { shopId })
                .andWhere('product.status = :activeStatus', {
                    activeStatus: ProductStatus.ACTIVE,
                })
                .andWhere('LOWER(review.status) = :approvedStatus', {
                    approvedStatus: 'approved',
                })
                .getRawOne<{ reviewCount: string; ratingAvg: string | null }>(),
        ]);

        return {
            shopId,
            productCount,
            ratingAvg: reviewSummary?.ratingAvg
                ? Number(reviewSummary.ratingAvg).toFixed(2)
                : null,
            reviewCount: Number(reviewSummary?.reviewCount ?? 0),
            categoryIds: categoryRows.map((row) => row.categoryId),
        };
    }

    // Đồng bộ số lượng đã bán từ Order Service để storefront không lấy counter tăng ngay lúc checkout.
    // Khi Order Service tạm thời lỗi, giữ nguyên counter đã đọc từ Product DB thay vì ghi đè thành 0.
    private async syncCompletedSales(products: Product[]): Promise<void> {
        const productsByOwner = new Map<string, Product[]>();
        products.forEach((product) => {
            if (!product.sellerOwnerId) return;
            const ownerProducts =
                productsByOwner.get(product.sellerOwnerId) ?? [];
            ownerProducts.push(product);
            productsByOwner.set(product.sellerOwnerId, ownerProducts);
        });

        const ownerResults = await Promise.all(
            [...productsByOwner.entries()].map(
                async ([sellerOwnerId, ownerProducts]) => ({
                    products: ownerProducts,
                    soldQuantities:
                        await this.orderSalesClient.getSoldQuantities(
                            sellerOwnerId,
                            ownerProducts.map((product) => product.id),
                        ),
                }),
            ),
        );

        ownerResults.forEach(({ products: ownerProducts, soldQuantities }) => {
            // null nghĩa là nguồn authoritative đang tạm thời không khả dụng; không được biến lỗi tích hợp thành dữ liệu 0.
            if (soldQuantities === null) return;
            ownerProducts.forEach((product) => {
                product.totalSold = soldQuantities.get(product.id) ?? 0;
            });
        });
    }

    // Đọc các variant active của cả trang bằng một query để tránh N+1 khi mỗi card cần giá gốc riêng.
    // Kết quả chỉ lấy các cột phục vụ hiển thị; việc chọn variant rẻ nhất vẫn dùng chung một hàm với API detail.
    private async findDisplayVariants(
        productIds: string[],
    ): Promise<Map<string, ProductVariant>> {
        const variants = await this.productVariantRepository.find({
            where: {
                productId: In(productIds),
                status: ProductVariantStatus.ACTIVE,
            },
            select: {
                id: true,
                productId: true,
                price: true,
                originalPrice: true,
                status: true,
            },
            order: {
                price: 'ASC',
                id: 'ASC',
            },
        });

        const displayVariantByProductId = new Map<string, ProductVariant>();
        variants.forEach((variant) => {
            const current = displayVariantByProductId.get(variant.productId);
            if (!current || this.isCheaperVariant(variant, current)) {
                displayVariantByProductId.set(variant.productId, variant);
            }
        });

        return displayVariantByProductId;
    }

    // Đọc summary review approved theo batch để danh sách storefront không phụ thuộc các cột rating cũ trong products.
    // Khi không có review hợp lệ, reset về null/0 để card không hiển thị rating stale còn sót từ dữ liệu trước đó.
    private async syncApprovedReviewSummaries(
        products: Product[],
    ): Promise<void> {
        if (products.length === 0) return;

        const productIds = products.map((product) => product.id);
        const rows = await this.reviewRepository
            .createQueryBuilder('review')
            .select('review.productId', 'productId')
            .addSelect('COUNT(review.id)', 'reviewCount')
            .addSelect('AVG(review.rating)', 'ratingAvg')
            .where('review.productId IN (:...productIds)', { productIds })
            .andWhere('LOWER(review.status) = :status', { status: 'approved' })
            .groupBy('review.productId')
            .getRawMany<{
                productId: string;
                reviewCount: string;
                ratingAvg: string | null;
            }>();

        const summaryByProductId = new Map(
            rows.map((row) => [
                row.productId,
                {
                    reviewCount: Number(row.reviewCount),
                    ratingAvg:
                        row.ratingAvg === null
                            ? null
                            : Number(row.ratingAvg).toFixed(2),
                },
            ]),
        );

        products.forEach((product) => {
            const summary = summaryByProductId.get(product.id);
            product.reviewCount = summary?.reviewCount ?? 0;
            product.ratingAvg = summary?.ratingAvg ?? null;
        });
    }

    // Chọn variant active có giá thấp nhất và dùng ID làm tie-breaker để response luôn ổn định giữa các lần đọc.
    private selectDisplayVariant(
        variants: ProductVariant[],
    ): ProductVariant | undefined {
        return variants
            .filter((variant) => variant.status === ProductVariantStatus.ACTIVE)
            .reduce<ProductVariant | undefined>((cheapest, variant) => {
                if (!cheapest || this.isCheaperVariant(variant, cheapest))
                    return variant;
                return cheapest;
            }, undefined);
    }

    // So sánh giá numeric của PostgreSQL an toàn hơn so sánh chuỗi và xử lý deterministic khi hai giá bằng nhau.
    // Giu thu tu hien thi cua cac quan he detail sau khi TypeORM tai bang query rieng.
    // Tie-break theo ID giup SSR, cache va client nhan cung thu tu khi position trung nhau.
    private sortProductDetailRelations(product: Product): void {
        product.images = [...(product.images ?? [])].sort(
            (left, right) =>
                left.sortOrder - right.sortOrder ||
                left.id.localeCompare(right.id),
        );
        product.options = [...(product.options ?? [])].sort(
            (left, right) =>
                left.position - right.position ||
                left.id.localeCompare(right.id),
        );
        product.options.forEach((option) => {
            option.values = [...(option.values ?? [])].sort(
                (left, right) =>
                    left.position - right.position ||
                    left.id.localeCompare(right.id),
            );
        });
    }

    private isCheaperVariant(
        candidate: ProductVariant,
        current: ProductVariant,
    ): boolean {
        const candidatePrice = Number(candidate.price);
        const currentPrice = Number(current.price);
        if (!Number.isFinite(currentPrice))
            return Number.isFinite(candidatePrice);
        if (!Number.isFinite(candidatePrice)) return false;
        if (candidatePrice !== currentPrice)
            return candidatePrice < currentPrice;
        return candidate.id.localeCompare(current.id) < 0;
    }

    // Gắn read model giá vào entity mà không thêm cột database; giá gốc chỉ được giữ khi thực sự lớn hơn giá bán.
    private toStorefrontProduct(
        product: Product,
        displayVariant?: ProductVariant,
    ): StorefrontProduct {
        const displayPrice = displayVariant?.price ?? product.minPrice ?? '0';
        const originalPrice = Number(displayVariant?.originalPrice ?? 0);
        const currentPrice = Number(displayPrice);
        const displayOriginalPrice =
            Number.isFinite(currentPrice) &&
            Number.isFinite(originalPrice) &&
            originalPrice > currentPrice
                ? (displayVariant?.originalPrice ?? null)
                : null;

        return Object.assign(product, {
            displayPrice,
            displayOriginalPrice,
        });
    }
}
