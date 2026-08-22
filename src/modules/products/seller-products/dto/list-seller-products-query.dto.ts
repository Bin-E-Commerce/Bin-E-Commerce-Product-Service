import { Transform } from "class-transformer";
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { ProductStatus } from "../../shared/enums/product-status.enum";
import {
  SellerProductSortBy,
  SellerProductSortOrder,
} from "../enums/seller-product-sort.enum";

export class ListSellerProductsQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().slice(0, 160) : value,
  )
  @IsString()
  search?: string;

  @IsOptional()
  // Seller Center không hiển thị bản ghi đã xóa; reject ngay từ DTO để FE không nhận kết quả khác với filter đã gửi.
  @IsIn([
    ProductStatus.DRAFT,
    ProductStatus.ACTIVE,
    ProductStatus.INACTIVE,
  ])
  status?: ProductStatus;

  @IsOptional()
  @IsEnum(SellerProductSortBy)
  sortBy: SellerProductSortBy = SellerProductSortBy.UPDATED_AT;

  @IsOptional()
  @IsEnum(SellerProductSortOrder)
  sortOrder: SellerProductSortOrder = SellerProductSortOrder.DESC;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
