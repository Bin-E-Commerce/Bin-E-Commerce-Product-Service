// File này là bảng liên kết variant với option value, bảo toàn cấu hình SKU trong persistence layer.
import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { ProductOptionValue } from "./product-option-value.entity";
import { ProductVariant } from "./product-variant.entity";

@Entity("product_variant_option_values")
export class ProductVariantOptionValue {
  // ID variant trong cặp many-to-many giữa variant và option value.
  @PrimaryColumn({ name: "variant_id", type: "uuid" })
  variantId: string;

  // Quan hệ đến variant; xóa variant thì xóa lựa chọn tương ứng.
  @ManyToOne(() => ProductVariant, (variant) => variant.optionChoices, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "variant_id" })
  variant: ProductVariant;

  // ID option value mà variant này chọn.
  @PrimaryColumn({ name: "option_value_id", type: "uuid" })
  optionValueId: string;

  // Quan hệ đến option value; xóa value thì xóa liên kết variant.
  @ManyToOne(() => ProductOptionValue, (value) => value.variantChoices, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "option_value_id" })
  optionValue: ProductOptionValue;
}
