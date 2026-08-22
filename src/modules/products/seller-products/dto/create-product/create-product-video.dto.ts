import { IsInt, IsString, IsUUID, Max, Min } from "class-validator";

export class CreateProductVideoDto {
  // ID asset từ Media Service để có thể truy vết file gốc khi cần kiểm duyệt hoặc xóa.
  // Media Service sử dụng UUID v5 cho asset import và UUID v4 cho asset upload mới;
  // dùng toàn bộ version hợp lệ để không từ chối asset chỉ vì khác version UUID.
  @IsUUID("all")
  assetId: string;

  // URL CDN hoặc URL public của video đã được Media Service cấp cho product.
  @IsString()
  videoUrl: string;

  // Giới hạn video ngắn giúp trang chi tiết tải ổn định và tránh biến listing thành kho video dài.
  @IsInt()
  @Min(10)
  @Max(60)
  durationSeconds: number;
}
