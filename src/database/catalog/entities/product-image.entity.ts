// File này lưu media gắn với product hoặc variant; lifecycle asset bên ngoài thuộc Media Service.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Product } from "./product.entity";
import { ProductVariant } from "./product-variant.entity";

@Entity("product_images")
@Index(["productId", "imageUrl"], { unique: true })
@Index(["productId", "isThumbnail"])
export class ProductImage {
  // ID nội bộ của ảnh sản phẩm.
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Product sở hữu ảnh.
  @Column({ name: "product_id", type: "uuid" })
  productId: string;

  // Quan hệ đến product; xóa product thì xóa toàn bộ ảnh liên quan.
  @ManyToOne(() => Product, (product) => product.images, { onDelete: "CASCADE" })
  @JoinColumn({ name: "product_id" })
  product: Product;

  // Variant sở hữu ảnh nếu ảnh chỉ đại diện cho một SKU cụ thể.
  @Column({ name: "variant_id", type: "uuid", nullable: true })
  variantId: string | null;

  // Quan hệ tùy chọn đến variant để UI đổi ảnh khi chọn phân loại.
  @ManyToOne(() => ProductVariant, (variant) => variant.images, {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "variant_id" })
  variant: ProductVariant | null;

  // URL ảnh đã có thể render trực tiếp từ CDN/source.
  @Column({ name: "image_url", type: "text" })
  imageUrl: string;

  // Alt text hỗ trợ SEO/accessibility.
  @Column({ name: "alt_text", type: "varchar", length: 500, nullable: true })
  altText: string | null;

  // Thứ tự hiển thị ảnh trong gallery.
  @Column({ name: "sort_order", type: "int", default: 0 })
  sortOrder: number;

  // Ảnh đại diện chính của product.
  @Column({ name: "is_thumbnail", type: "boolean", default: false })
  isThumbnail: boolean;

  // ID ảnh từ nguồn ngoài nếu crawler có sinh hoặc source trả về.
  @Column({ name: "external_image_id", type: "varchar", length: 160, nullable: true })
  externalImageId: string | null;

  // ID asset gốc được dùng làm nguồn cho mọi lần tối ưu; giá trị này không bị ghi đè bởi output AI.
  @Column({ name: "source_asset_id", type: "varchar", length: 160, nullable: true })
  sourceAssetId: string | null;

  // ID asset AI đang được hiển thị; giữ riêng để có thể tối ưu lại hoặc khôi phục ảnh gốc.
  @Column({ name: "ai_asset_id", type: "varchar", length: 160, nullable: true })
  aiAssetId: string | null;

  // Thời điểm ảnh được ghi vào database.
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
