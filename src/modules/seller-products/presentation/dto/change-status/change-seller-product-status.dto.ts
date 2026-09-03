// DTO này xác thực trạng thái đích khi seller thay đổi lifecycle của product.
import { IsIn } from "class-validator";
import { ProductStatus } from "../../../../../database/catalog/enums/product-status.enum";

// Chỉ cho phép hai trạng thái vận hành nhanh; DRAFT và DELETED phải đi qua lifecycle riêng.
const SELLER_PRODUCT_PUBLICATION_STATUSES = [
  ProductStatus.ACTIVE,
  ProductStatus.INACTIVE,
] as const;

export class ChangeSellerProductStatusDto {
  @IsIn(SELLER_PRODUCT_PUBLICATION_STATUSES)
  status: (typeof SELLER_PRODUCT_PUBLICATION_STATUSES)[number];
}
