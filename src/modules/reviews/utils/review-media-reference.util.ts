// File này phân tích URL media do Media Service phát hành để cleanup đúng owner và purpose.
// Chỉ nhận media review và bằng chứng hoàn hàng; không nhận purpose settlement đã loại bỏ.

import type {
  ReviewMediaPurpose,
  ReviewMediaReference,
} from "../types/review-media-reference.type";

const REVIEW_MEDIA_PATH_PATTERN =
  /\/(?:media\/processed|uploads\/original)\/(review_image|review_video|return_image|return_video)\/([^/]+)\/([0-9a-f-]{36})(?:\/|$)/i;

// Trích asset ID và owner từ URL CDN do Media Service phát hành để Product Service chỉ cleanup đúng media review của user.
export function parseReviewMediaReference(
  mediaUrl: string | null | undefined,
  expectedPurpose?: ReviewMediaPurpose,
): ReviewMediaReference | null {
  if (!mediaUrl) return null;

  let path: string;
  try {
    path = new URL(mediaUrl).pathname;
  } catch {
    return null;
  }

  const match = REVIEW_MEDIA_PATH_PATTERN.exec(path);
  if (!match) return null;

  const purpose = match[1]!.toLowerCase() as ReviewMediaPurpose;
  if (expectedPurpose && purpose !== expectedPurpose) return null;

  return {
    purpose,
    ownerId: match[2]!,
    assetId: match[3]!.toLowerCase(),
  };
}

// Loại bỏ asset trùng trước khi gửi cleanup để một object chỉ bị list/delete một lần.
export function uniqueReviewMediaReferences(
  references: ReviewMediaReference[],
): ReviewMediaReference[] {
  return Array.from(
    new Map(
      references.map((reference) => [
        `${reference.purpose}:${reference.assetId}`,
        reference,
      ]),
    ).values(),
  );
}
