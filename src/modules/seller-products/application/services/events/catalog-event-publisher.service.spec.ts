import type { Repository } from 'typeorm';
import type { RecommendationCatalogEvent } from '@common/kafka/events/recommendation.events';
import { Product } from '@/database/catalog/entities/product.entity';
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
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ event_id: event.eventId }]);
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
        expect(mockPublish).toHaveBeenCalledTimes(1);
        expect(mockQuery).toHaveBeenCalledTimes(2);

        resolvePublish(true);
        await publishedUpdate;
        expect(mockUpdate).toHaveBeenCalledWith(
            { eventId: event.eventId },
            expect.objectContaining({ status: 'PUBLISHED' }),
        );
    });
});
