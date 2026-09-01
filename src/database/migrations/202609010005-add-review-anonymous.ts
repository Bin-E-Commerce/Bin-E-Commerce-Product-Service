import { MigrationInterface, QueryRunner } from "typeorm";

// Thêm cờ ẩn danh cho review mà không xóa snapshot tên/avatar của khách hàng.
export class AddReviewAnonymous2026090100050 implements MigrationInterface {
  name = "AddReviewAnonymous2026090100050";

  // Tạo cột mặc định false để dữ liệu review cũ vẫn hiển thị như trước.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_reviews"
      ADD COLUMN IF NOT EXISTS "is_anonymous" boolean NOT NULL DEFAULT false
    `);
  }

  // Xóa đúng cột do migration này sở hữu khi rollback.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_reviews"
      DROP COLUMN IF EXISTS "is_anonymous"
    `);
  }
}
