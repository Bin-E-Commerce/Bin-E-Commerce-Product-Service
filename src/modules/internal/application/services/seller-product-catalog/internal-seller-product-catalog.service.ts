// Điều phối read model catalog cho Seller Copilot; không chứa truy vấn ORM hoặc quy tắc persistence.
// Giới hạn sản phẩm/biến thể cố định giúp request nội bộ không thể tải catalog không giới hạn.

import { Inject, Injectable } from '@nestjs/common';
import {
    INTERNAL_SELLER_PRODUCT_CATALOG_REPOSITORY,
    type InternalSellerProductCatalogRepositoryPort,
} from '@/modules/internal/application/ports/internal-seller-product-catalog.repository.port';
import type { InternalSellerProductCatalogSnapshot } from '@/modules/internal/application/types/internal-seller-product-catalog.type';

const SELLER_COPILOT_PRODUCT_LIMIT = 20;
const SELLER_COPILOT_VARIANT_LIMIT = 240;

// Ranh giới application giữ chính sách giới hạn; adapter persistence chỉ nhận tham số đã được chốt tại đây.
@Injectable()
export class InternalSellerProductCatalogService {
    constructor(
        @Inject(INTERNAL_SELLER_PRODUCT_CATALOG_REPOSITORY)
        private readonly repository: InternalSellerProductCatalogRepositoryPort,
    ) {}

    // Trả catalog chưa xóa của shop đã được internal guard xác thực; status cho phép phân biệt sản phẩm đang bán/ngừng bán/bản nháp.
    async getCatalog(
        shopId: string,
        ownerUserId: string,
        offset = 0,
    ): Promise<InternalSellerProductCatalogSnapshot> {
        // Offset âm hoặc vượt giới hạn an toàn không được chuyển thành query tùy ý ở persistence adapter.
        const safeOffset = Number.isSafeInteger(offset)
            ? Math.max(0, offset)
            : 0;
        return this.repository.getSellerCatalog(
            shopId,
            ownerUserId,
            SELLER_COPILOT_PRODUCT_LIMIT,
            SELLER_COPILOT_VARIANT_LIMIT,
            safeOffset,
        );
    }
}
