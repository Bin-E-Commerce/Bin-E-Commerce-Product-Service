import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProductDeletionMetadata202608240001
  implements MigrationInterface
{
  name = "AddProductDeletionMetadata202608240001";

  // Thêm metadata xóa mềm và backfill thời điểm cho các bản ghi DELETED hiện hữu.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
      ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "deleted_by" UUID NULL
    `);

    await queryRunner.query(`
      UPDATE "products"
      SET "deleted_at" = "updated_at"
      WHERE "status" = 'DELETED' AND "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_products_seller_status_deleted_at"
      ON "products" ("seller_owner_id", "status", "deleted_at")
    `);
  }

  // Rollback chỉ gỡ metadata/index được migration này tạo, không xóa product graph.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_products_seller_status_deleted_at"`,
    );
    await queryRunner.query(`
      ALTER TABLE "products"
      DROP COLUMN "deleted_by",
      DROP COLUMN "deleted_at"
    `);
  }
}
