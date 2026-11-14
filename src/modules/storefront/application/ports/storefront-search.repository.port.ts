// Port tìm kiếm storefront; application nhận ID đã xếp hạng, không phụ thuộc TypeORM hay SQL.
import type { ProductSearchSuggestion } from '@/modules/storefront/application/types/product-search-suggestion.type';
import type { StorefrontSearchRerankProduct } from '@/modules/storefront/application/types/storefront-search-rerank-product.type';

export const STOREFRONT_SEARCH_REPOSITORY = Symbol(
    'STOREFRONT_SEARCH_REPOSITORY',
);

export type StorefrontSearchSort =
    | 'relevance'
    | 'newest'
    | 'price_asc'
    | 'price_desc'
    | 'rating_desc'
    | 'sold_desc';

export interface StorefrontSearchFilters {
    query?: string;
    categoryId?: string;
    sellerShopId?: string;
    minPrice?: number;
    maxPrice?: number;
    minRating?: number;
    inStock?: boolean;
    sort?: StorefrontSearchSort;
    page: number;
    pageSize: number;
    excludeProductIds?: string[];
}

export interface StorefrontSearchPage {
    ids: string[];
    total: number;
}

export interface EligibleSemanticSearchCandidates {
    ids: string[];
    lexicalMatchCount: number;
}

export interface StorefrontSearchRepositoryPort {
    // Lọc và phân trang catalog; query tùy chọn dùng chung cho catalog mặc định và kết quả tìm kiếm.
    findStorefrontProductPage(
        filters: StorefrontSearchFilters,
    ): Promise<StorefrontSearchPage>;

    // Áp dụng hard filters và đếm semantic candidate đã có trong lexical result set để tính tổng không trùng.
    findEligibleSemanticCandidates(
        filters: StorefrontSearchFilters,
        candidateIds: string[],
    ): Promise<EligibleSemanticSearchCandidates>;

    // Hydrate một pool đã giới hạn thành dữ liệu rerank tối thiểu, đồng thời bảo vệ status public lần cuối.
    findSearchRerankingCandidates(
        candidateIds: string[],
        activeOnly: boolean,
        query: string,
    ): Promise<StorefrontSearchRerankProduct[]>;

    // Trả sáu gợi ý tối đa, không gọi đồng bộ đánh giá hay số bán qua service khác.
    getProductSearchSuggestions(
        query: string,
    ): Promise<ProductSearchSuggestion[]>;
}
