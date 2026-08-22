import { ProductStatus } from "../../shared/enums/product-status.enum";

export interface CreateProductResponse {
  id: string;
  slug: string;
  status: ProductStatus;
  createdAt: Date;
}
