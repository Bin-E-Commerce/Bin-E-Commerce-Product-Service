// Kiểm tra ảnh snapshot Product được giới hạn và loại asset lặp trước khi tạo vector gallery.
import type { Repository, SelectQueryBuilder } from 'typeorm';
import { Product } from '@/database/catalog/entities/product.entity';
import { InternalProductImageSnapshotRepository } from '@/modules/internal/infrastructure/repositories/product-image-snapshot/internal-product-image-snapshot.repository';

describe('InternalProductImageSnapshotRepository gallery mapping', () => {
    // Query builder giả chỉ đọc một Product; test không kết nối hoặc ghi PostgreSQL.
    it('should return at most five unique assets in stable gallery order', async () => {
        const ownerId = '20000000-0000-4000-8000-000000000002';
        const images = Array.from({ length: 7 }, (_, index) => ({
            id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
            sortOrder: index,
            aiAssetId: index === 4 ? 'asset-3' : `asset-${index + 1}`,
            sourceAssetId: `source-${index + 1}`,
        }));
        const product = {
            id: '10000000-0000-4000-8000-000000000001',
            status: 'ACTIVE',
            catalogRevision: '8',
            sellerOwnerId: ownerId,
            images,
        } as Product;
        const queryBuilder = {
            select: jest.fn().mockReturnThis(),
            leftJoinAndSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockResolvedValue(product),
        } as unknown as SelectQueryBuilder<Product>;
        const repository = {
            createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
        } as unknown as Repository<Product>;
        const target = new InternalProductImageSnapshotRepository(repository);

        const snapshot = await target.findOne(product.id);

        expect(snapshot?.images.map(({ assetId }) => assetId)).toEqual([
            'asset-1',
            'asset-2',
            'asset-3',
            'asset-4',
            'asset-6',
        ]);
        expect(snapshot?.primaryImageMedia?.assetId).toBe('asset-1');
    });
});
