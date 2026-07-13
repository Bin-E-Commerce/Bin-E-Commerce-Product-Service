import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { Product } from "../../../database/entities/product.entity";
import { ListProductsQueryDto } from "../dto/list-products-query.dto";
import { ProductsService } from "../services/products.service";
import type { PaginatedResponse } from "../types/paginated-response.type";

@Controller("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // Trả danh sách product để kiểm tra dữ liệu import và phục vụ listing public sau này.
  @Get()
  listProducts(
    @Query() query: ListProductsQueryDto,
  ): Promise<PaginatedResponse<Product>> {
    return this.productsService.listProducts(query);
  }

  // Trả chi tiết product theo id, kèm quan hệ cần thiết cho màn hình product detail.
  @Get(":id")
  getProductById(@Param("id", ParseUUIDPipe) id: string): Promise<Product> {
    return this.productsService.getProductById(id);
  }
}
