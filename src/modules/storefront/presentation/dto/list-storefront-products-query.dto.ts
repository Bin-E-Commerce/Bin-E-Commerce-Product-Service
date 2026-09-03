// DTO này chuẩn hóa bộ lọc catalog public trước khi StorefrontProductsService truy vấn.
import { Transform } from "class-transformer";
import {
  IsEnum,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from "class-validator";
import { ProductOriginType } from "../../../../database/catalog/enums/product-origin-type.enum";
import { ProductStatus } from "../../../../database/catalog/enums/product-status.enum";
import { StorefrontSort } from "../../../../database/catalog/enums/storefront-sort.enum";

// Query dành riêng cho listing storefront; seller dùng DTO ownership riêng để không trộn hai ngữ cảnh.
export class ListStorefrontProductsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  sellerShopId?: string;

  @IsOptional()
  @IsUUID()
  externalShopId?: string;

  @IsOptional()
  @IsEnum(ProductOriginType)
  originType?: ProductOriginType;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  minRating?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  inStock?: boolean;

  @IsOptional()
  @IsEnum(StorefrontSort)
  sort?: StorefrontSort;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

// Giữ query rỗng là undefined để không vô tình biến bộ lọc giá/rating thành điều kiện bằng 0.
function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
