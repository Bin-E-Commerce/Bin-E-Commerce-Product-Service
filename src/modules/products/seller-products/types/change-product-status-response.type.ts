import { ProductStatus } from "../../shared/enums/product-status.enum";

export interface ChangeProductStatusResponse {
  id: string;
  status: ProductStatus.ACTIVE | ProductStatus.INACTIVE;
  updatedAt: Date;
}
