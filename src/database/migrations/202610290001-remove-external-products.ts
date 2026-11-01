// Migration bỏ metadata nguồn sản phẩm khỏi schema nhưng giữ nguyên product và dữ liệu liên quan.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveExternalProducts2026102900010 implements MigrationInterface {
    name = 'RemoveExternalProducts2026102900010';

    // Bỏ bảng/cột phân loại nguồn khỏi schema nhưng giữ nguyên mọi product.
    // Variant, ảnh, review, tồn kho và catalog event cũng không bị xóa.
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'DROP TABLE IF EXISTS "external_shops" CASCADE',
        );
        await queryRunner.query(`
            ALTER TABLE "products"
            DROP COLUMN IF EXISTS "origin_type" CASCADE,
            DROP COLUMN IF EXISTS "external_shop_id" CASCADE,
            DROP COLUMN IF EXISTS "external_product_id" CASCADE,
            DROP COLUMN IF EXISTS "source_platform" CASCADE,
            DROP COLUMN IF EXISTS "source_url" CASCADE
        `);
        await queryRunner.query(`
            ALTER TABLE "product_variants"
            DROP COLUMN IF EXISTS "external_variant_id" CASCADE
        `);
        await queryRunner.query(`
            ALTER TABLE "product_images"
            DROP COLUMN IF EXISTS "external_image_id" CASCADE
        `);
        await queryRunner.query(`
            ALTER TABLE "product_reviews"
            DROP COLUMN IF EXISTS "source_platform" CASCADE,
            DROP COLUMN IF EXISTS "external_review_id" CASCADE
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_products_public_shop_catalog"
            ON "products" ("seller_shop_id", "status")
        `);
        await queryRunner.query(
            'DROP TYPE IF EXISTS "products_origin_type_enum" CASCADE',
        );
    }

    // Không thể khôi phục nguồn sản phẩm sau khi metadata bị loại khỏi schema.
    // Rollback tự động sẽ tạo dữ liệu nguồn giả nên migration bị khóa ngược.
    async down(_queryRunner: QueryRunner): Promise<void> {
        throw new Error(
            'Migration bỏ metadata nguồn sản phẩm là không thể rollback an toàn.',
        );
    }
}
