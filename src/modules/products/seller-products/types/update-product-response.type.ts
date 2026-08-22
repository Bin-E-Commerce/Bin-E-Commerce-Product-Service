import { ProductStatus } from "../../shared/enums/product-status.enum";

export interface UpdateProductResponse {
  id: string;
  slug: string;
  status: ProductStatus;
  updatedAt: Date;
}
