// Kiểm tra cursor snapshot ảnh giữ pagination theo product ID và giới hạn gallery ổn định trong mapper.
import type { Repository } from 'typeorm';
import { Product } from '@/database/catalog/entities/product.entity';
import { ProductStatus } from '@/database/catalog/enums/product-status.enum';
import { InternalProductImageSnapshotRepository } from '@/modules/internal/infrastructure/repositories/product-image-snapshot/internal-product-image-snapshot.repository';

describe('InternalProductImageSnapshotRepository', () => {
    let target: InternalProductImageSnapshotRepository;
    let mockProductRepository: Repository<Product>;
    let mockQueryBuilder: Record<string, jest.Mock>;

    // Dùng query builder giả để test paging/mapping mà không kết nối hoặc ghi PostgreSQL.
    beforeEach(() => {
        mockQueryBuilder = {
            addOrderBy: jest.fn(),
            andWhere: jest.fn(),
            getMany: jest.fn().mockResolvedValue([]),
            leftJoinAndSelect: jest.fn(),
            orderBy: jest.fn(),
            select: jest.fn(),
            take: jest.fn(),
            where: jest.fn(),
        };
        // Query builder TypeORM là fluent; mỗi lời gọi trả lại đúng mock đang được cấu hình.
        for (const method of [
            'andWhere',
            'leftJoinAndSelect',
            'orderBy',
            'select',
            'take',
            'where',
        ]) {
            mockQueryBuilder[method]!.mockReturnValue(mockQueryBuilder);
        }
        mockProductRepository = {
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
        } as unknown as Repository<Product>;
        target = new InternalProductImageSnapshotRepository(
            mockProductRepository,
        );
    });

    // Reset mọi lần gọi để mỗi assertion phản ánh duy nhất query được dựng trong test hiện tại.
    afterEach(() => {
        jest.clearAllMocks();
    });

    // Pagination sắp theo ID; snapshot giữ tối đa năm asset duy nhất theo sortOrder/ID để index ổn định.
    it('should page by product ID and choose the primary image deterministically', async () => {
        // Arrange
        const productId = '10000000-0000-4000-8000-000000000001';
        const cursor = '10000000-0000-4000-8000-000000000000';
        const sellerOwnerId = 'seller-owner-1';
        const product = {
            id: productId,
            status: ProductStatus.ACTIVE,
            catalogRevision: '7',
            sellerOwnerId,
            images: [
                {
                    id: '20000000-0000-4000-8000-000000000002',
                    sortOrder: 3,
                    aiAssetId: 'ai-asset-later',
                    sourceAssetId: 'source-asset-later',
                },
                {
                    id: '20000000-0000-4000-8000-000000000001',
                    sortOrder: 1,
                    aiAssetId: 'ai-asset-primary',
                    sourceAssetId: 'source-asset-primary',
                },
                {
                    id: '20000000-0000-4000-8000-000000000003',
                    sortOrder: 2,
                    aiAssetId: 'ai-asset-middle',
                    sourceAssetId: 'source-asset-middle',
                },
            ],
        } as Product;
        mockQueryBuilder.getMany!.mockResolvedValue([product]);

        // Act
        const result = await target.findPage(cursor, 25);

        // Assert
        expect(mockProductRepository.createQueryBuilder).toHaveBeenCalledWith(
            'product',
        );
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
            'product.id > :afterProductId',
            { afterProductId: cursor },
        );
        expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
            'product.id',
            'ASC',
        );
        expect(mockQueryBuilder.addOrderBy).not.toHaveBeenCalled();
        expect(mockQueryBuilder.take).toHaveBeenCalledWith(26);
        expect(result).toEqual([
            {
                productId,
                status: 'ACTIVE',
                catalogRevision: '7',
                images: [
                    {
                        ownerId: sellerOwnerId,
                        assetId: 'ai-asset-primary',
                        purpose: 'product_image',
                    },
                    {
                        ownerId: sellerOwnerId,
                        assetId: 'ai-asset-middle',
                        purpose: 'product_image',
                    },
                    {
                        ownerId: sellerOwnerId,
                        assetId: 'ai-asset-later',
                        purpose: 'product_image',
                    },
                ],
                primaryImageMedia: {
                    ownerId: sellerOwnerId,
                    assetId: 'ai-asset-primary',
                    purpose: 'product_image',
                },
            },
        ]);
    });
});
