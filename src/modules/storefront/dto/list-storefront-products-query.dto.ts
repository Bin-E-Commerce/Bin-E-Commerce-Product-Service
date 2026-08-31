// DTO này chuẩn hóa bộ lọc catalog public trước khi StorefrontProductsService truy vấn.
import { Transform } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from "class-validator";
import { ProductOriginType } from "../../../database/catalog/enums/product-origin-type.enum";
import { ProductStatus } from "../../../database/catalog/enums/product-status.enum";

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
