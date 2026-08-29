import { MigrationInterface, QueryRunner } from "typeorm";

// Migration tạo ledger reservation để release inventory có thể retry idempotent theo checkout key.
export class AddCheckoutReservations1788048000000 implements MigrationInterface {
  name = "AddCheckoutReservations1788048000000";

  // Lưu snapshot response của reserve để retry reserve trả cùng kết quả mà không trừ stock lần nữa.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "checkout_reservations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "reservation_key" varchar(128) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'RESERVED',
        "response" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "released_at" timestamptz,
        CONSTRAINT "pk_checkout_reservations_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_checkout_reservations_key" UNIQUE ("reservation_key"),
        CONSTRAINT "ck_checkout_reservations_status" CHECK ("status" IN ('RESERVED', 'RELEASED'))
      )
    `);
  }

  // Xóa ledger khi rollback migration, không đụng tới bảng inventory.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "checkout_reservations"');
  }
}
