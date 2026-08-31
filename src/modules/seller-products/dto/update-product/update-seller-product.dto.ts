// DTO này mô tả dữ liệu cập nhật product graph và không trực tiếp thực hiện transaction.
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { ProductCondition } from "../../../../database/catalog/enums/product-condition.enum";
import { ProductStatus } from "../../../../database/catalog/enums/product-status.enum";
import { CreateProductAttributeDto } from "../create-product/create-product-attribute.dto";
import { CreateProductPackageDto } from "../create-product/create-product-package.dto";
import { CreateProductVideoDto } from "../create-product/create-product-video.dto";

export class UpdateProductOptionValueDto {
  @IsOptional()
  @IsUUID("all")
  id?: string;

  @IsString()
  @MaxLength(80)
  clientId: string;

  @IsString()
  @MaxLength(160)
  value: string;

  @IsInt()
  @Min(0)
  position: number;
}

export class UpdateProductOptionDto {
  @IsOptional()
  @IsUUID("all")
  id?: string;

  @IsString()
  @MaxLength(80)
  clientId: string;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsInt()
  @Min(0)
  position: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => UpdateProductOptionValueDto)
  values: UpdateProductOptionValueDto[];
}

export class UpdateProductImageDto {
  @IsOptional()
  @IsUUID("all")
  id?: string;

  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  imageUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  altText?: string;

  @IsInt()
  @Min(0)
  @Max(8)
  sortOrder: number;

  @IsBoolean()
  isThumbnail: boolean;
}

export class UpdateProductVariantDto {
  @IsOptional()
  @IsUUID("all")
  id?: string;

  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  optionValueClientIds: string[];

  @IsOptional()
  @IsString()
  @MaxLength(160)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  gtin?: string;

  @IsBoolean()
  withoutGtin: boolean;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(100)
  price: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(100)
  originalPrice?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQuantity: number;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  imageUrl?: string;
}

export class UpdateSellerProductDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  name: string;

  @IsUUID("all")
  categoryId: string;

  @IsOptional()
  @IsUUID("all")
  brandId?: string;

  @IsString()
  @MinLength(20)
  @MaxLength(30_000)
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  shortDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  gtin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  sellerSku?: string;

  @IsEnum(ProductCondition)
  condition: ProductCondition;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  countryOfOrigin?: string;

  // Client gửi lại status để mapper dùng chung, còn service luôn giữ status hiện tại trong database.
  @IsEnum(ProductStatus)
  status: ProductStatus;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(9)
  @ValidateNested({ each: true })
  @Type(() => UpdateProductImageDto)
  images: UpdateProductImageDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateProductVideoDto)
  video?: CreateProductVideoDto;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateProductAttributeDto)
  attributes: CreateProductAttributeDto[];

  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => UpdateProductOptionDto)
  options: UpdateProductOptionDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => UpdateProductVariantDto)
  variants: UpdateProductVariantDto[];

  @ValidateNested()
  @Type(() => CreateProductPackageDto)
  package: CreateProductPackageDto;
}
