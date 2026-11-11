// File này kiểm thử transaction reserve/release của Checkout domain bằng dependency mock, không kết nối database thật.
import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { DataSource, type EntityManager } from 'typeorm';
import { CheckoutReservation } from '@/database/checkout/entities/checkout-reservation.entity';
import { ProductVariant } from '@/database/catalog/entities/product-variant.entity';
import { CheckoutInventoryService } from '@/modules/checkout-inventory/application/services/checkout-inventory.service';

describe('CheckoutInventoryService', () => {
    let target: CheckoutInventoryService;
    let mockDataSource: DeepMocked<DataSource>;

    beforeEach(() => {
        mockDataSource = createMock<DataSource>();
        target = new CheckoutInventoryService(mockDataSource);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should return the stored response without reserving inventory for a repeated key', async () => {
        // Arrange
        const expected = {
            reservationKey: 'checkout-key-001',
            items: [],
        };
        const reservationRepository = {
            findOne: jest
                .fn()
                .mockResolvedValue({ status: 'RESERVED', response: expected }),
        };
        // Replay được trả từ repository gốc trước transaction nên mock đúng boundary để không reserve lần hai.
        mockDataSource.getRepository.mockReturnValue(
            reservationRepository as never,
        );

        // Act
        const result = await target.reserve({
            reservationKey: 'checkout-key-001',
            items: [
                {
                    productId: '22222222-2222-4222-8222-222222222222',
                    variantId: '33333333-3333-4333-8333-333333333333',
                    quantity: 1,
                },
            ],
        });

        // Assert
        expect(result).toEqual(expected);
        expect(mockDataSource.getRepository).toHaveBeenCalledWith(
            CheckoutReservation,
        );
        expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('should return success without changing inventory for a repeated release', async () => {
        // Arrange
        const reservationRepository = {
            findOne: jest.fn().mockResolvedValue({ status: 'RELEASED' }),
        };
        const manager = {
            query: jest.fn(),
            getRepository: jest.fn().mockReturnValue(reservationRepository),
        };
        // Thu hẹp overload Jest mock để callback nhận đúng EntityManager giả trong transaction.
        const transactionMock =
            mockDataSource.transaction as unknown as jest.Mock<
                Promise<unknown>,
                [(entityManager: EntityManager) => Promise<unknown>]
            >;
        transactionMock.mockImplementation(async (callback) =>
            callback(manager as unknown as EntityManager),
        );

        // Act
        const result = await target.release({
            reservationKey: 'checkout-key-001',
            items: [
                {
                    variantId: '33333333-3333-4333-8333-333333333333',
                    quantity: 1,
                },
            ],
        });

        // Assert
        expect(result).toEqual({ released: true });
        expect(manager.getRepository).toHaveBeenCalledWith(CheckoutReservation);
        expect(manager.getRepository).toHaveBeenCalledTimes(1);
    });

    // Quote phải mang brand snapshot từ Product DB để Order và Recommendation không suy diễn lại lúc phát purchase.
    it('should include the product brand in the checkout quote snapshot', async () => {
        // Arrange
        const variant = {
            id: 'variant-1',
            productId: 'product-1',
            status: 'ACTIVE',
            sku: 'SKU-1',
            name: 'Đen',
            price: '125.00',
            imageUrl: null,
            product: {
                status: 'ACTIVE',
                categoryId: 'category-1',
                brandId: 'brand-1',
                sellerShopId: 'shop-1',
                sellerOwnerId: 'seller-1',
                packageWeightGrams: 500,
                packageLengthCm: 10,
                packageWidthCm: 10,
                packageHeightCm: 10,
                images: [],
            },
        };
        const variantRepository = {
            find: jest.fn().mockResolvedValue([variant]),
        };
        const manager = {
            getRepository: jest.fn().mockReturnValue(variantRepository),
        };
        // Thu hẹp overload Jest mock để callback nhận đúng EntityManager giả trong transaction.
        const transactionMock =
            mockDataSource.transaction as unknown as jest.Mock<
                Promise<unknown>,
                [(entityManager: EntityManager) => Promise<unknown>]
            >;
        transactionMock.mockImplementation(async (callback) =>
            callback(manager as unknown as EntityManager),
        );

        // Act
        const result = await target.quote({
            reservationKey: 'quote-key-001',
            items: [
                {
                    productId: 'product-1',
                    variantId: 'variant-1',
                    quantity: 1,
                },
            ],
        });

        // Assert
        expect(result.items).toEqual([
            expect.objectContaining({
                productId: 'product-1',
                categoryId: 'category-1',
                brandId: 'brand-1',
                quantity: 1,
            }),
        ]);
        expect(manager.getRepository).toHaveBeenCalledWith(ProductVariant);
    });
});
