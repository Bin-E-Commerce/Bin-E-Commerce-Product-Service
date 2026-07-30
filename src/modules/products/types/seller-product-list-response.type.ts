import { ProductStatus } from "../enums/product-status.enum";

export interface SellerProductListItem {
  id: string;
  name: string;
  slug: string;
  thumbnailUrl: string | null;
  status: ProductStatus;
  minPrice: string;
  maxPrice: string;
  totalStock: number;
  variantCount: number;
  primarySku: string | null;
  totalSold: number;
  ratingAvg: string | null;
  reviewCount: number;
  updatedAt: Date;
}

export interface SellerProductSummary {
  total: number;
  active: number;
  draft: number;
  inactive: number;
  outOfStock: number;
}

export interface SellerProductListResponse {
  items: SellerProductListItem[];
  summary: SellerProductSummary;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
