import { Controller, Get, Headers, Query } from "@nestjs/common";
import { ListSellerProductsQueryDto } from "../dto/list-seller-products-query.dto";
import { SellerProductAccessService } from "../services/seller-product-access.service";
import { SellerProductsService } from "../services/seller-products.service";
import type { SellerProductListResponse } from "../types/seller-product-list-response.type";

// Tách namespace seller khỏi /products/:id để chuỗi "seller" không bị ParseUUIDPipe hiểu nhầm là product ID.
@Controller("seller/products")
export class SellerProductsController {
  constructor(
    private readonly sellerProductAccessService: SellerProductAccessService,
    private readonly sellerProductsService: SellerProductsService,
  ) {}

  // Trả danh sách sản phẩm thuộc đúng seller đăng nhập sau khi kiểm tra lại quyền đọc tại service đích.
  @Get()
  listOwnedProducts(
    @Headers() headers: Record<string, unknown>,
    @Query() query: ListSellerProductsQueryDto,
  ): Promise<SellerProductListResponse> {
    const currentUser =
      this.sellerProductAccessService.buildCurrentUserFromHeaders(headers);
    const authorizedUser =
      this.sellerProductAccessService.ensureCanReadProducts(currentUser);

    return this.sellerProductsService.listOwnedProducts(
      authorizedUser.userId,
      query,
    );
  }
}
