import { ProductStatus } from "../../shared/enums/product-status.enum";

export interface DeleteProductResponse {
  id: string;
  status: ProductStatus.DELETED;
  updatedAt: Date;
}
