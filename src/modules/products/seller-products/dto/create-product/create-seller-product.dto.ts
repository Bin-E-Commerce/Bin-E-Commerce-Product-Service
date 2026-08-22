import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { ProductCondition } from "../../../shared/enums/product-condition.enum";
import { ProductStatus } from "../../../shared/enums/product-status.enum";
import { CreateProductAttributeDto } from "./create-product-attribute.dto";
import { CreateProductImageDto } from "./create-product-image.dto";
import { CreateProductOptionDto } from "./create-product-option.dto";
import { CreateProductPackageDto } from "./create-product-package.dto";
import { CreateProductVariantDto } from "./create-product-variant.dto";
import { CreateProductVideoDto } from "./create-product-video.dto";

export class CreateSellerProductDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  name: string;

  // Category được Catalog Service quản lý và dữ liệu import có thể dùng UUID v5.
  // Chấp nhận mọi phiên bản UUID hợp lệ, nhưng service vẫn kiểm tra category tồn tại,
  // đang hoạt động và là ngành hàng cấp cuối ở bước nghiệp vụ phía sau.
  @IsUUID("all")
  categoryId: string;

  @IsOptional()
  // Brand là khóa tham chiếu sang danh mục thương hiệu, nên không được khóa cứng UUID v4.
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

  @IsEnum(ProductStatus)
  @IsIn([ProductStatus.DRAFT, ProductStatus.ACTIVE])
  status: ProductStatus;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(9)
  @ValidateNested({ each: true })
  @Type(() => CreateProductImageDto)
  images: CreateProductImageDto[];

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
  @Type(() => CreateProductOptionDto)
  options: CreateProductOptionDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateProductVariantDto)
  variants: CreateProductVariantDto[];

  @ValidateNested()
  @Type(() => CreateProductPackageDto)
  package: CreateProductPackageDto;
}
