import { ArrayMaxSize, IsArray, IsIn, IsUUID, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class CleanupUploadedReviewMediaAssetDto {
  @IsUUID("4")
  assetId!: string;

  @IsIn(["review_image", "review_video"])
  purpose!: "review_image" | "review_video";
}

// DTO cho phép customer dọn asset upload dở dang; owner thực tế luôn lấy từ header do Gateway inject.
export class CleanupUploadedReviewMediaDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CleanupUploadedReviewMediaAssetDto)
  assets!: CleanupUploadedReviewMediaAssetDto[];
}
