import { In, type Repository } from 'typeorm';
import type { RecommendationCatalogEvent } from '@common/kafka/events/recommendation.events';
import { Product } from '@/database/catalog/entities/product.entity';
import { ProductStatus } from '@/database/catalog/enums/product-status.enum';
import { ProductVariant } from '@/database/catalog/entities/product-variant.entity';
import { CatalogEventOutboxEntity } from '@/database/integration/entities/catalog-event-outbox.entity';
import { KafkaProducerService } from '@/kafka/kafka-producer.service';
import { CatalogEventPublisherService } from '@/modules/seller-products/application/services/events/catalog-event-publisher.service';

describe('CatalogEventPublisherService', () => {
    let target: CatalogEventPublisherService;
    let mockQuery: jest.Mock;
    let mockFind: jest.Mock;
    let mockUpdate: jest.Mock;
    let mockPublish: jest.Mock;

    // Tạo mock mới mỗi lần để một lần dispatch không làm nhiễm trạng thái test kế tiếp.
    beforeEach(() => {
        mockQuery = jest.fn();
        mockFind = jest.fn();
        mockUpdate = jest.fn();
        mockPublish = jest.fn();

        const mockProductRepository = {} as unknown as Repository<Product>;
        const mockVariantRepository =
            {} as unknown as Repository<ProductVariant>;
        const mockOutboxRepository = {
            query: mockQuery,
            find: mockFind,
            update: mockUpdate,
        } as unknown as Repository<CatalogEventOutboxEntity>;
        const mockKafkaProducer = {
            publish: mockPublish,
        } as unknown as KafkaProducerService;

        target = new CatalogEventPublisherService(
            mockProductRepository,
            mockVariantRepository,
            mockOutboxRepository,
            mockKafkaProducer,
        );
    });

    // Dừng interval giả và khôi phục timer thật để test không giữ process sống.
    afterEach(() => {
        target.onModuleDestroy();
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    // Ảnh đại diện event phải trỏ cùng ảnh render và ưu tiên asset AI đang hiển thị.
    it('should publish structured media reference for the displayed primary image', () => {
        // Arrange
        const product = {
            id: '10000000-0000-4000-8000-000000000001',
            sellerOwnerId: '20000000-0000-4000-8000-000000000002',
            catalogRevision: '4',
            status: ProductStatus.ACTIVE,
            name: 'Áo khoác',
            slug: 'ao-khoac',
            categoryId: '30000000-0000-4000-8000-000000000003',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
            images: [
                {
                    sortOrder: 0,
                    imageUrl: 'https://cdn.example.test/primary.webp',
                    aiAssetId: '40000000-0000-4000-8000-000000000004',
                    sourceAssetId: '50000000-0000-4000-8000-000000000005',
                },
            ],
            variants: [],
        } as unknown as Product;

        // Act
        const event = (
            target as unknown as {
                toEvent: (
                    value: Product,
                    eventName: 'product.catalog.upserted',
                ) => RecommendationCatalogEvent;
            }
        ).toEvent(product, 'product.catalog.upserted');

        // Assert
        expect(event.data.imageUrl).toBe(
            'https://cdn.example.test/primary.webp',
        );
        expect(event.data.primaryImageMedia).toEqual({
            ownerId: product.sellerOwnerId,
            assetId: '40000000-0000-4000-8000-000000000004',
            purpose: 'product_image',
        });
    });

    // Ảnh legacy thiếu owner hoặc asset không được suy luận Media reference từ URL public.
    it('should omit media reference when product image has no managed asset owner', () => {
        // Arrange
        const product = {
            id: '10000000-0000-4000-8000-000000000001',
            sellerOwnerId: null,
            catalogRevision: '4',
            status: ProductStatus.ACTIVE,
            name: 'Legacy product',
            slug: 'legacy-product',
            categoryId: '30000000-0000-4000-8000-000000000003',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
            images: [
                {
                    sortOrder: 0,
                    imageUrl: 'https://external.example.test/image.jpg',
                },
            ],
            variants: [],
        } as unknown as Product;

        // Act
        const event = (
            target as unknown as {
                toEvent: (
                    value: Product,
                    eventName: 'product.catalog.upserted',
                ) => RecommendationCatalogEvent;
            }
        ).toEvent(product, 'product.catalog.upserted');

        // Assert
        expect(event.data.primaryImageMedia).toBeNull();
    });

    // Đảm bảo poll 5 giây kế tiếp không claim thêm hàng khi Kafka còn xử lý lô hiện tại.
    it('should keep only one outbox batch in flight while Kafka publish is pending', async () => {
        // Arrange
        jest.useFakeTimers();
        const event = {
            eventId: 'product-1:2:product.catalog.upserted',
            eventName: 'product.catalog.upserted',
            aggregateId: 'product-1',
        } as RecommendationCatalogEvent;
        let resolvePublish!: (published: boolean) => void;
        let resolvePublishedUpdate!: () => void;
        let resolvePublishStarted!: () => void;
        const pendingPublish = new Promise<boolean>((resolve) => {
            resolvePublish = resolve;
        });
        const publishedUpdate = new Promise<void>((resolve) => {
            resolvePublishedUpdate = resolve;
        });
        const publishStarted = new Promise<void>((resolve) => {
            resolvePublishStarted = resolve;
        });

        mockQuery
            .mockResolvedValueOnce([[], 0])
            .mockResolvedValueOnce([[{ event_id: event.eventId }], 1]);
        mockFind.mockResolvedValue([{ payload: event }]);
        mockUpdate.mockImplementation(async () => {
            resolvePublishedUpdate();
            return { affected: 1 };
        });
        mockPublish.mockImplementation(() => {
            resolvePublishStarted();
            return pendingPublish;
        });

        // Act
        target.onModuleInit();
        await publishStarted;
        await jest.advanceTimersByTimeAsync(5_000);

        // Assert
        expect(mockFind).toHaveBeenCalledWith({
            where: { eventId: In([event.eventId]) },
            order: { createdAt: 'ASC' },
        });
        expect(mockPublish.mock.calls).toEqual([
            [event.eventName, event, event.aggregateId],
        ]);
        expect(mockQuery).toHaveBeenCalledTimes(2);

        resolvePublish(true);
        await publishedUpdate;
        expect(mockUpdate).toHaveBeenCalledWith(
            { eventId: event.eventId },
            expect.objectContaining({ status: 'PUBLISHED' }),
        );
    });

    // Lượt poll không nhận được event chỉ dừng tại kết quả [[], 0] của PostgreSQL.
    it('should skip lookup and publish when the PostgreSQL claim is empty', async () => {
        // Arrange
        jest.useFakeTimers();
        mockQuery.mockResolvedValue([[], 0]);

        // Act
        target.onModuleInit();
        await jest.advanceTimersByTimeAsync(0);

        // Assert
        expect(mockQuery).toHaveBeenCalledTimes(2);
        expect(mockFind).not.toHaveBeenCalled();
        expect(mockPublish).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
    });
});
