import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Product } from "./product.entity";

@Entity("product_attribute_values")
@Index(["productId", "categoryAttributeId"], { unique: true })
export class ProductAttributeValue {
  // ID nội bộ của giá trị thuộc tính kỹ thuật.
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Product sở hữu giá trị thuộc tính.
  @Column({ name: "product_id", type: "uuid" })
  productId: string;

  // Quan hệ đến product; xóa product thì xóa thông số kỹ thuật.
  @ManyToOne(() => Product, (product) => product.attributeValues, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "product_id" })
  product: Product;

  // ID attribute từ catalog-service; không FK vật lý vì catalog-service có database riêng.
  @Column({ name: "category_attribute_id", type: "uuid" })
  categoryAttributeId: string;

  // Giá trị text cho các thuộc tính dạng chữ/select.
  @Column({ name: "value_text", type: "text", nullable: true })
  valueText: string | null;

  // Giá trị số cho thuộc tính dạng number.
  @Column({ name: "value_number", type: "numeric", precision: 18, scale: 4, nullable: true })
  valueNumber: string | null;

  // Giá trị boolean cho thuộc tính đúng/sai.
  @Column({ name: "value_boolean", type: "boolean", nullable: true })
  valueBoolean: boolean | null;

  // Metadata phụ khi crawler chưa map được hoàn toàn sang attribute nội bộ.
  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  // Thời điểm giá trị thuộc tính được cập nhật gần nhất.
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
