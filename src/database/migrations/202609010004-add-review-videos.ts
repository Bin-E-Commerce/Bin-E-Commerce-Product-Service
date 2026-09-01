// Migration nay them danh sach video CDN cho review; anh van duoc luu rieng de giu contract hien tai.
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReviewVideos2026090100040 implements MigrationInterface {
  name = "AddReviewVideos2026090100040";

  // Them cot JSONB voi gia tri rong de review cu khong can backfill.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_reviews"
      ADD COLUMN IF NOT EXISTS "videos" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  // Xoa cot video khi rollback migration.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_reviews"
      DROP COLUMN IF EXISTS "videos"
    `);
  }
}
