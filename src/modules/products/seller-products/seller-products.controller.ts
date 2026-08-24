import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Patch,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import type { Product } from "../../../database/entities/product.entity";
import { CreateSellerProductDto } from "./dto/create-product/create-seller-product.dto";
import { ListSellerProductsQueryDto } from "./dto/queries/list-seller-products-query.dto";
import { UpdateSellerProductDto } from "./dto/update-product/update-seller-product.dto";
import { SellerProductAccessService } from "./services/access/seller-product-access.service";
import { SellerProductCreationService } from "./services/management/seller-product-creation.service";
import { SellerProductUpdateService } from "./services/management/seller-product-update.service";
import { SellerProductDeletionService } from "./services/lifecycle/seller-product-deletion.service";
import { SellerProductStatusService } from "./services/lifecycle/seller-product-status.service";
import { SellerProductsService } from "./services/queries/seller-products.service";
import type { CreateProductResponse } from "./types/create-product-response.type";
import type { SellerProductListResponse } from "./types/seller-product-list-response.type";
import type { UpdateProductResponse } from "./types/update-product-response.type";
import type { DeleteProductResponse } from "./types/delete-product-response.type";
import type { ChangeProductStatusResponse } from "./types/change-product-status-response.type";
import { ChangeSellerProductStatusDto } from "./dto/change-status/change-seller-product-status.dto";

// Tách namespace seller khỏi /products/:id để chuỗi "seller" không bị ParseUUIDPipe hiểu nhầm là product ID.
@Controller("seller/products")
export class SellerProductsController {
  constructor(
    private readonly sellerProductAccessService: SellerProductAccessService,
    private readonly sellerProductCreationService: SellerProductCreationService,
    private readonly sellerProductDeletionService: SellerProductDeletionService,
    private readonly sellerProductStatusService: SellerProductStatusService,
    private readonly sellerProductUpdateService: SellerProductUpdateService,
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

  // Cập nhật toàn bộ product graph sau khi kiểm tra quyền và ownership từ context do Gateway truyền xuống.
  @Put(":productId")
  updateOwnedProduct(
    @Headers() headers: Record<string, unknown>,
    @Param("productId", new ParseUUIDPipe()) productId: string,
    @Body() dto: UpdateSellerProductDto,
  ): Promise<UpdateProductResponse> {
    const currentUser =
      this.sellerProductAccessService.buildCurrentUserFromHeaders(headers);
    const authorizedUser =
      this.sellerProductAccessService.ensureCanUpdateProduct(currentUser);

    return this.sellerProductUpdateService.update(
      authorizedUser,
      productId,
      dto,
    );
  }

  // Xóa mềm sản phẩm thuộc shop sau khi kiểm tra permission và ownership từ context do Gateway truyền xuống.
  @Delete(":productId")
  deleteOwnedProduct(
    @Headers() headers: Record<string, unknown>,
    @Param("productId", new ParseUUIDPipe()) productId: string,
  ): Promise<DeleteProductResponse> {
    const currentUser =
      this.sellerProductAccessService.buildCurrentUserFromHeaders(headers);
    const authorizedUser =
      this.sellerProductAccessService.ensureCanDeleteProduct(currentUser);

    return this.sellerProductDeletionService.delete(authorizedUser, productId);
  }

  // Đổi trạng thái ACTIVE/INACTIVE bằng endpoint riêng để việc bật/tắt không trộn với payload cập nhật nội dung.
  @Patch(":productId/status")
  changeOwnedProductStatus(
    @Headers() headers: Record<string, unknown>,
    @Param("productId", new ParseUUIDPipe()) productId: string,
    @Body() dto: ChangeSellerProductStatusDto,
  ): Promise<ChangeProductStatusResponse> {
    const currentUser =
      this.sellerProductAccessService.buildCurrentUserFromHeaders(headers);
    const authorizedUser =
      this.sellerProductAccessService.ensureCanChangeProductStatus(currentUser);

    return this.sellerProductStatusService.changeStatus(
      authorizedUser,
      productId,
      dto.status,
    );
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
