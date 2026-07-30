import { Controller, Get, Headers, Query } from "@nestjs/common";
import { ListSellerProductsQueryDto } from "../dto/list-seller-products-query.dto";
import { SellerProductsService } from "../services/seller-products.service";
import type { SellerProductListResponse } from "../types/seller-product-list-response.type";

// Tách namespace seller khỏi /products/:id để chuỗi "seller" không bị ParseUUIDPipe hiểu nhầm là product ID.
@Controller("seller/products")
export class SellerProductsController {
  constructor(
    private readonly sellerProductsService: SellerProductsService,
  ) {}

  // Trả danh sách sản phẩm thuộc đúng seller đăng nhập; user ID do API Gateway lấy từ JWT và inject vào header nội bộ.
  @Get()
  listOwnedProducts(
    @Headers("x-user-id") sellerOwnerId: string | undefined,
    @Query() query: ListSellerProductsQueryDto,
  ): Promise<SellerProductListResponse> {
    return this.sellerProductsService.listOwnedProducts(sellerOwnerId, query);
  }
}
