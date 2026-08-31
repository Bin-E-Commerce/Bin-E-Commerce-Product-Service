// Contract response này mô tả kết quả đổi trạng thái product cho API seller.
import { ProductStatus } from "../../../database/catalog/enums/product-status.enum";

export interface ChangeProductStatusResponse {
  id: string;
  status: ProductStatus.ACTIVE | ProductStatus.INACTIVE;
  updatedAt: Date;
}
