import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Product } from "./product.entity";
import { ProductVariant } from "./product-variant.entity";

@Entity("product_reviews")
@Index(["productId"])
@Index(["sourcePlatform", "externalReviewId"], {
  unique: true,
  where: "source_platform IS NOT NULL AND external_review_id IS NOT NULL",
})
export class ProductReview {
  // ID nội bộ của review.
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // User nội bộ nếu review do khách hàng Bin tạo; null với review crawl.
  @Column({ name: "user_id", type: "uuid", nullable: true })
  userId: string | null;

  // Product được review.
  @Column({ name: "product_id", type: "uuid" })
  productId: string;

  // Quan hệ đến product; xóa product thì xóa review liên quan.
  @ManyToOne(() => Product, (product) => product.reviews, { onDelete: "CASCADE" })
  @JoinColumn({ name: "product_id" })
  product: Product;

  // Variant được review nếu nguồn có phân biệt SKU.
  @Column({ name: "variant_id", type: "uuid", nullable: true })
  variantId: string | null;

  // Quan hệ tùy chọn đến variant được review.
  @ManyToOne(() => ProductVariant, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "variant_id" })
  variant: ProductVariant | null;

  // Điểm đánh giá từ 1 đến 5.
  @Column({ type: "int" })
  rating: number;

  // Nội dung review.
  @Column({ type: "text", nullable: true })
  content: string | null;

  // Danh sách ảnh review.
  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  images: string[];

  // Trạng thái kiểm duyệt review.
  @Column({ type: "varchar", length: 40, default: "approved" })
  status: string;

  // Nền tảng nguồn nếu review được crawl.
  @Column({ name: "source_platform", type: "varchar", length: 40, nullable: true })
  sourcePlatform: string | null;

  // ID review trên nền tảng nguồn để chống trùng.
  @Column({ name: "external_review_id", type: "varchar", length: 160, nullable: true })
  externalReviewId: string | null;

  // Thời điểm review được tạo theo nguồn hoặc hệ thống nội bộ.
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  // Thời điểm review được cập nhật gần nhất.
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
