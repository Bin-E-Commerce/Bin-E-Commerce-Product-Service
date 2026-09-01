// Migration này bổ sung purchase proof cho review customer mà không làm mất review crawl hiện có.

import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPurchaseReviewProof2026090100010 implements MigrationInterface {
  name = "AddPurchaseReviewProof2026090100010";

  // Thêm order reference nullable, vì dữ liệu import bên ngoài không có order nội bộ để đối chiếu.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product_reviews" ADD COLUMN IF NOT EXISTS "order_id" uuid`);
    await queryRunner.query(`ALTER TABLE "product_reviews" ADD COLUMN IF NOT EXISTS "order_item_id" uuid`);
    await queryRunner.query(`ALTER TABLE "product_reviews" ADD COLUMN IF NOT EXISTS "title" varchar(200)`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_product_reviews_order_item" ON "product_reviews" ("order_item_id") WHERE "order_item_id" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_product_reviews_order_user" ON "product_reviews" ("order_id", "user_id")`);
  }

  // Xóa index/cột mới mà không ảnh hưởng đến dữ liệu review legacy.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_reviews_order_user"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_product_reviews_order_item"`);
    await queryRunner.query(`ALTER TABLE "product_reviews" DROP COLUMN IF EXISTS "title"`);
    await queryRunner.query(`ALTER TABLE "product_reviews" DROP COLUMN IF EXISTS "order_item_id"`);
    await queryRunner.query(`ALTER TABLE "product_reviews" DROP COLUMN IF EXISTS "order_id"`);
  }
}
