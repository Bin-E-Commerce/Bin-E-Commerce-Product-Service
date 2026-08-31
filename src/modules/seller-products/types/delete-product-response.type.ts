// Contract response này mô tả kết quả soft-delete product của seller.
import { ProductStatus } from "../../../database/catalog/enums/product-status.enum";

export interface DeleteProductResponse {
  id: string;
  status: ProductStatus.DELETED;
  updatedAt: Date;
}
