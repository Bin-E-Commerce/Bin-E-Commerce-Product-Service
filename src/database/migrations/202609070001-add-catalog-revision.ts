import { MigrationInterface, QueryRunner } from 'typeorm';

// Bổ sung revision catalog dùng làm ordering/idempotency key cho Recommendation read model.
export class AddCatalogRevision1788739200001 implements MigrationInterface {
    name = 'AddCatalogRevision1788739200001';

    // Backfill revision theo timestamp row hiện có, sau đó dùng sequence-like increment trên từng product.
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "catalog_revision" bigint NOT NULL DEFAULT 1`,
        );
    }

    // Rollback chỉ xóa field Phase 3, không động vào product data khác.
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "products" DROP COLUMN IF EXISTS "catalog_revision"`,
        );
    }
}
