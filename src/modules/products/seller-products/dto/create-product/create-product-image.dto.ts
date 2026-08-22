import { Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CreateProductImageDto {
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  imageUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  altText?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(8)
  sortOrder: number;

  @IsBoolean()
  isThumbnail: boolean;
}
