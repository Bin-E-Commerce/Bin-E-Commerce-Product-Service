// File này là persistence model của review sản phẩm; review chỉ giữ relation đến catalog và không sở hữu product lifecycle.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Product } from "../../catalog/entities/product.entity";
import { ProductVariant } from "../../catalog/entities/product-variant.entity";
import { ProductReviewLike } from "./product-review-like.entity";

@Entity("product_reviews")
@Index(["productId"])
@Index("IDX_product_reviews_product_status", ["productId", "status"])
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

  // Luu snapshot ten nguoi mua tai thoi diem danh gia de review khong bi mat danh tinh khi user doi profile.
  @Column({ name: "reviewer_name", type: "varchar", length: 160, nullable: true })
  reviewerName: string | null;

  // Avatar hien thi tuy chon; UI fallback sang chu cai dau ten neu token khong co avatar.
  @Column({ name: "reviewer_avatar_url", type: "varchar", length: 1000, nullable: true })
  reviewerAvatarUrl: string | null;

  // Customer có thể chọn ẩn danh; hệ thống vẫn giữ snapshot gốc để có thể bật lại khi chỉnh sửa review.
  @Column({ name: "is_anonymous", type: "boolean", default: false })
  isAnonymous: boolean;

  // Purchase proof do Order Service cấp; review crawl có thể để null để giữ tương thích dữ liệu cũ.
  @Column({ name: "order_id", type: "uuid", nullable: true })
  orderId: string | null;

  // Gắn review vào đúng dòng hàng để mỗi sản phẩm trong một order chỉ được đánh giá một lần.
  @Column({ name: "order_item_id", type: "uuid", nullable: true })
  orderItemId: string | null;

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

  // Các lượt thích được tách thành bảng riêng để đếm nhanh và chống một user thích trùng.
  @OneToMany(() => ProductReviewLike, (like) => like.review)
  likes: ProductReviewLike[];

  // Hai field read-only này được gắn khi dựng response, không lưu vào database và không làm lộ danh sách user đã thích.
  likeCount?: number;
  likedByCurrentUser?: boolean;

  // Điểm đánh giá từ 1 đến 5.
  @Column({ type: "int" })
  rating: number;

  // Nội dung review.
  @Column({ type: "text", nullable: true })
  content: string | null;

  // Tiêu đề tùy chọn giúp review dài dễ quét hơn; nội dung chính vẫn nằm ở content để tương thích UI hiện tại.
  @Column({ type: "varchar", length: 200, nullable: true })
  title: string | null;

  // Danh sách ảnh review.
  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  images: string[];

  // Danh sach video review dang URL CDN goc; video khong dung pipeline WebP cua anh.
  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  videos: string[];

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
