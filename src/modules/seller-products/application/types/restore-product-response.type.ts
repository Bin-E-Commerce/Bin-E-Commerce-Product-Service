// Contract response này mô tả product sau khi seller phục hồi thành công.
import { ProductStatus } from "../../../../database/catalog/enums/product-status.enum";

export interface RestoreProductResponse {
  id: string;
  status: ProductStatus.INACTIVE;
  updatedAt: Date;
}
