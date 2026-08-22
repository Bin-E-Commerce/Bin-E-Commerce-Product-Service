import { Type } from "class-transformer";
import { IsInt, IsNumber, Max, Min } from "class-validator";

export class CreateProductPackageDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  weightGrams: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(1_000)
  lengthCm: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(1_000)
  widthCm: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(1_000)
  heightCm: number;
}
