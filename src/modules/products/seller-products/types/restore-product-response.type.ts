import { ProductStatus } from "../../shared/enums/product-status.enum";

export interface RestoreProductResponse {
  id: string;
  status: ProductStatus.INACTIVE;
  updatedAt: Date;
}
