import type { ProductMediaReference } from "../types/product-media-reference.type";

const PRODUCT_MEDIA_PATH_PATTERN =
  /\/(?:media\/processed|uploads\/original)\/(product_image|product_video)\/[^/]+\/([0-9a-f-]{36})(?:\/|$)/i;

// Trích asset ID từ URL CDN do Media Service phát hành; URL ngoài format này sẽ bị bỏ qua để tránh xóa nhầm object.
export function parseProductMediaReference(
  mediaUrl: string | null | undefined,
  expectedPurpose?: ProductMediaReference["purpose"],
): ProductMediaReference | null {
  if (!mediaUrl) return null;

  let path: string;
  try {
    path = new URL(mediaUrl).pathname;
  } catch {
    return null;
  }

  const match = PRODUCT_MEDIA_PATH_PATTERN.exec(path);
  if (!match) return null;

  const purpose = match[1]!.toLowerCase() as ProductMediaReference["purpose"];
  if (expectedPurpose && purpose !== expectedPurpose) return null;

  return { assetId: match[2]!.toLowerCase(), purpose };
}

// Khử trùng asset trước khi gửi cleanup để một asset chỉ bị list/delete một lần.
export function uniqueProductMediaReferences(
  references: Array<ProductMediaReference | null>,
): ProductMediaReference[] {
  return Array.from(
    new Map(
      references.filter((reference): reference is ProductMediaReference => reference !== null)
        .map((reference) => [`${reference.purpose}:${reference.assetId}`, reference]),
    ).values(),
  );
}
