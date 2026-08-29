import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";

// Reservation ledger lưu key checkout và trạng thái release để mọi retry chỉ thay đổi tồn kho một lần.
@Entity({ name: "checkout_reservations" })
@Unique("uq_checkout_reservations_key", ["reservationKey"])
export class CheckoutReservation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "reservation_key", type: "varchar", length: 128 })
  reservationKey!: string;

  @Column({ type: "varchar", length: 16, default: "RESERVED" })
  status!: "RESERVED" | "RELEASED";

  @Column({ type: "jsonb" })
  response!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "released_at", type: "timestamptz", nullable: true })
  releasedAt!: Date | null;
}
