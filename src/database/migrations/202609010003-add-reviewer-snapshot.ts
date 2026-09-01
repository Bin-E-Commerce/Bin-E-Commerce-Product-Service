// Migration nay luu snapshot ten va avatar nguoi mua de review hien thi danh tinh thong nhat sau khi user doi profile.
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReviewerSnapshot2026090100030 implements MigrationInterface {
  name = "AddReviewerSnapshot2026090100030";

  // Them cac cot nullable de review legacy van hien thi duoc voi fallback avatar va ten chung.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_reviews"
      ADD COLUMN IF NOT EXISTS "reviewer_name" varchar(160)
    `);
    await queryRunner.query(`
      ALTER TABLE "product_reviews"
      ADD COLUMN IF NOT EXISTS "reviewer_avatar_url" varchar(1000)
    `);
  }

  // Xoa hai cot snapshot khi rollback migration.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_reviews"
      DROP COLUMN IF EXISTS "reviewer_avatar_url"
    `);
    await queryRunner.query(`
      ALTER TABLE "product_reviews"
      DROP COLUMN IF EXISTS "reviewer_name"
    `);
  }
}
