export interface ProductMediaReference {
  assetId: string;
  purpose: ProductMediaCleanupPurpose;
}

export type ProductMediaCleanupPurpose = "product_image" | "product_video";
