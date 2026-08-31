// File này lưu thông tin brand thuộc Catalog domain và các metadata dùng để đồng bộ nguồn ngoài.
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

  // Tên đã bỏ dấu và chuẩn hóa khoảng trắng, dùng cho tìm kiếm và đối chiếu alias.
  @Column({ name: "normalized_name", type: "varchar", length: 180, nullable: true })
  normalizedName: string | null;

  // Slug thương hiệu để tìm kiếm, URL và chống trùng.
  @Column({ type: "varchar", length: 220 })
  slug: string;

  // Mã quốc gia ISO 3166-1 alpha-2 của thương hiệu khi nguồn có bằng chứng rõ ràng.
  @Column({ name: "country_code", type: "char", length: 2, nullable: true })
  countryCode: string | null;

  // Tên quốc gia hiển thị bằng tiếng Việt, đi cùng countryCode để FE không tự ánh xạ.
  @Column({ name: "country_name", type: "varchar", length: 120, nullable: true })
  countryName: string | null;

  // Các cách viết khác của cùng thương hiệu, phục vụ tìm kiếm và chống tạo brand gần trùng.
  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  aliases: string[];

  // Logo thương hiệu nếu nguồn hoặc admin cung cấp.
  @Column({ name: "logo_url", type: "text", nullable: true })
  logoUrl: string | null;

  // Mô tả thương hiệu, phục vụ SEO/trang brand sau này.
  @Column({ type: "text", nullable: true })
  description: string | null;

  // Bằng chứng crawl, category quan sát và trạng thái xác minh được giữ để audit nguồn dữ liệu.
  @Column({ name: "source_metadata", type: "jsonb", default: () => "'{}'::jsonb" })
  sourceMetadata: Record<string, unknown>;

  // Mốc gần nhất crawler quan sát brand, tách khỏi updatedAt vốn có thể thay đổi do admin chỉnh sửa.
  @Column({ name: "last_crawled_at", type: "timestamptz", nullable: true })
  lastCrawledAt: Date | null;

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
