// Controller này công bố seller product API; quyền sở hữu và nghiệp vụ được ủy quyền cho application services.
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
import type { Product } from "../../../../database/catalog/entities/product.entity";
import { CreateSellerProductDto } from "../dto/create-product/create-seller-product.dto";
import { ListSellerProductsQueryDto } from "../dto/queries/list-seller-products-query.dto";
import { UpdateSellerProductDto } from "../dto/update-product/update-seller-product.dto";
import { SellerProductAccessService } from "../../application/services/access/seller-product-access.service";
import { SellerProductCreationService } from "../../application/services/management/seller-product-creation.service";
import { SellerProductUpdateService } from "../../application/services/management/seller-product-update.service";
import { SellerProductDeletionService } from "../../application/services/lifecycle/seller-product-deletion.service";
import { SellerProductRestoreService } from "../../application/services/lifecycle/seller-product-restore.service";
import { SellerProductStatusService } from "../../application/services/lifecycle/seller-product-status.service";
import { SellerProductsService } from "../../application/services/queries/seller-products.service";
import type { CreateProductResponse } from "../../application/types/create-product-response.type";
import type { SellerProductListResponse } from "../../application/types/seller-product-list-response.type";
import type { UpdateProductResponse } from "../../application/types/update-product-response.type";
import type { DeleteProductResponse } from "../../application/types/delete-product-response.type";
import type { ChangeProductStatusResponse } from "../../application/types/change-product-status-response.type";
import type { RestoreProductResponse } from "../../application/types/restore-product-response.type";
import { ChangeSellerProductStatusDto } from "../dto/change-status/change-seller-product-status.dto";
import { ApplyAiMediaDto } from "../dto/ai-media/apply-ai-media.dto";
import { SellerProductAiMediaService } from "../../application/services/media/seller-product-ai-media.service";
import type { AiMediaMutationResponse } from "../../application/types/ai-media-response.type";

// Tách namespace seller khỏi /products/:id để chuỗi "seller" không bị ParseUUIDPipe hiểu nhầm là product ID.
@Controller("seller/products")
export class SellerProductsController {
  constructor(
    private readonly sellerProductAccessService: SellerProductAccessService,
    private readonly sellerProductCreationService: SellerProductCreationService,
    private readonly sellerProductDeletionService: SellerProductDeletionService,
    private readonly sellerProductRestoreService: SellerProductRestoreService,
    private readonly sellerProductStatusService: SellerProductStatusService,
    private readonly sellerProductUpdateService: SellerProductUpdateService,
    private readonly sellerProductAiMediaService: SellerProductAiMediaService,
    private readonly sellerProductsService: SellerProductsService,
  ) {}

  // Apply output AI trong Product Service sau khi ownership, permission va optimistic version da duoc xac nhan.
  @Post(":productId/ai-media/apply")
  applyAiMedia(
    @Headers() headers: Record<string, unknown>,
    @Param("productId", new ParseUUIDPipe()) productId: string,
    @Body() dto: ApplyAiMediaDto,
  ): Promise<AiMediaMutationResponse> {
    const currentUser = this.sellerProductAccessService.buildCurrentUserFromHeaders(headers);
    const authorizedUser = this.sellerProductAccessService.ensureCanApplyAiImage(currentUser);
    return this.sellerProductAiMediaService.apply(authorizedUser, productId, dto);
  }

  // Rollback snapshot anh goc trong transaction de output AI khong lam mat du lieu seller.
  @Post(":productId/ai-media/rollback")
  rollbackAiMedia(
    @Headers() headers: Record<string, unknown>,
    @Param("productId", new ParseUUIDPipe()) productId: string,
    @Body("jobId", new ParseUUIDPipe()) jobId: string,
  ): Promise<AiMediaMutationResponse> {
    const currentUser = this.sellerProductAccessService.buildCurrentUserFromHeaders(headers);
    const authorizedUser = this.sellerProductAccessService.ensureCanRollbackAiImage(currentUser);
    return this.sellerProductAiMediaService.rollback(authorizedUser, productId, jobId);
  }

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

  // Khôi phục product đã xóa mềm về INACTIVE sau khi kiểm tra permission và ownership.
  @Post(":productId/restore")
  restoreOwnedProduct(
    @Headers() headers: Record<string, unknown>,
    @Param("productId", new ParseUUIDPipe()) productId: string,
  ): Promise<RestoreProductResponse> {
    const currentUser =
      this.sellerProductAccessService.buildCurrentUserFromHeaders(headers);
    const authorizedUser =
      this.sellerProductAccessService.ensureCanRestoreProduct(currentUser);

    return this.sellerProductRestoreService.restore(authorizedUser, productId);
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
