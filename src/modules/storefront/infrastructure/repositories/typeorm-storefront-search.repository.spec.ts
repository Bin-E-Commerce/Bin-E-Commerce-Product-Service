// Kiểm tra SQL search repository tạo điều kiện token và giữ các tầng relevance có thứ tự.
import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import {
    Brackets,
    type Repository,
    type SelectQueryBuilder,
    type WhereExpressionBuilder,
} from 'typeorm';
import { Product } from '@/database/catalog/entities/product.entity';
import { ProductVariantStatus } from '@/database/catalog/enums/product-variant-status.enum';
import { TypeOrmStorefrontSearchRepository } from '@/modules/storefront/infrastructure/repositories/typeorm-storefront-search.repository';

describe('TypeOrmStorefrontSearchRepository', () => {
    let target: TypeOrmStorefrontSearchRepository;
    let mockProductRepository: DeepMocked<Repository<Product>>;
    let mockQueryBuilder: DeepMocked<SelectQueryBuilder<Product>>;

    // Dùng một query builder giả để kiểm tra SQL được dựng mà không cần gọi PostgreSQL hoặc pg_trgm.
    beforeEach(() => {
        mockProductRepository = createMock<Repository<Product>>();
        mockQueryBuilder = createMock<SelectQueryBuilder<Product>>();
        mockQueryBuilder.where.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.andWhere.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.select.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.addSelect.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.orderBy.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.addOrderBy.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.offset.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.limit.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.clone.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.getCount.mockResolvedValue(1);
        mockQueryBuilder.getRawMany.mockResolvedValue([{ id: 'product-1' }]);
        mockProductRepository.createQueryBuilder.mockReturnValue(
            mockQueryBuilder,
        );
        target = new TypeOrmStorefrontSearchRepository(mockProductRepository);
    });

    // Tất cả token phải có mặt trong cùng candidate; query đảo thứ tự vẫn được nhận và xếp dưới match cụm/title.
    it('should build bounded all-token matching and its relevance tiers', async () => {
        // Arrange
        const filters = {
            query: 'điện thoại pin lâu',
            page: 1,
            pageSize: 24,
        };

        // Act
        const result = await target.findStorefrontProductPage(filters);

        // Assert
        expect(result).toEqual({ ids: ['product-1'], total: 1 });
        const tokenBrackets = mockQueryBuilder.andWhere.mock.calls
            .map(([condition]) => condition)
            .find((condition) => condition instanceof Brackets);
        expect(tokenBrackets).toBeInstanceOf(Brackets);

        const mockWhereExpression = createMock<WhereExpressionBuilder>();
        (tokenBrackets as Brackets).whereFactory(mockWhereExpression);
        expect(mockWhereExpression.orWhere).toHaveBeenCalledWith(
            expect.stringContaining('searchTokenRaw0'),
        );
        expect(mockQueryBuilder.setParameters).toHaveBeenCalledWith(
            expect.objectContaining({
                searchTokenRaw0: '%điện%',
                searchTokenNormalized0: '%dien%',
                searchTokenRaw3: '%lâu%',
                searchTokenNormalized3: '%lau%',
            }),
        );

        const rankingExpression = mockQueryBuilder.addSelect.mock.calls
            .map(([selection]) =>
                Array.isArray(selection) ? selection.join('\n') : selection,
            )
            .find((selection) =>
                selection.includes('WHEN LOWER(product.name)'),
            );
        expect(rankingExpression).toContain('THEN 740');
        expect(rankingExpression).toContain('THEN 560');
    });

    // Filter storefront chỉ coi quantity_available trên variant ACTIVE là lượng có thể bán.
    it('should filter in-stock products by available inventory', async () => {
        await target.findStorefrontProductPage({
            page: 1,
            pageSize: 20,
            inStock: true,
        });

        const inventoryFilter = mockQueryBuilder.andWhere.mock.calls
            .map(([condition]) => condition)
            .find(
                (condition) =>
                    typeof condition === 'string' &&
                    condition.includes('stock_inventory.quantity_available'),
            );

        expect(inventoryFilter).toContain(
            'stock_inventory.quantity_available > 0',
        );
        expect(inventoryFilter).not.toContain('stock_quantity');
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
            expect.stringContaining(
                'stock_variant.status = :activeVariantStatus',
            ),
            { activeVariantStatus: ProductVariantStatus.ACTIVE },
        );
    });
});
