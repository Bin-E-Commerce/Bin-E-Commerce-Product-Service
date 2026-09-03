import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from "class-validator";

export class CreateProductVariantDto {
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
