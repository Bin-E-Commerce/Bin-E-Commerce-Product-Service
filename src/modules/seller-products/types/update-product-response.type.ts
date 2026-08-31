// Contract response này mô tả product sau khi seller cập nhật thành công.
import { ProductStatus } from "../../../database/catalog/enums/product-status.enum";

export interface UpdateProductResponse {
  id: string;
  slug: string;
  status: ProductStatus;
  updatedAt: Date;
}
