// Service này đọc product public theo read model storefront và chỉ trả dữ liệu ở trạng thái được phép bán.
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PaginatedProductResponse } from '@/modules/shared/application/types/paginated-product-response.type';
import { ReviewerProfileClient } from '@/modules/reviews/application/clients/reviewer-profile.client';
import { OrderSalesClient } from '@/modules/seller-products/application/clients/order-sales.client';
import type { StorefrontSearchFilters } from '@/modules/storefront/application/ports/storefront-search.repository.port';
import {
    STOREFRONT_PRODUCT_REPOSITORY,
    type StorefrontProductRepositoryPort,
} from '@/modules/storefront/application/ports/products/storefront-product.repository.port';
import { StorefrontSearchRankingService } from '@/modules/storefront/application/services/storefront/search/storefront-search-ranking.service';
import type { ProductSearchSuggestion } from '@/modules/storefront/application/types/text-search/product-search-suggestion.type';
import type {
    ShopCatalogSummary,
    StorefrontDisplayVariant,
    StorefrontProduct,
    StorefrontProductListQuery,
    StorefrontProductRecord,
} from '@/modules/storefront/application/types/products/storefront-product.type';

// Application service phục vụ storefront và shop catalog với boundary public cố định.
@Injectable()
export class StorefrontProductsService {
    // Điều phối catalog, hồ sơ người đánh giá và số bán thông qua các cổng ứng dụng.
    constructor(
        @Inject(STOREFRONT_PRODUCT_REPOSITORY)
        private readonly products: StorefrontProductRepositoryPort,
        private readonly reviewerProfileClient: ReviewerProfileClient,
        private readonly orderSalesClient: OrderSalesClient,
        private readonly storefrontSearchRankingService: StorefrontSearchRankingService,
    ) {}

    // Lấy danh sách sản phẩm theo bộ lọc và phân trang để giao diện công khai và công cụ kiểm tra import dùng chung.
    async listStorefrontProducts(
        query: StorefrontProductListQuery,
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
            sort: query.sort,
            page,
            pageSize,
        };
        const isPublicQuery = !query.status || query.status === 'ACTIVE';
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

        const storefrontItems = await this.getStorefrontProductsByIds(
            productIds,
            isPublicQuery,
        );

        return {
            items: storefrontItems,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        };
    }

    // Hydrate card theo ID đã xếp hạng để image search dùng cùng giá, review và sales read model với listing hiện có.
    async getStorefrontProductsByIds(
        productIds: string[],
        activeOnly = true,
    ): Promise<StorefrontProduct[]> {
        const uniqueIds = Array.from(new Set(productIds));
        if (uniqueIds.length === 0) return [];
        const items = await this.products.findProductsByIds(
            uniqueIds,
            activeOnly,
        );

        // Catalog có thể trả ID theo thứ tự khác; giữ thứ hạng tìm kiếm và thứ tự ảnh gallery.
        const positionById = new Map(
            uniqueIds.map((productId, index) => [productId, index]),
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
            this.findDisplayVariants(uniqueIds),
            this.syncApprovedReviewSummaries(items),
        ]);
        const storefrontItems = items.map((product) =>
            this.toStorefrontProduct(
                product,
                displayVariantByProductId.get(product.id),
            ),
        );
        await this.syncCompletedSales(storefrontItems);
        return storefrontItems;
    }

    // Trả tối đa sáu gợi ý gọn; endpoint này không đồng bộ review hay gọi Order Service như listing đầy đủ.
    async getProductSearchSuggestions(
        rawSearch: string,
    ): Promise<ProductSearchSuggestion[]> {
        return this.storefrontSearchRankingService.getProductSearchSuggestions(
            rawSearch,
        );
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
        const detail = await this.products.findActiveProduct(identifier);

        if (!detail) {
            throw new NotFoundException('Không tìm thấy sản phẩm.');
        }

        // Tách review thô trước khi dựng card để dữ liệu nội bộ không đi vào response.
        const { reviews: storedReviews, ...product } = detail;
        // Giữ thứ tự gallery và phân loại sau khi adapter đã hydrate quan hệ.
        this.sortProductDetailRelations(product);

        const publicReviews = storedReviews.filter(
            (review) => review.status.toLowerCase() === 'approved',
        );
        const reviewIds = publicReviews.map((review) => review.id);
        // Profile reviewer và like độc lập nhau; chạy song song để không cộng dồn latency của hai service/query phụ trợ.
        const [reviewerProfiles, likeSummaries] = await Promise.all([
            this.reviewerProfileClient.getPublicProfiles(
                publicReviews
                    .filter((review) => !review.isAnonymous)
                    .map((review) => review.userId ?? ''),
            ),
            this.products.findReviewLikeSummaries(reviewIds, userId),
        ]);
        const reviews = publicReviews.map((review) => ({
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
            likeCount: likeSummaries.get(review.id)?.likeCount ?? 0,
            likedByCurrentUser:
                likeSummaries.get(review.id)?.likedByCurrentUser ?? false,
        }));

        // Tính lại summary từ review đang hiển thị để dữ liệu cũ không làm lệch điểm và số lượng trên storefront.
        product.reviewCount = reviews.length;
        product.ratingAvg = reviews.length
            ? (
                  reviews.reduce((total, review) => total + review.rating, 0) /
                  reviews.length
              ).toFixed(2)
            : null;
        const storefrontProduct = this.toStorefrontProduct(
            product,
            this.selectDisplayVariant(product.variants ?? []),
        );
        await this.syncCompletedSales([storefrontProduct]);

        return { ...storefrontProduct, reviews };
    }

    // Lấy số liệu công khai cho header shop từ cùng nguồn catalog với trang chi tiết.
    getShopSummary(shopId: string): Promise<ShopCatalogSummary> {
        return this.products.getShopSummary(shopId);
    }

    // Đồng bộ số lượng đã bán từ Order Service để storefront không lấy counter tăng ngay lúc checkout.
    // Khi Order Service tạm thời lỗi, giữ nguyên counter đã đọc từ Product DB thay vì ghi đè thành 0.
    private async syncCompletedSales(
        products: StorefrontProductRecord[],
    ): Promise<void> {
        const productsByOwner = new Map<string, StorefrontProductRecord[]>();
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
    ): Promise<Map<string, StorefrontDisplayVariant>> {
        const variants =
            await this.products.findActiveDisplayVariants(productIds);
        const displayVariantByProductId = new Map<
            string,
            StorefrontDisplayVariant
        >();
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
        products: StorefrontProductRecord[],
    ): Promise<void> {
        if (products.length === 0) return;

        const productIds = products.map((product) => product.id);
        const summaryByProductId =
            await this.products.findApprovedReviewSummaries(productIds);

        products.forEach((product) => {
            const summary = summaryByProductId.get(product.id);
            product.reviewCount = summary?.reviewCount ?? 0;
            product.ratingAvg = summary?.ratingAvg ?? null;
        });
    }

    // Chọn variant active có giá thấp nhất và dùng ID làm tie-breaker để response luôn ổn định giữa các lần đọc.
    private selectDisplayVariant(
        variants: StorefrontDisplayVariant[],
    ): StorefrontDisplayVariant | undefined {
        return variants
            .filter((variant) => variant.status === 'ACTIVE')
            .reduce<StorefrontDisplayVariant | undefined>(
                (cheapest, variant) => {
                    if (!cheapest || this.isCheaperVariant(variant, cheapest))
                        return variant;
                    return cheapest;
                },
                undefined,
            );
    }

    // Chuẩn hóa thứ tự ảnh và phân loại khi các quan hệ trả về có cùng vị trí.
    private sortProductDetailRelations(product: StorefrontProductRecord): void {
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

    // So sánh giá số và dùng ID làm tie-breaker để giá hiển thị ổn định.
    private isCheaperVariant(
        candidate: StorefrontDisplayVariant,
        current: StorefrontDisplayVariant,
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

    // Bổ sung cặp giá cho response; chỉ giữ giá gốc khi thực sự lớn hơn giá bán.
    private toStorefrontProduct(
        product: StorefrontProductRecord,
        displayVariant?: StorefrontDisplayVariant,
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

        return {
            ...product,
            displayPrice,
            displayOriginalPrice,
        };
    }
}
