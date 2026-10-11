// Kiểm tra transaction và optimistic guard của tồn kho mà không cần PostgreSQL, Kafka hoặc Product Service thật.
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProductVariant } from '@/database/catalog/entities/product-variant.entity';
import { CatalogEventPublisherService } from '@/modules/seller-products/application/services/events/catalog-event-publisher.service';
import { InternalSellerInventoryService } from '@/modules/internal/application/services/seller-inventory/internal-seller-inventory.service';

describe('InternalSellerInventoryService', () => {
    let variantRepository: { findOne: jest.Mock; save: jest.Mock };
    let inventoryRepository: { findOne: jest.Mock; save: jest.Mock };
    let productRepository: { createQueryBuilder: jest.Mock };
    let transaction: jest.Mock;
    let catalogEvents: { publishForVariants: jest.Mock };
    let target: InternalSellerInventoryService;

    // Mô phỏng Unit of Work để các assertions xác nhận cả hai bản ghi và event outbox đi qua cùng transaction manager.
    beforeEach(() => {
        variantRepository = {
            findOne: jest.fn().mockResolvedValue({
                id: 'variant-1',
                stockQuantity: 10,
                product: { status: 'ACTIVE' },
            }),
            save: jest.fn().mockImplementation(async (value) => value),
        };
        inventoryRepository = {
            findOne: jest.fn().mockResolvedValue({
                variantId: 'variant-1',
                quantityAvailable: 8,
                quantityReserved: 2,
            }),
            save: jest.fn().mockImplementation(async (value) => value),
        };
        productRepository = { createQueryBuilder: jest.fn() };
        const manager = {
            getRepository: jest.fn((entity) =>
                entity === ProductVariant
                    ? variantRepository
                    : inventoryRepository,
            ),
        };
        transaction = jest.fn((operation) => operation(manager));
        catalogEvents = {
            publishForVariants: jest.fn().mockResolvedValue(undefined),
        };
        target = new InternalSellerInventoryService(
            productRepository as never,
            {} as never,
            {} as never,
            { transaction } as never,
            catalogEvents as unknown as CatalogEventPublisherService,
        );
    });

    // Tồn khả dụng mới được cộng với phần đang reserve để stock tổng không làm mất đơn đang xử lý.
    it('updates available and total stock in one transaction and publishes an outbox event', async () => {
        const result = await target.setAvailable({
            shopId: 'shop-1',
            ownerUserId: 'owner-1',
            variantId: 'variant-1',
            expectedAvailable: 8,
            nextAvailable: 15,
        });

        expect(transaction).toHaveBeenCalledTimes(1);
        expect(inventoryRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                quantityAvailable: 15,
                quantityReserved: 2,
            }),
        );
        expect(variantRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({ stockQuantity: 17 }),
        );
        expect(catalogEvents.publishForVariants).toHaveBeenCalledWith(
            ['variant-1'],
            expect.any(Object),
        );
        expect(result).toEqual({
            variantId: 'variant-1',
            available: 15,
            reserved: 2,
        });
    });

    // Nếu checkout hoặc thao tác khác đổi tồn sau preview thì không ghi đè và không phát event catalog.
    it('rejects a stale preview without saving inventory or publishing', async () => {
        await expect(
            target.setAvailable({
                shopId: 'shop-1',
                ownerUserId: 'owner-1',
                variantId: 'variant-1',
                expectedAvailable: 7,
                nextAvailable: 15,
            }),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(inventoryRepository.save).not.toHaveBeenCalled();
        expect(variantRepository.save).not.toHaveBeenCalled();
        expect(catalogEvents.publishForVariants).not.toHaveBeenCalled();
    });

    // Truy vấn low-stock phải dùng ngưỡng từ inventory và lấy thêm một dòng sentinel để xác định hasMore chính xác.
    it('returns low-stock rows with a bounded page and the stored threshold', async () => {
        const rows = [
            {
                productId: 'product-1',
                productName: 'Áo thun',
                variantId: 'variant-1',
                variantName: 'M',
                sku: 'SKU-1',
                sellerSku: null,
                available: '5',
                reserved: '2',
                threshold: '5',
            },
            {
                productId: 'product-2',
                productName: 'Quần dài',
                variantId: 'variant-2',
                variantName: 'L',
                sku: 'SKU-2',
                sellerSku: null,
                available: '0',
                reserved: '0',
                threshold: '5',
            },
        ];
        const query = {
            innerJoin: jest.fn().mockReturnThis(),
            leftJoin: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            addSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            addOrderBy: jest.fn().mockReturnThis(),
            offset: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            getRawMany: jest.fn().mockResolvedValue(rows),
        };
        productRepository.createQueryBuilder.mockReturnValue(query);

        const result = await target.listLowStock({
            shopId: 'shop-1',
            ownerUserId: 'owner-1',
            offset: 0,
            limit: 1,
        });

        expect(query.limit).toHaveBeenCalledWith(2);
        expect(result).toEqual({
            hasMore: true,
            items: [
                {
                    productId: 'product-1',
                    productName: 'Áo thun',
                    variantId: 'variant-1',
                    variantName: 'M',
                    sku: 'SKU-1',
                    sellerSku: null,
                    available: 5,
                    reserved: 2,
                    lowStockThreshold: 5,
                },
            ],
        });
    });

    // Truy vấn ứng viên xả hàng phải có scope owner/shop, chỉ lấy trạng thái đang bán và dùng sentinel phân trang ổn định.
    it('returns a bounded active-variant page scoped to the seller shop', async () => {
        const row = {
            productId: 'product-1',
            productName: 'Áo thun',
            variantId: 'variant-1',
            variantName: 'Đen / M',
            sku: 'SKU-1',
            sellerSku: null,
            price: '200000.00',
            available: '12',
        };
        const query = {
            innerJoin: jest.fn().mockReturnThis(),
            leftJoin: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            addSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            addOrderBy: jest.fn().mockReturnThis(),
            offset: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            getRawMany: jest.fn().mockResolvedValue([row, { ...row, variantId: 'variant-2' }]),
        };
        productRepository.createQueryBuilder.mockReturnValue(query);

        const result = await target.listActiveVariants({
            shopId: 'shop-1',
            ownerUserId: 'owner-1',
            offset: 100,
            limit: 1,
        });

        expect(query.limit).toHaveBeenCalledWith(2);
        expect(query.offset).toHaveBeenCalledWith(100);
        expect(query.orderBy).toHaveBeenCalledWith('product.id', 'ASC');
        expect(query.addOrderBy).toHaveBeenCalledWith('variant.id', 'ASC');
        expect(result).toEqual({
            hasMore: true,
            items: [
                {
                    productId: 'product-1',
                    productName: 'Áo thun',
                    variantId: 'variant-1',
                    variantName: 'Đen / M',
                    sku: 'SKU-1',
                    sellerSku: null,
                    price: 200000,
                    available: 12,
                },
            ],
        });
    });

    // Product Service là ranh giới cuối; giá dưới floor bị từ chối trước transaction và không thể bị Seller Service lách.
    it('rejects a price below the seller-provided floor before opening a transaction', async () => {
        await expect(
            target.setVariantPrice({
                shopId: 'shop-1',
                ownerUserId: 'owner-1',
                variantId: 'variant-1',
                expectedPrice: 200000,
                nextPrice: 149000,
                minimumPrice: 150000,
            }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(transaction).not.toHaveBeenCalled();
    });
});
