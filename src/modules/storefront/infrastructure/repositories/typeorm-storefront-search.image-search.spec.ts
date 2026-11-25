// Kiểm tra candidate ảnh được xác minh bằng gallery hiện tại thay vì chỉ ảnh đại diện.
import { createHash } from 'node:crypto';
import type { Repository, SelectQueryBuilder } from 'typeorm';
import { Product } from '@/database/catalog/entities/product.entity';
import { TypeOrmStorefrontSearchRepository } from '@/modules/storefront/infrastructure/repositories/typeorm-storefront-search.repository';

describe('TypeOrmStorefrontSearchRepository image candidates', () => {
    // Revision thay đổi vẫn dùng được phiên ảnh cũ; ảnh gallery đổi thì candidate cũ phải bị loại.
    it('should retain an unchanged gallery across catalog revisions and reject a changed gallery', async () => {
        const productId = '10000000-0000-4000-8000-000000000001';
        const ownerId = '20000000-0000-4000-8000-000000000002';
        const galleryAssets = ['primary-asset', 'matching-gallery-asset'];
        const fingerprint = createHash('sha256')
            .update(
                JSON.stringify(
                    galleryAssets.map((assetId) => `${ownerId}:${assetId}`),
                ),
            )
            .digest('hex');
        const primaryImage = {
            id: '30000000-0000-4000-8000-000000000001',
            sortOrder: 0,
            aiAssetId: null,
            sourceAssetId: galleryAssets[0],
        };
        const secondaryImage = {
            id: '30000000-0000-4000-8000-000000000002',
            sortOrder: 1,
            aiAssetId: galleryAssets[1],
            sourceAssetId: 'old-secondary-source',
        };
        const product = {
            id: productId,
            status: 'ACTIVE',
            catalogRevision: '7',
            sellerOwnerId: ownerId,
            images: [primaryImage, secondaryImage],
        } as Product;
        const queryBuilder = {
            leftJoinAndSelect: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockResolvedValue([product]),
        } as unknown as SelectQueryBuilder<Product>;
        const repository = {
            createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
        } as unknown as Repository<Product>;
        const target = new TypeOrmStorefrontSearchRepository(repository);
        const candidate = {
            productId,
            catalogRevision: '7',
            imageFingerprint: fingerprint,
            rank: 1,
        };

        const filters = { page: 1, pageSize: 20, sort: 'relevance' as const };
        const currentCandidateIds = await target.findImageSearchProductIds(
            filters,
            [candidate],
        );
        // Mô phỏng lần cập nhật tồn kho: revision tăng trong khi gallery và ID sản phẩm giữ nguyên.
        product.catalogRevision = '8';
        const availableAfterRevision = await target.findImageSearchProductIds(
            filters,
            [candidate],
        );
        secondaryImage.aiAssetId = 'changed-gallery-asset';
        const staleCandidateIds = await target.findImageSearchProductIds(
            filters,
            [candidate],
        );

        expect(currentCandidateIds).toEqual([productId]);
        expect(availableAfterRevision).toEqual([productId]);
        expect(staleCandidateIds).toEqual([]);
        expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
            'product.images',
            'image',
        );
    });
});
