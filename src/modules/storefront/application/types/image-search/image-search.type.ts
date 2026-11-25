// Contract nội bộ của storefront image search; giá/tồn kho luôn được hydrate lại từ Product DB.
import type { StorefrontSort } from '@/database/catalog/enums/storefront-sort.enum';

export interface StorefrontImageSearchCandidate {
    productId: string;
    catalogRevision: string;
    imageFingerprint: string;
    rank: number;
    similarityScore?: number;
    detailScores?: [number, number];
}

export interface StorefrontImageEmbedding {
    modelVersion: string;
    dimensions: number;
    preprocessVersion: string;
    vector: number[];
    detailVectors?: [number[], number[]];
    rotationVectors?: [number[], number[]];
    strongMatchRequired?: boolean;
}

export interface StorefrontImageSearchFilters {
    search?: string;
    categoryId?: string;
    sellerShopId?: string;
    minPrice?: number;
    maxPrice?: number;
    minRating?: number;
    inStock?: boolean;
    sort?: StorefrontSort;
    page: number;
    pageSize: number;
}

export type StorefrontImageSearchMode =
    'IMAGE' | 'IMAGE_AND_TEXT' | 'TEXT_FALLBACK';

export interface StorefrontImageSearchResponse<TProduct> {
    searchId: string | null;
    mode: StorefrontImageSearchMode;
    items: TProduct[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}
