import { Controller, Get, Query } from "@nestjs/common";
import { Brand } from "../../../database/entities/brand.entity";
import type { PaginatedProductResponse } from "../shared/types/paginated-product-response.type";
import { BrandsService } from "./brands.service";
import { ListBrandsQueryDto } from "./dto/list-brands-query.dto";

@Controller("brands")
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  // Endpoint công khai phục vụ tìm thương hiệu khi seller tạo sản phẩm và storefront lọc theo brand.
  @Get()
  listBrands(
    @Query() query: ListBrandsQueryDto,
  ): Promise<PaginatedProductResponse<Brand>> {
    return this.brandsService.list(query);
  }
}
