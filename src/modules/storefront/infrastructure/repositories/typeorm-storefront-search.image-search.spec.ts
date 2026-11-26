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
            clone: jest.fn().mockReturnThis(),
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

    // Mô tả chỉ đổi ưu tiên trong nhóm hợp lệ. Từ khóa lạ giữ nguyên thứ tự theo ảnh.
    it.each([true, false])(
        'should keep both visual matches when lexical evidence is present: %s',
        async (hasLexicalMatch) => {
            // Arrange
            const ids = [
                '10000000-0000-4000-8000-000000000001',
                '10000000-0000-4000-8000-000000000002',
                '10000000-0000-4000-8000-000000000003',
            ];
            const owner = '20000000-0000-4000-8000-000000000001';
            const asset = 'fixture-asset';
            const fingerprint = createHash('sha256')
                .update(JSON.stringify([`${owner}:${asset}`]))
                .digest('hex');
            const product = {
                sellerOwnerId: owner,
                images: [{ id: 'image', sortOrder: 0, sourceAssetId: asset }],
            };
            const mockGalleryQuery = {
                leftJoinAndSelect: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([
                    { ...product, id: ids[0] },
                    { ...product, id: ids[1] },
                    { id: ids[2], sellerOwnerId: owner, images: [] },
                ]),
            };
            const mockEligibleQuery = {
                clone: jest.fn().mockReturnValue(mockGalleryQuery),
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                setParameters: jest.fn().mockReturnThis(),
                setParameter: jest.fn().mockReturnThis(),
                getRawMany: jest
                    .fn()
                    .mockResolvedValue(hasLexicalMatch ? [{ id: ids[1] }] : []),
            };
            const mockRepository = {
                createQueryBuilder: jest
                    .fn()
                    .mockReturnValue(mockEligibleQuery),
            } as unknown as Repository<Product>;
            const target = new TypeOrmStorefrontSearchRepository(
                mockRepository,
            );

            // Act
            const ordered = await target.findImageSearchProductIds(
                {
                    page: 1,
                    pageSize: 20,
                    sort: 'relevance',
                    query: 'áo phông trắng',
                },
                ids.map((productId, index) => ({
                    productId,
                    rank: index + 1,
                    catalogRevision: '7',
                    imageFingerprint: fingerprint,
                })),
            );

            // Assert
            expect(ordered).toEqual(
                hasLexicalMatch ? [ids[1], ids[0]] : [ids[0], ids[1]],
            );
            expect(mockEligibleQuery.andWhere).toHaveBeenCalledWith(
                'product.id IN (:...currentImageProductIds)',
                { currentImageProductIds: [ids[0], ids[1]] },
            );
            expect(mockEligibleQuery.getRawMany).toHaveBeenCalledTimes(1);
        },
    );
});
