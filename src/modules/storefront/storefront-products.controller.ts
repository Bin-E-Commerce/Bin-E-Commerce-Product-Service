// Controller này công bố API đọc product public và không cho phép thay đổi catalog.
import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { Product } from "../../database/catalog/entities/product.entity";
import type { PaginatedProductResponse } from "../shared/types/paginated-product-response.type";
import { ListStorefrontProductsQueryDto } from "./dto/list-storefront-products-query.dto";
import { StorefrontProductsService } from "./storefront-products.service";

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
