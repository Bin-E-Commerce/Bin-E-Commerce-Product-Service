// Contract response này là read model phân trang product dành riêng cho seller.
import { ProductStatus } from "../../../database/catalog/enums/product-status.enum";

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
  deletedAt: Date | null;
  aiOptimizationStatus: string | null;
}

export interface SellerProductSummary {
  total: number;
  active: number;
  draft: number;
  inactive: number;
  outOfStock: number;
  deleted: number;
}

export interface SellerProductListResponse {
  items: SellerProductListItem[];
  summary: SellerProductSummary;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
