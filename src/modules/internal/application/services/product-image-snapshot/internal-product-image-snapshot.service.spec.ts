import type { InternalProductImageSnapshotRepositoryPort } from '@/modules/internal/application/ports/internal-product-image-snapshot.repository.port';
import { InternalProductImageSnapshotService } from '@/modules/internal/application/services/product-image-snapshot/internal-product-image-snapshot.service';
import type { InternalProductImageSnapshot } from '@/modules/internal/application/types/internal-product-image-snapshot.type';

describe('InternalProductImageSnapshotService', () => {
    let target: InternalProductImageSnapshotService;
    let mockRepository: jest.Mocked<InternalProductImageSnapshotRepositoryPort>;

    // Tạo service với repository port giả để cursor test không phụ thuộc PostgreSQL.
    // Mỗi test dùng repository mock mới để cursor và trạng thái page được kiểm tra độc lập.
    beforeEach(() => {
        mockRepository = {
            findPage: jest.fn(),
            findOne: jest.fn(),
        };
        target = new InternalProductImageSnapshotService(mockRepository);
    });

    // Snapshot giả giúp kiểm tra cursor mà không phụ thuộc database hoặc Product fixture lớn.
    function makeSnapshot(productId: string): InternalProductImageSnapshot {
        return {
            productId,
            status: 'ACTIVE',
            catalogRevision: '2',
            images: [],
            primaryImageMedia: null,
        };
    }

    // Page dùng limit+1 để nextCursor trỏ item cuối đã trả, không bỏ sót item chưa trả.
    it('should return next cursor when repository has another product', async () => {
        // Arrange
        const first = makeSnapshot('10000000-0000-4000-8000-000000000001');
        const second = makeSnapshot('10000000-0000-4000-8000-000000000002');
        mockRepository.findPage.mockResolvedValue([
            first,
            second,
            makeSnapshot('10000000-0000-4000-8000-000000000003'),
        ]);

        // Act
        const result = await target.list(first.productId, 2);

        // Assert
        expect(mockRepository.findPage).toHaveBeenCalledWith(
            first.productId,
            2,
        );
        expect(result).toEqual({
            items: [first, second],
            nextCursor: second.productId,
        });
    });

    // Service tự kẹp page size tối đa 25 để caller nội bộ không thể tạo batch không giới hạn.
    it('should clamp requested page size to the maximum', async () => {
        // Arrange
        mockRepository.findPage.mockResolvedValue([]);

        // Act
        const result = await target.list(undefined, 1000);

        // Assert
        expect(mockRepository.findPage).toHaveBeenCalledWith(undefined, 25);
        expect(result).toEqual({ items: [], nextCursor: null });
    });
});
