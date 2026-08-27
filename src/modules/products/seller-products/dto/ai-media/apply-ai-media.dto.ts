import { IsArray, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

/** Payload noi bo de Product Service apply output sau khi seller da duyet preview. */
export class ApplyAiMediaItemDto {
  /** Asset ID do Media Service cap, khong phai URL tu user tu nhap. */
  @IsUUID()
  assetId: string;

  /** CDN URL da duoc Media Service xac nhan va cap lai cho product. */
  @IsString()
  @MaxLength(2000)
  imageUrl: string;

  /** Thu tu va co phai anh dai dien hay khong. */
  @IsOptional()
  sortOrder?: number;
}

/** Request apply co optimistic concurrency de tranh ghi de cap nhat moi cua seller. */
export class ApplyAiMediaDto {
  /** Job AI lam can cu audit va idempotency. */
  @IsUUID()
  jobId: string;

  /** Version product luc seller xem preview. */
  @IsISO8601()
  expectedProductUpdatedAt: string;

  /** Danh sach output da chon de hien thi. */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApplyAiMediaItemDto)
  images: ApplyAiMediaItemDto[];
}

