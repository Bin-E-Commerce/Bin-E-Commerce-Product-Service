import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { ProductVariant } from "./product-variant.entity";

@Entity("inventories")
export class Inventory {
  // ID nội bộ của bản ghi tồn kho.
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Variant sở hữu tồn kho; unique để mỗi SKU có một bản ghi inventory.
  @Column({ name: "variant_id", type: "uuid", unique: true })
  variantId: string;

  // Quan hệ 1-1 đến variant; xóa variant thì xóa tồn kho tương ứng.
  @OneToOne(() => ProductVariant, (variant) => variant.inventory, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "variant_id" })
  variant: ProductVariant;

  // Số lượng có thể bán ngay.
  @Column({ name: "quantity_available", type: "int", default: 0 })
  quantityAvailable: number;

  // Số lượng đã giữ cho đơn đang xử lý nhưng chưa hoàn tất.
  @Column({ name: "quantity_reserved", type: "int", default: 0 })
  quantityReserved: number;

  // Số lượng đã bán, dùng đồng bộ analytics nhanh.
  @Column({ name: "quantity_sold", type: "int", default: 0 })
  quantitySold: number;

  // Ngưỡng cảnh báo sắp hết hàng.
  @Column({ name: "low_stock_threshold", type: "int", default: 5 })
  lowStockThreshold: number;

  // Thời điểm tồn kho được cập nhật gần nhất.
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
