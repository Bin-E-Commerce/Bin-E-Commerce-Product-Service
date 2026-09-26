import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { RecommendationCatalogEvent } from '@common/kafka/events/recommendation.events';

// Outbox giữ catalog event trong cùng database Product để Kafka tạm lỗi không làm mất snapshot đồng bộ sang Recommendation.
@Entity({ name: 'catalog_event_outbox' })
@Index('idx_catalog_event_outbox_pending', ['status', 'availableAt'])
export class CatalogEventOutboxEntity {
    @PrimaryColumn({ name: 'event_id', type: 'varchar', length: 255 })
    eventId!: string;

    @Column({ name: 'topic', type: 'varchar', length: 128 })
    topic!: string;

    @Column({ name: 'aggregate_id', type: 'uuid' })
    aggregateId!: string;

    @Column({ name: 'payload', type: 'jsonb' })
    payload!: RecommendationCatalogEvent;

    @Column({ name: 'status', type: 'varchar', length: 16, default: 'PENDING' })
    status!: 'PENDING' | 'PROCESSING' | 'PUBLISHED';

    @Column({ name: 'attempt_count', type: 'integer', default: 0 })
    attemptCount!: number;

    @Column({
        name: 'available_at',
        type: 'timestamptz',
        default: () => 'now()',
    })
    availableAt!: Date;

    @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
    publishedAt!: Date | null;

    @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
    createdAt!: Date;

    @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
    updatedAt!: Date;
}
