// Kiểm tra aggregate catalog/tồn được ánh xạ đúng; test không cần kết nối database thật.
import { InternalSellerDashboardProductService } from '@/modules/internal/application/services/seller-dashboard/internal-seller-dashboard-product.service';

describe('InternalSellerDashboardProductService', () => {
    let target: InternalSellerDashboardProductService;
    let mockQueryBuilder: {
        select: jest.Mock;
        addSelect: jest.Mock;
        where: jest.Mock;
        andWhere: jest.Mock;
        leftJoin: jest.Mock;
        setParameters: jest.Mock;
        getRawOne: jest.Mock;
    };
    let mockProductRepository: { createQueryBuilder: jest.Mock };

    // Mỗi test nhận query builder mới để không rò trạng thái hoặc lời gọi giữa các kịch bản.
    beforeEach(() => {
        mockQueryBuilder = {
            select: jest.fn(),
            addSelect: jest.fn(),
            where: jest.fn(),
            andWhere: jest.fn(),
            leftJoin: jest.fn(),
            setParameters: jest.fn(),
            getRawOne: jest.fn(),
        };
        Object.values(mockQueryBuilder).forEach((method) =>
            method.mockReturnValue(mockQueryBuilder),
        );
        mockProductRepository = {
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
        };
        target = new InternalSellerDashboardProductService(
            mockProductRepository as never,
        );
    });

    // Aggregate phải giữ riêng số bản ghi catalog, sản phẩm có hàng và tổng đơn vị tồn.
    it('should map product and stock aggregates without mixing sold totals', async () => {
        // Arrange
        mockQueryBuilder.getRawOne.mockResolvedValue({
            catalogProducts: '7',
            activeProducts: '5',
            inStockProducts: '3',
            stockUnits: '42',
            outOfStockProducts: '2',
        });

        // Act
        const result = await target.getSnapshot('shop-1');

        // Assert
        expect(result).toEqual({
            summary: {
                catalogProducts: 7,
                activeProducts: 5,
                inStockProducts: 3,
                stockUnits: 42,
                outOfStockProducts: 2,
            },
        });
        expect(mockProductRepository.createQueryBuilder).toHaveBeenCalledWith(
            'product',
        );
        expect(mockQueryBuilder.where).toHaveBeenCalledWith(
            'product.seller_shop_id = :shopId',
            { shopId: 'shop-1' },
        );
        expect(mockQueryBuilder.getRawOne).toHaveBeenCalledTimes(1);
    });

    // Owner scope bổ sung record legacy thiếu shopId nhưng vẫn phải khóa bằng cặp identity đã xác thực.
    it('should include legacy records owned by the authenticated seller', async () => {
        // Arrange
        mockQueryBuilder.getRawOne.mockResolvedValue(undefined);

        // Act
        await target.getSnapshot('shop-1', 'owner-1');

        // Assert
        expect(mockQueryBuilder.where).toHaveBeenCalledWith(
            '(product.seller_shop_id = :shopId OR product.seller_owner_id = :ownerUserId)',
            { shopId: 'shop-1', ownerUserId: 'owner-1' },
        );
    });

    // Shop chưa có sản phẩm phải nhận aggregate 0 thay vì NaN/undefined trong câu trả lời live.
    it('should return zero aggregates when the database has no summary row', async () => {
        // Arrange
        mockQueryBuilder.getRawOne.mockResolvedValue(undefined);

        // Act
        const result = await target.getSnapshot('shop-empty');

        // Assert
        expect(result.summary).toEqual({
            catalogProducts: 0,
            activeProducts: 0,
            inStockProducts: 0,
            stockUnits: 0,
            outOfStockProducts: 0,
        });
    });
});
