// Contract response này mô tả product vừa được seller tạo thành công.
import { ProductStatus } from "../../../../database/catalog/enums/product-status.enum";

export interface CreateProductResponse {
  id: string;
  slug: string;
  status: ProductStatus;
  createdAt: Date;
}
