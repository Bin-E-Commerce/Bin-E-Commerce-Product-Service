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
import { ProductCondition } from "../../modules/products/shared/enums/product-condition.enum";
import { ProductOriginType } from "../../modules/products/shared/enums/product-origin-type.enum";
import { ProductStatus } from "../../modules/products/shared/enums/product-status.enum";
import { Brand } from "./brand.entity";
import { ExternalShop } from "./external-shop.entity";
import { ProductImage } from "./product-image.entity";
import { ProductVariant } from "./product-variant.entity";
import { ProductOption } from "./product-option.entity";
import { ProductAttributeValue } from "./product-attribute-value.entity";
import { ProductReview } from "./product-review.entity";

@Entity("products")
@Index(["slug"], { unique: true })
@Index(["categoryId"])
@Index(["sellerShopId"])
@Index(["sellerOwnerId"])
@Index(["sellerOwnerId", "status", "deletedAt"])
@Index(["externalShopId"])
@Index(["sourcePlatform", "externalProductId"], {
  unique: true,
  where: "source_platform IS NOT NULL AND external_product_id IS NOT NULL",
})
export class Product {
  // ID nội bộ của sản phẩm trong product-service.
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Phân biệt product do seller nội bộ tạo hay product crawl từ nguồn ngoài.
  @Column({
    name: "origin_type",
    type: "enum",
    enum: ProductOriginType,
    default: ProductOriginType.INTERNAL,
  })
  originType: ProductOriginType;

  // ID shop thật trong seller-service; chỉ lưu ID logic vì product-service không FK cross-database.
  @Column({ name: "seller_shop_id", type: "uuid", nullable: true })
  sellerShopId: string | null;

  // ID tài khoản sở hữu shop lấy từ auth-service; trường này là khóa phân vùng dữ liệu khi seller đọc sản phẩm của mình.
  // Product Service lưu bản sao ID logic để kiểm tra ownership mà không cần gọi đồng bộ sang seller-service cho mỗi request.
  @Column({ name: "seller_owner_id", type: "uuid", nullable: true })
  sellerOwnerId: string | null;

  // ID shop nguồn trong bảng external_shops; dùng cho product crawl từ Tiki/Shopee/Lazada.
  @Column({ name: "external_shop_id", type: "uuid", nullable: true })
  externalShopId: string | null;

  // Quan hệ nội bộ đến shop nguồn để đọc product import kèm thông tin shop crawl.
  @ManyToOne(() => ExternalShop, (shop) => shop.products, {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "external_shop_id" })
  externalShop: ExternalShop | null;

  // ID category nội bộ từ catalog-service; không tạo thêm category từ Tiki khi import.
  @Column({ name: "category_id", type: "uuid" })
  categoryId: string;

  // ID brand nếu product có thương hiệu.
  @Column({ name: "brand_id", type: "uuid", nullable: true })
  brandId: string | null;

  // Quan hệ nội bộ đến brand vì brand thuộc product-service.
  @ManyToOne(() => Brand, (brand) => brand.products, {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "brand_id" })
  brand: Brand | null;

  // Tên sản phẩm hiển thị.
  @Column({ type: "varchar", length: 500 })
  name: string;

  // Slug sản phẩm để làm URL và chống trùng trong product-service.
  @Column({ type: "varchar", length: 620 })
  slug: string;

  // Mô tả chi tiết, có thể là HTML đã được sanitize ở tầng import/admin sau này.
  @Column({ type: "text", nullable: true })
  description: string | null;

  // Mô tả ngắn phục vụ card/listing.
  @Column({ name: "short_description", type: "text", nullable: true })
  shortDescription: string | null;

  // Asset video gốc được Media Service quản lý; Product Service chỉ lưu tham chiếu để không sở hữu dữ liệu file.
  @Column({ name: "video_asset_id", type: "uuid", nullable: true })
  videoAssetId: string | null;

  // URL phát video công khai do Media Service/CDN trả về.
  @Column({ name: "video_url", type: "text", nullable: true })
  videoUrl: string | null;

  // Thời lượng dùng để kiểm soát UX ở listing và áp dụng rule video ngắn.
  @Column({ name: "video_duration_seconds", type: "smallint", nullable: true })
  videoDurationSeconds: number | null;

  // Mã thương mại toàn cầu ở cấp sản phẩm; variant có thể có GTIN riêng nếu từng phân loại dùng mã khác nhau.
  @Column({ type: "varchar", length: 32, nullable: true })
  gtin: string | null;

  // SKU cấp sản phẩm do seller tự quản lý, tách khỏi SKU bắt buộc của từng variant.
  @Column({ name: "seller_sku", type: "varchar", length: 160, nullable: true })
  sellerSku: string | null;

  // Tình trạng hàng hóa được lưu có cấu trúc để storefront không phải suy luận từ mô tả.
  @Column({
    type: "enum",
    enum: ProductCondition,
    default: ProductCondition.NEW,
  })
  condition: ProductCondition;

  // Xuất xứ do seller khai báo, độc lập với quốc gia của thương hiệu.
  @Column({ name: "country_of_origin", type: "varchar", length: 120, nullable: true })
  countryOfOrigin: string | null;

  // Thông số kiện hàng phục vụ shipping-service tính cước ở giai đoạn tiếp theo.
  @Column({ name: "package_weight_grams", type: "int", nullable: true })
  packageWeightGrams: number | null;

  @Column({ name: "package_length_cm", type: "numeric", precision: 10, scale: 2, nullable: true })
  packageLengthCm: string | null;

  @Column({ name: "package_width_cm", type: "numeric", precision: 10, scale: 2, nullable: true })
  packageWidthCm: string | null;

  @Column({ name: "package_height_cm", type: "numeric", precision: 10, scale: 2, nullable: true })
  packageHeightCm: string | null;

  // Trạng thái vòng đời sản phẩm.
  @Column({
    type: "enum",
    enum: ProductStatus,
    default: ProductStatus.DRAFT,
  })
  status: ProductStatus;

  // Thời điểm sản phẩm chuyển sang DELETED để Seller Center hiển thị lịch sử xóa mềm.
  @Column({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt: Date | null;

  // ID logic của user thực hiện xóa, không tạo foreign key vì user thuộc Auth Service.
  @Column({ name: "deleted_by", type: "uuid", nullable: true })
  deletedBy: string | null;

  // Giá thấp nhất tính từ các variant đang bán.
  @Column({ name: "min_price", type: "numeric", precision: 14, scale: 2, default: 0 })
  minPrice: string;

  // Giá cao nhất tính từ các variant đang bán.
  @Column({ name: "max_price", type: "numeric", precision: 14, scale: 2, default: 0 })
  maxPrice: string;

  // Tổng số lượng đã bán theo nguồn hoặc theo đơn hàng nội bộ sau này.
  @Column({ name: "total_sold", type: "int", default: 0 })
  totalSold: number;

  // Điểm đánh giá trung bình của sản phẩm.
  @Column({ name: "rating_avg", type: "numeric", precision: 4, scale: 2, nullable: true })
  ratingAvg: string | null;

  // Số review của sản phẩm.
  @Column({ name: "review_count", type: "int", default: 0 })
  reviewCount: number;

  // Số lượt xem, dùng cho analytics/sắp xếp phổ biến sau này.
  @Column({ name: "view_count", type: "int", default: 0 })
  viewCount: number;

  // Nền tảng nguồn nếu là product crawl.
  @Column({ name: "source_platform", type: "varchar", length: 40, nullable: true })
  sourcePlatform: string | null;

  // ID sản phẩm trên nguồn ngoài, dùng chống trùng khi crawler chạy lại.
  @Column({ name: "external_product_id", type: "varchar", length: 120, nullable: true })
  externalProductId: string | null;

  // URL sản phẩm gốc trên nền tảng nguồn.
  @Column({ name: "source_url", type: "text", nullable: true })
  sourceUrl: string | null;

  // Metadata phụ của nguồn crawl hoặc admin workflow.
  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  // Ảnh của sản phẩm.
  @OneToMany(() => ProductImage, (image) => image.product)
  images: ProductImage[];

  // Các SKU/variant bán hàng.
  @OneToMany(() => ProductVariant, (variant) => variant.product)
  variants: ProductVariant[];

  // Các nhóm phân loại như Màu sắc, Size, Dung lượng.
  @OneToMany(() => ProductOption, (option) => option.product)
  options: ProductOption[];

  // Giá trị thuộc tính kỹ thuật của product theo category attributes nội bộ.
  @OneToMany(() => ProductAttributeValue, (value) => value.product)
  attributeValues: ProductAttributeValue[];

  // Review crawl hoặc review nội bộ sau này.
  @OneToMany(() => ProductReview, (review) => review.product)
  reviews: ProductReview[];

  // Thời điểm tạo sản phẩm.
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  // Thời điểm cập nhật sản phẩm gần nhất.
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
