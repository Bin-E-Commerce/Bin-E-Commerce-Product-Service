import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Product } from "./product.entity";
import { ProductOptionValue } from "./product-option-value.entity";

@Entity("product_options")
@Index(["productId", "name"], { unique: true })
export class ProductOption {
  // ID nội bộ của nhóm phân loại.
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Product sở hữu nhóm phân loại này.
  @Column({ name: "product_id", type: "uuid" })
  productId: string;

  // Quan hệ đến product; xóa product thì xóa luôn option.
  @ManyToOne(() => Product, (product) => product.options, { onDelete: "CASCADE" })
  @JoinColumn({ name: "product_id" })
  product: Product;

  // Tên nhóm lựa chọn, ví dụ Màu sắc, Size, Dung lượng.
  @Column({ type: "varchar", length: 120 })
  name: string;

  // Thứ tự hiển thị nhóm lựa chọn trên UI.
  @Column({ type: "int", default: 0 })
  position: number;

  // Các giá trị trong nhóm lựa chọn.
  @OneToMany(() => ProductOptionValue, (value) => value.option)
  values: ProductOptionValue[];
}
