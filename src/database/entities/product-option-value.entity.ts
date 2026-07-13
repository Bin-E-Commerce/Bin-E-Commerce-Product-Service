import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from "typeorm";
import { ProductOption } from "./product-option.entity";
import { ProductVariantOptionValue } from "./product-variant-option-value.entity";

@Entity("product_option_values")
@Index(["optionId", "value"], { unique: true })
export class ProductOptionValue {
  // ID nội bộ của giá trị option.
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Nhóm option sở hữu giá trị này.
  @Column({ name: "option_id", type: "uuid" })
  optionId: string;

  // Quan hệ đến nhóm option; xóa option thì xóa luôn value.
  @ManyToOne(() => ProductOption, (option) => option.values, { onDelete: "CASCADE" })
  @JoinColumn({ name: "option_id" })
  option: ProductOption;

  // Giá trị lựa chọn, ví dụ Đen, 128GB, XL.
  @Column({ type: "varchar", length: 160 })
  value: string;

  // Thứ tự hiển thị value trong nhóm option.
  @Column({ type: "int", default: 0 })
  position: number;

  // Các variant đang dùng giá trị option này.
  @OneToMany(() => ProductVariantOptionValue, (choice) => choice.optionValue)
  variantChoices: ProductVariantOptionValue[];
}
