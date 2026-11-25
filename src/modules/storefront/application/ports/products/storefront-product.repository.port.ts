// Port đọc card, detail và summary từ catalog nội bộ; application điều phối qua read model.
import type {
    ShopCatalogSummary,
    StorefrontDisplayVariant,
    StorefrontProductDetailRecord,
    StorefrontProductRecord,
    StorefrontReviewLikeSummary,
    StorefrontReviewSummary,
} from '@/modules/storefront/application/types/products/storefront-product.type';

export const STOREFRONT_PRODUCT_REPOSITORY = Symbol(
    'STOREFRONT_PRODUCT_REPOSITORY',
);

export interface StorefrontProductRepositoryPort {
    findProductsByIds(
        productIds: string[],
        activeOnly: boolean,
    ): Promise<StorefrontProductRecord[]>;
    findActiveProduct(
        identifier: string,
    ): Promise<StorefrontProductDetailRecord | null>;
    findActiveDisplayVariants(
        productIds: string[],
    ): Promise<StorefrontDisplayVariant[]>;
    findApprovedReviewSummaries(
        productIds: string[],
    ): Promise<Map<string, StorefrontReviewSummary>>;
    findReviewLikeSummaries(
        reviewIds: string[],
        userId?: string,
    ): Promise<Map<string, StorefrontReviewLikeSummary>>;
    getShopSummary(shopId: string): Promise<ShopCatalogSummary>;
}
