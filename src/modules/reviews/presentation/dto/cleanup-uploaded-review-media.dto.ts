// DTO này giới hạn cleanup về asset review và bằng chứng hoàn hàng của chính user.
// Không nhận purpose chứng từ chuyển tiền vì phase hiện tại chưa có settlement.

import { ArrayMaxSize, IsArray, IsIn, IsUUID, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class CleanupUploadedReviewMediaAssetDto {
  @IsUUID("4")
  assetId!: string;

  @IsIn(["review_image", "review_video", "return_image", "return_video"])
  purpose!: "review_image" | "review_video" | "return_image" | "return_video";
}

// DTO cho phép customer dọn asset upload dở dang; owner thực tế luôn lấy từ header do Gateway inject.
export class CleanupUploadedReviewMediaDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CleanupUploadedReviewMediaAssetDto)
  assets!: CleanupUploadedReviewMediaAssetDto[];
}
