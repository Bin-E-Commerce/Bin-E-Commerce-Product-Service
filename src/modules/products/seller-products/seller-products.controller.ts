import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import type { Product } from "../../../database/entities/product.entity";
import { CreateSellerProductDto } from "./dto/create-product/create-seller-product.dto";
import { ListSellerProductsQueryDto } from "./dto/list-seller-products-query.dto";
import { SellerProductAccessService } from "./services/seller-product-access.service";
import { SellerProductCreationService } from "./services/seller-product-creation.service";
import { SellerProductsService } from "./services/seller-products.service";
import type { CreateProductResponse } from "./types/create-product-response.type";
import type { SellerProductListResponse } from "./types/seller-product-list-response.type";

// Tách namespace seller khỏi /products/:id để chuỗi "seller" không bị ParseUUIDPipe hiểu nhầm là product ID.
@Controller("seller/products")
export class SellerProductsController {
  constructor(
    private readonly sellerProductAccessService: SellerProductAccessService,
    private readonly sellerProductCreationService: SellerProductCreationService,
    private readonly sellerProductsService: SellerProductsService,
  ) {}

  // Tạo product graph cho đúng shop sở hữu; shopId luôn được backend suy ra từ danh tính đã xác thực.
  @Post()
  createOwnedProduct(
    @Headers() headers: Record<string, unknown>,
    @Body() dto: CreateSellerProductDto,
  ): Promise<CreateProductResponse> {
    const currentUser =
      this.sellerProductAccessService.buildCurrentUserFromHeaders(headers);
    const authorizedUser =
      this.sellerProductAccessService.ensureCanCreateProduct(currentUser);

    return this.sellerProductCreationService.create(authorizedUser, dto);
  }

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

  // Trả chi tiết khi sản phẩm thuộc đúng seller hiện tại; UUID được kiểm tra trước khi truy vấn database.
  @Get(":productId")
  getOwnedProductDetail(
    @Headers() headers: Record<string, unknown>,
    @Param("productId", new ParseUUIDPipe()) productId: string,
  ): Promise<Product> {
    const currentUser =
      this.sellerProductAccessService.buildCurrentUserFromHeaders(headers);
    const authorizedUser =
      this.sellerProductAccessService.ensureCanReadProducts(currentUser);

    return this.sellerProductsService.getOwnedProductById(
      authorizedUser.userId,
      productId,
    );
  }
}
