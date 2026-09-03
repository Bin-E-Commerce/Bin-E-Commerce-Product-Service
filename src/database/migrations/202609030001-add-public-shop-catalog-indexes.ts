// Tạo các index phục vụ catalog public của shop.
// Các truy vấn này luôn lọc theo shop/trạng thái và có thể kiểm tra tồn kho hoặc review đã duyệt.
import { MigrationInterface, QueryRunner } from "typeorm";

// Migration tạo các index read-heavy cho catalog public mà không thay đổi dữ liệu nghiệp vụ.
export class AddPublicShopCatalogIndexes2026090300010 implements MigrationInterface {
  name = "AddPublicShopCatalogIndexes2026090300010";

  // Tăng tốc listing shop, bộ lọc còn hàng và phần tổng hợp review mà không thay đổi dữ liệu nghiệp vụ.
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_products_public_shop_catalog" ON "products" ("seller_shop_id", "status", "origin_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_product_variants_stock_lookup" ON "product_variants" ("product_id", "status", "stock_quantity")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_product_reviews_product_status" ON "product_reviews" ("product_id", "status")`,
    );
  }

  // Xóa đúng các index do migration này sở hữu khi rollback, không đụng vào index cũ của catalog.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_product_reviews_product_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_product_variants_stock_lookup"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_public_shop_catalog"`);
  }
}
