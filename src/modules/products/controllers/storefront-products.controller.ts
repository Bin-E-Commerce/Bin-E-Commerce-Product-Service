import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { Product } from "../../../database/entities/product.entity";
import { ListStorefrontProductsQueryDto } from "../dto/list-storefront-products-query.dto";
import { StorefrontProductsService } from "../services/storefront-products.service";
import type { PaginatedProductResponse } from "../types/paginated-product-response.type";

@Controller("products")
export class StorefrontProductsController {
  constructor(
    private readonly storefrontProductsService: StorefrontProductsService,
  ) {}

  // Trả danh sách sản phẩm cho storefront như trang chủ, tìm kiếm và danh mục công khai.
  @Get()
  listStorefrontProducts(
    @Query() query: ListStorefrontProductsQueryDto,
  ): Promise<PaginatedProductResponse<Product>> {
    return this.storefrontProductsService.listStorefrontProducts(query);
  }

  // Trả chi tiết sản phẩm công khai theo ID, kèm quan hệ cần cho trang product detail.
  @Get(":id")
  getStorefrontProductById(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<Product> {
    return this.storefrontProductsService.getStorefrontProductById(id);
  }
}
