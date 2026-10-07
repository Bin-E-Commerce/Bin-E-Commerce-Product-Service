// Kiểm tra transaction và optimistic guard của tồn kho mà không cần PostgreSQL, Kafka hoặc Product Service thật.
import { ConflictException } from '@nestjs/common';
import { ProductVariant } from '@/database/catalog/entities/product-variant.entity';
import { CatalogEventPublisherService } from '@/modules/seller-products/application/services/events/catalog-event-publisher.service';
import { InternalSellerInventoryService } from '@/modules/internal/application/services/seller-inventory/internal-seller-inventory.service';

describe('InternalSellerInventoryService', () => {
    let variantRepository: { findOne: jest.Mock; save: jest.Mock };
    let inventoryRepository: { findOne: jest.Mock; save: jest.Mock };
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
        const manager = {
            getRepository: jest.fn((entity) =>
                entity === ProductVariant ? variantRepository : inventoryRepository,
            ),
        };
        transaction = jest.fn((operation) => operation(manager));
        catalogEvents = { publishForVariants: jest.fn().mockResolvedValue(undefined) };
        target = new InternalSellerInventoryService(
            {} as never,
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
            expect.objectContaining({ quantityAvailable: 15, quantityReserved: 2 }),
        );
        expect(variantRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({ stockQuantity: 17 }),
        );
        expect(catalogEvents.publishForVariants).toHaveBeenCalledWith(
            ['variant-1'],
            expect.any(Object),
        );
        expect(result).toEqual({ variantId: 'variant-1', available: 15, reserved: 2 });
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
});
