// Read models công khai cho listing và chi tiết, độc lập với entity lưu trữ.
import type { StorefrontSearchFilters } from '@/modules/storefront/application/ports/storefront-search.repository.port';

export type StorefrontProductListQuery = Omit<
    StorefrontSearchFilters,
    'query'
> & {
    search?: string;
    status?: string;
};

export interface ShopCatalogSummary {
    shopId: string;
    productCount: number;
    ratingAvg: string | null;
    reviewCount: number;
    categoryIds: string[];
}

export interface StorefrontDisplayVariant {
    id: string;
    productId: string;
    status: string;
    price: string;
    originalPrice: string | null;
}

interface StorefrontImage {
    id: string;
    sortOrder: number;
}

interface StorefrontOptionValue {
    id: string;
    position: number;
}

interface StorefrontOption extends StorefrontOptionValue {
    values: StorefrontOptionValue[];
}

export interface StorefrontProductRecord {
    id: string;
    sellerOwnerId: string | null;
    minPrice: string;
    totalSold: number;
    reviewCount: number;
    ratingAvg: string | null;
    images: StorefrontImage[];
    options?: StorefrontOption[];
    variants?: StorefrontDisplayVariant[];
}

interface StorefrontReviewContent {
    id: string;
    rating: number;
    title: string | null;
    content: string | null;
    images: string[];
    videos: string[];
    status: string;
    createdAt: Date;
    updatedAt: Date;
    isAnonymous: boolean;
    reviewerName: string | null;
    reviewerAvatarUrl: string | null;
}

interface StorefrontReviewRecord extends StorefrontReviewContent {
    userId: string | null;
    variant: { name: string } | null;
}

export interface StorefrontProductDetailRecord extends StorefrontProductRecord {
    reviews: StorefrontReviewRecord[];
}

interface StorefrontPublicReview extends StorefrontReviewContent {
    variantName: string | null;
    likeCount: number;
    likedByCurrentUser: boolean;
}

export interface StorefrontProduct extends StorefrontProductRecord {
    displayPrice: string;
    displayOriginalPrice: string | null;
    reviews?: StorefrontPublicReview[];
}

export interface StorefrontReviewSummary {
    reviewCount: number;
    ratingAvg: string | null;
}

export interface StorefrontReviewLikeSummary {
    likeCount: number;
    likedByCurrentUser: boolean;
}
