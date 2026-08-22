import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { ProductVariantStatus } from "../../modules/products/shared/enums/product-variant-status.enum";
import { Inventory } from "./inventory.entity";
import { Product } from "./product.entity";
import { ProductImage } from "./product-image.entity";
import { ProductVariantOptionValue } from "./product-variant-option-value.entity";

@Entity("product_variants")
@Index(["sku"], { unique: true })
@Index(["productId"])
@Index(["productId", "sellerSku"], {
  unique: true,
  where: "seller_sku IS NOT NULL",
})
@Index(["productId", "externalVariantId"], {
  unique: true,
  where: "external_variant_id IS NOT NULL",
})
export class ProductVariant {
  // ID nội bộ của variant/SKU.
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Product sở hữu variant.
  @Column({ name: "product_id", type: "uuid" })
  productId: string;

  // Quan hệ đến product; product luôn có ít nhất một variant mặc định.
  @ManyToOne(() => Product, (product) => product.variants, { onDelete: "CASCADE" })
  @JoinColumn({ name: "product_id" })
  product: Product;

  // SKU duy nhất trong hệ thống, dùng cho order/inventory lookup.
  @Column({ type: "varchar", length: 160 })
  sku: string;

  // SKU do seller tự quản lý chỉ cần duy nhất trong một sản phẩm; SKU hệ thống ở trên vẫn là khóa toàn cục cho order và inventory.
  @Column({ name: "seller_sku", type: "varchar", length: 160, nullable: true })
  sellerSku: string | null;

  // Tên variant hiển thị, có thể bằng tên product nếu không có phân loại.
  @Column({ type: "varchar", length: 500 })
  name: string;

  // Giá bán hiện tại của variant.
  @Column({ type: "numeric", precision: 14, scale: 2 })
  price: string;

  // Giá gốc trước khuyến mãi nếu có.
  @Column({ name: "original_price", type: "numeric", precision: 14, scale: 2, nullable: true })
  originalPrice: string | null;

  // GTIN riêng của SKU nếu mỗi phân loại có mã vạch độc lập.
  @Column({ type: "varchar", length: 32, nullable: true })
  gtin: string | null;

  // Ghi nhận seller đã chủ động xác nhận SKU không có GTIN, tránh nhầm với dữ liệu bị bỏ sót.
  @Column({ name: "without_gtin", type: "boolean", default: false })
  withoutGtin: boolean;

  // Tồn kho nhanh ở variant để listing đọc được ngay; bảng inventories vẫn giữ chi tiết vận hành.
  @Column({ name: "stock_quantity", type: "int", default: 0 })
  stockQuantity: number;

  // Khối lượng variant, phục vụ tính phí vận chuyển sau này.
  @Column({ type: "numeric", precision: 12, scale: 3, nullable: true })
  weight: string | null;

  // Trạng thái bán của variant.
  @Column({
    type: "enum",
    enum: ProductVariantStatus,
    default: ProductVariantStatus.ACTIVE,
  })
  status: ProductVariantStatus;

  // Ảnh đại diện riêng của variant nếu có.
  @Column({ name: "image_url", type: "text", nullable: true })
  imageUrl: string | null;

  // ID variant từ nguồn ngoài, dùng chống trùng trong phạm vi product khi crawl lại.
  @Column({ name: "external_variant_id", type: "varchar", length: 160, nullable: true })
  externalVariantId: string | null;

  // Ảnh gắn riêng với variant này.
  @OneToMany(() => ProductImage, (image) => image.variant)
  images: ProductImage[];

  // Inventory chi tiết của variant.
  @OneToOne(() => Inventory, (inventory) => inventory.variant)
  inventory: Inventory | null;

  // Các lựa chọn option tạo nên variant này.
  @OneToMany(() => ProductVariantOptionValue, (choice) => choice.variant)
  optionChoices: ProductVariantOptionValue[];

  // Thời điểm tạo variant.
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  // Thời điểm cập nhật variant gần nhất.
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
