export type ReviewMediaPurpose = "review_image" | "review_video";

export interface ReviewMediaReference {
  assetId: string;
  ownerId: string;
  purpose: ReviewMediaPurpose;
}
