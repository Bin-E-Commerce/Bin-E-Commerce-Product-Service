import { MigrationInterface, QueryRunner } from "typeorm";

//  Migration them metadata AI vao product, khong thay doi anh goc dang duoc luu.
export class AddAiOptimizationState202608250001 implements MigrationInterface {
  //  Tao cot nullable de product cu tiep tuc doc duoc truoc khi bat feature flag.
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "ai_optimization_job_id" uuid');
    await queryRunner.query('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "ai_optimization_status" varchar(32)');
    await queryRunner.query('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "ai_optimized_at" timestamptz');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_products_ai_optimization_status" ON "products" ("ai_optimization_status")');
    // Backfill asset ID tu URL CDN dang co de worker co the doc source qua Media Service.
    await queryRunner.query(`UPDATE "product_images" SET "external_image_id" = lower(substring("image_url" from '/product_image/[^/]+/([0-9a-f-]{36})/')) WHERE "external_image_id" IS NULL`);
  }

  //  Rollback chi go cot metadata, khong xoa media asset de bao toan du lieu.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_products_ai_optimization_status"');
    await queryRunner.query('ALTER TABLE "products" DROP COLUMN IF EXISTS "ai_optimized_at"');
    await queryRunner.query('ALTER TABLE "products" DROP COLUMN IF EXISTS "ai_optimization_status"');
    await queryRunner.query('ALTER TABLE "products" DROP COLUMN IF EXISTS "ai_optimization_job_id"');
  }
}
