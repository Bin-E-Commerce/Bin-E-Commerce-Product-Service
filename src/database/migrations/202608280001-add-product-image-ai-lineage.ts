import { MigrationInterface, QueryRunner } from "typeorm";

//  Lưu quan hệ bất biến giữa ảnh gốc và output AI để sản phẩm có thể tối ưu nhiều lần.
export class AddProductImageAiLineage202608280001 implements MigrationInterface {
  //  Thêm cột lineage và backfill ảnh thường đang có mà không xóa bất kỳ media nào.
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "product_images" ADD COLUMN IF NOT EXISTS "source_asset_id" varchar(160)',
    );
    await queryRunner.query(
      'ALTER TABLE "product_images" ADD COLUMN IF NOT EXISTS "ai_asset_id" varchar(160)',
    );
    await queryRunner.query(
      `UPDATE "product_images"
       SET "source_asset_id" = "external_image_id"
       WHERE "source_asset_id" IS NULL
         AND "external_image_id" IS NOT NULL
         AND "image_url" NOT LIKE '%/media/processed/ai_optimization/%'`,
    );
    await queryRunner.query(
      `UPDATE "product_images"
       SET "ai_asset_id" = "external_image_id"
       WHERE "ai_asset_id" IS NULL
         AND "external_image_id" IS NOT NULL
         AND "image_url" LIKE '%/media/processed/ai_optimization/%'`,
    );
  }

  //  Xóa metadata lineage nhưng giữ nguyên URL và media asset để migration rollback an toàn.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "product_images" DROP COLUMN IF EXISTS "ai_asset_id"',
    );
    await queryRunner.query(
      'ALTER TABLE "product_images" DROP COLUMN IF EXISTS "source_asset_id"',
    );
  }
}
