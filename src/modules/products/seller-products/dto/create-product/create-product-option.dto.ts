import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class CreateProductOptionValueDto {
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

export class CreateProductOptionDto {
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
  @Type(() => CreateProductOptionValueDto)
  values: CreateProductOptionValueDto[];
}
