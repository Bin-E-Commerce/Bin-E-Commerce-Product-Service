// Hợp đồng purpose media mà Product Service được phép tham chiếu khi cleanup asset upload dở dang.
export type ReviewMediaPurpose = "review_image" | "review_video" | "return_image" | "return_video";

export interface ReviewMediaReference {
  assetId: string;
  ownerId: string;
  purpose: ReviewMediaPurpose;
}
