// Kiểm tra giới hạn và delegation của catalog service mà không tạo TypeORM connection.
import { InternalSellerProductCatalogService } from '@/modules/internal/application/services/seller-product-catalog/internal-seller-product-catalog.service';
import type { InternalSellerProductCatalogRepositoryPort } from '@/modules/internal/application/ports/internal-seller-product-catalog.repository.port';

describe('InternalSellerProductCatalogService', () => {
    let mockRepository: {
        getSellerCatalog: jest.Mock;
    };
    let target: InternalSellerProductCatalogService;

    // Tạo service với repository fake để test ranh giới application và giới hạn cố định độc lập.
    beforeEach(() => {
        mockRepository = {
            getSellerCatalog: jest.fn().mockResolvedValue({
                items: [],
                totalCount: 0,
                hasMore: false,
            }),
        };
        target = new InternalSellerProductCatalogService(
            mockRepository as unknown as InternalSellerProductCatalogRepositoryPort,
        );
    });

    // Catalog luôn bị giới hạn tại application, không cho caller nội bộ yêu cầu tải toàn bộ catalog không kiểm soát.
    it('requests a shop-and-owner scoped catalog within fixed payload limits', async () => {
        // Arrange
        const shopId = 'shop-1';
        const ownerUserId = 'owner-1';

        // Act
        const result = await target.getCatalog(shopId, ownerUserId);

        // Assert
        expect(result).toEqual({
            items: [],
            totalCount: 0,
            hasMore: false,
        });
        expect(mockRepository.getSellerCatalog).toHaveBeenCalledWith(
            shopId,
            ownerUserId,
            20,
            240,
            0,
        );
        expect(mockRepository.getSellerCatalog).toHaveBeenCalledTimes(1);
    });
});
