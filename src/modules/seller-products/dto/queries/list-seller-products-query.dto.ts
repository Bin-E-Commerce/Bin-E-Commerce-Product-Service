// DTO này chuẩn hóa bộ lọc danh sách product của seller trước khi truy vấn persistence.
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
import { ProductStatus } from "../../../../database/catalog/enums/product-status.enum";
import {
  SellerProductSortBy,
  SellerProductSortOrder,
} from "../../../../database/catalog/enums/seller-product-sort.enum";

export class ListSellerProductsQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().slice(0, 160) : value,
  )
  @IsString()
  search?: string;

  @IsOptional()
  // Chỉ cho phép bốn lifecycle status mà Seller Center có tab/filter tương ứng.
  @IsIn([
    ProductStatus.DRAFT,
    ProductStatus.ACTIVE,
    ProductStatus.INACTIVE,
    ProductStatus.DELETED,
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
