// File này lưu snapshot shop nguồn ngoài để catalog truy vết dữ liệu crawl mà không phụ thuộc cross-service FK.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Product } from "./product.entity";

@Entity("external_shops")
@Index(["sourcePlatform", "externalShopId"], { unique: true })
@Index(["sourcePlatform", "slug"], { unique: true })
export class ExternalShop {
  // ID nội bộ của shop nguồn, dùng để product-service liên kết product crawl với shop bên ngoài.
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Nền tảng nguồn của shop như tiki, shopee, lazada; giúp chống trùng khi nhiều sàn có cùng external id.
  @Column({ name: "source_platform", type: "varchar", length: 40 })
  sourcePlatform: string;

  // ID shop trên nền tảng gốc; kết hợp với sourcePlatform để upsert idempotent khi crawl lại.
  @Column({ name: "external_shop_id", type: "varchar", length: 120 })
  externalShopId: string;

  // Tên shop hiển thị theo dữ liệu nguồn, ví dụ Tiki Trading.
  @Column({ type: "varchar", length: 180 })
  name: string;

  // Slug dùng cho URL nội bộ hoặc chống trùng mềm trong cùng nền tảng nguồn.
  @Column({ type: "varchar", length: 220 })
  slug: string;

  // Logo/avatar shop từ nguồn crawl, dùng hiển thị trên trang chi tiết sản phẩm import.
  @Column({ name: "avatar_url", type: "text", nullable: true })
  avatarUrl: string | null;

  // Mô tả shop nếu API nguồn cung cấp; nullable vì Tiki thường không trả đủ trường này ở product detail.
  @Column({ type: "text", nullable: true })
  description: string | null;

  // URL shop gốc trên sàn ngoài, giúp trace nguồn dữ liệu khi debug hoặc admin kiểm tra.
  @Column({ name: "source_url", type: "text", nullable: true })
  sourceUrl: string | null;

  // Điểm đánh giá trung bình của shop nếu nguồn có trả về.
  @Column({ name: "rating_avg", type: "numeric", precision: 4, scale: 2, nullable: true })
  ratingAvg: string | null;

  // Số lượng đánh giá của shop nếu nguồn có trả về.
  @Column({ name: "review_count", type: "int", default: 0 })
  reviewCount: number;

  // Số người theo dõi shop nếu nguồn có trả về.
  @Column({ name: "follower_count", type: "int", default: 0 })
  followerCount: number;

  // Dữ liệu phụ từ nguồn crawl chưa đáng tách thành cột riêng, ví dụ responseRate hoặc official flag.
  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  // Danh sách product crawl đang tham chiếu shop nguồn này.
  @OneToMany(() => Product, (product) => product.externalShop)
  products: Product[];

  // Thời điểm ghi nhận shop nguồn lần đầu trong database nội bộ.
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  // Thời điểm cập nhật thông tin shop nguồn gần nhất từ crawler/importer.
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
