// Port đọc catalog nội bộ; application chỉ yêu cầu snapshot theo shop và không biết TypeORM.

import type { InternalSellerProductCatalogSnapshot } from '@/modules/internal/application/types/internal-seller-product-catalog.type';

export const INTERNAL_SELLER_PRODUCT_CATALOG_REPOSITORY = Symbol(
    'INTERNAL_SELLER_PRODUCT_CATALOG_REPOSITORY',
);

export interface InternalSellerProductCatalogRepositoryPort {
    // Repository chịu trách nhiệm scope shop, lọc sản phẩm bán được và giới hạn lượng dữ liệu tải.
    getSellerCatalog(
        shopId: string,
        ownerUserId: string,
        productLimit: number,
        variantLimit: number,
    ): Promise<InternalSellerProductCatalogSnapshot>;
}
