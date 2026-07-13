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

@Entity("brands")
@Index(["slug"], { unique: true })
@Index(["sourcePlatform", "externalBrandId"], {
  unique: true,
  where: "source_platform IS NOT NULL AND external_brand_id IS NOT NULL",
})
export class Brand {
  // ID nội bộ của thương hiệu, được product tham chiếu khi có brand rõ ràng từ nguồn hoặc admin.
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Nguồn dữ liệu nếu brand được crawl từ sàn ngoài; null với brand do admin tạo thủ công.
  @Column({ name: "source_platform", type: "varchar", length: 40, nullable: true })
  sourcePlatform: string | null;

  // ID brand trên nguồn ngoài, dùng cùng sourcePlatform để chống trùng khi import lại.
  @Column({ name: "external_brand_id", type: "varchar", length: 120, nullable: true })
  externalBrandId: string | null;

  // Tên thương hiệu hiển thị cho người dùng.
  @Column({ type: "varchar", length: 180 })
  name: string;

  // Slug thương hiệu để tìm kiếm, URL và chống trùng.
  @Column({ type: "varchar", length: 220 })
  slug: string;

  // Logo thương hiệu nếu nguồn hoặc admin cung cấp.
  @Column({ name: "logo_url", type: "text", nullable: true })
  logoUrl: string | null;

  // Mô tả thương hiệu, phục vụ SEO/trang brand sau này.
  @Column({ type: "text", nullable: true })
  description: string | null;

  // Bật/tắt brand mà không xóa dữ liệu sản phẩm đang tham chiếu.
  @Column({ name: "is_active", type: "boolean", default: true })
  isActive: boolean;

  // Product thuộc thương hiệu này.
  @OneToMany(() => Product, (product) => product.brand)
  products: Product[];

  // Thời điểm brand được tạo.
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  // Thời điểm brand được cập nhật gần nhất.
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
