// Migration cài trigram search và index các trường storefront dùng để tra tên, brand, SKU và mã vạch.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductSearchIndexes2026111300010 implements MigrationInterface {
    name = 'AddProductSearchIndexes2026111300010';

    // Extension trusted chỉ cần quyền CREATE trên database; GIN phục vụ ILIKE và fuzzy match, B-tree phục vụ mã định danh chính xác.
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_products_name_trgm" ON "products" USING GIN ("name" gin_trgm_ops)',
        );
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_products_name_lower_prefix" ON "products" (LOWER("name") text_pattern_ops)',
        );
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_products_slug_lower_prefix" ON "products" (LOWER("slug") text_pattern_ops)',
        );
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_products_slug_trgm" ON "products" USING GIN ("slug" gin_trgm_ops)',
        );
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_products_short_description_trgm" ON "products" USING GIN ("short_description" gin_trgm_ops) WHERE "short_description" IS NOT NULL',
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_products_category_name_prefix" ON "products" (LOWER(COALESCE("metadata" ->> 'categoryName', '')) text_pattern_ops)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_products_category_name_trgm" ON "products" USING GIN ((COALESCE("metadata" ->> 'categoryName', '')) gin_trgm_ops)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_products_category_path_prefix" ON "products" (LOWER(COALESCE("metadata" ->> 'categoryPath', '')) text_pattern_ops)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_products_category_path_trgm" ON "products" USING GIN ((COALESCE("metadata" ->> 'categoryPath', '')) gin_trgm_ops)`,
        );
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_brands_name_trgm" ON "brands" USING GIN ("name" gin_trgm_ops)',
        );
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_brands_name_lower_prefix" ON "brands" (LOWER("name") text_pattern_ops)',
        );
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_brands_normalized_name_trgm" ON "brands" USING GIN ("normalized_name" gin_trgm_ops) WHERE "normalized_name" IS NOT NULL',
        );
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_brands_normalized_name_prefix" ON "brands" (LOWER(COALESCE("normalized_name", \'\')) text_pattern_ops)',
        );
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_brands_aliases_trgm" ON "brands" USING GIN (("aliases"::text) gin_trgm_ops)',
        );
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_product_variants_name_trgm" ON "product_variants" USING GIN ("name" gin_trgm_ops)',
        );
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_product_variants_name_prefix" ON "product_variants" (LOWER("name") text_pattern_ops)',
        );
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_products_seller_sku_lower" ON "products" (LOWER("seller_sku")) WHERE "seller_sku" IS NOT NULL',
        );
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_products_gtin_lower" ON "products" (LOWER("gtin")) WHERE "gtin" IS NOT NULL',
        );
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_product_variants_sku_lower" ON "product_variants" (LOWER("sku"))',
        );
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_product_variants_seller_sku_lower" ON "product_variants" (LOWER("seller_sku")) WHERE "seller_sku" IS NOT NULL',
        );
        await queryRunner.query(
            'CREATE INDEX IF NOT EXISTS "IDX_product_variants_gtin_lower" ON "product_variants" (LOWER("gtin")) WHERE "gtin" IS NOT NULL',
        );
    }

    // Chỉ xóa index của migration; extension được giữ lại để không ảnh hưởng object khác có thể dùng chung pg_trgm.
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_brands_aliases_trgm"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_product_variants_name_prefix"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_product_variants_gtin_lower"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_product_variants_seller_sku_lower"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_product_variants_sku_lower"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_products_gtin_lower"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_products_seller_sku_lower"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_product_variants_name_trgm"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_brands_normalized_name_trgm"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_brands_normalized_name_prefix"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_brands_name_lower_prefix"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_brands_name_trgm"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_products_short_description_trgm"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_products_category_path_prefix"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_products_category_path_trgm"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_products_category_name_prefix"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_products_category_name_trgm"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_products_slug_trgm"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_products_slug_lower_prefix"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_products_name_trgm"',
        );
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_products_name_lower_prefix"',
        );
    }
}
