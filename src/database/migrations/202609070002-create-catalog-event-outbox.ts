import { MigrationInterface, QueryRunner } from 'typeorm';

// Tạo durable outbox cho catalog event để Product commit không phụ thuộc trạng thái tức thời của Kafka.
export class CreateCatalogEventOutbox1788739200002 implements MigrationInterface {
    name = 'CreateCatalogEventOutbox1788739200002';

    // Event được ghi cùng transaction với catalog revision, sau đó dispatcher gửi lại đến khi broker xác nhận.
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "catalog_event_outbox" (
        "event_id" varchar(255) PRIMARY KEY,
        "topic" varchar(128) NOT NULL,
        "aggregate_id" uuid NOT NULL,
        "payload" jsonb NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'PENDING',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "published_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_catalog_event_outbox_pending" ON "catalog_event_outbox" ("status", "available_at")`,
        );
    }

    // Xóa outbox khi rollback integration boundary; catalog revision vẫn thuộc migration riêng.
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "catalog_event_outbox"`);
    }
}
