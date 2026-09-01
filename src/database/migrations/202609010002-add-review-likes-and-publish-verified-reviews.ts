// Migration này xuất bản review customer đã xác minh và tạo bảng lượt thích theo unique review/user.
// Review crawl không có order_item_id được giữ nguyên để bảo toàn dữ liệu legacy.
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReviewLikesAndPublishVerifiedReviews2026090100020
  implements MigrationInterface
{
  name = "AddReviewLikesAndPublishVerifiedReviews2026090100020";

  // Backfill review customer cũ rồi tạo bảng like có foreign key cascade theo review.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "product_reviews"
      SET "status" = 'approved'
      WHERE "order_item_id" IS NOT NULL AND "status" = 'pending'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_review_likes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "review_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_review_likes_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_product_review_likes_review" FOREIGN KEY ("review_id")
          REFERENCES "product_reviews" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_product_review_likes_review_user"
      ON "product_review_likes" ("review_id", "user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_product_review_likes_review"
      ON "product_review_likes" ("review_id")
    `);
  }

  // Rollback gỡ bảng like; trạng thái review đã backfill không rollback vì không thể phân biệt dữ liệu cũ.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_product_review_likes_review"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_product_review_likes_review_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_review_likes"`);
  }
}
