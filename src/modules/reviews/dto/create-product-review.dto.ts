// File này xác thực payload tạo và cập nhật review; userId, orderId và product ownership luôn do service tự lấy từ context.

import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";

export class CreateProductReviewDto {
  @IsUUID("4")
  orderItemId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  images?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  videos?: string[];

  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;
}

// DTO chỉ chứa các trường Customer được phép thay đổi; orderItemId và productId luôn giữ nguyên từ review gốc.
export class UpdateProductReviewDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  images?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  videos?: string[];

  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;
}
