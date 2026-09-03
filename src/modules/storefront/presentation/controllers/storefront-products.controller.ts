// Controller này công bố API đọc product public và không cho phép thay đổi catalog.
import {
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Query,
} from "@nestjs/common";
import type { PaginatedProductResponse } from "../../../shared/application/types/paginated-product-response.type";
import { ListStorefrontProductsQueryDto } from "../dto/list-storefront-products-query.dto";
import { StorefrontProductsService } from "../../application/services/storefront-products.service";
import type {
  PublicExternalShopResponse,
  ShopCatalogSummary,
  StorefrontProduct,
} from "../../application/services/storefront-products.service";

@Controller("products")
export class StorefrontProductsController {
  constructor(
    private readonly storefrontProductsService: StorefrontProductsService,
  ) {}

  // Trả danh sách sản phẩm cho storefront như trang chủ, tìm kiếm và danh mục công khai.
  @Get()
  listStorefrontProducts(
    @Query() query: ListStorefrontProductsQueryDto,
  ): Promise<PaginatedProductResponse<StorefrontProduct>> {
    return this.storefrontProductsService.listStorefrontProducts(query);
  }

  // Trả summary của riêng shop để header public không phải tải toàn bộ catalog chỉ để đếm sản phẩm và review.
  @Get("shops/:shopId/summary")
  getShopSummary(
    @Param("shopId", ParseUUIDPipe) shopId: string,
  ): Promise<ShopCatalogSummary> {
    return this.storefrontProductsService.getShopSummary(shopId);
  }

  // Đọc shop crawl theo slug nội bộ để customer xem shop và sản phẩm ngay trong Bin E-Commerce.
  @Get("external-shops/:slug")
  getExternalShopBySlug(
    @Param("slug") slug: string,
  ): Promise<PublicExternalShopResponse> {
    return this.storefrontProductsService.getExternalShopBySlug(slug);
  }

  // Trả thống kê catalog của shop crawl theo UUID external_shops, không gọi hoặc redirect tới nền tảng nguồn.
  @Get("external-shops/:shopId/summary")
  getExternalShopSummary(
    @Param("shopId", ParseUUIDPipe) shopId: string,
  ): Promise<ShopCatalogSummary> {
    return this.storefrontProductsService.getExternalShopSummary(shopId);
  }

  // Trả chi tiết sản phẩm công khai theo ID; userId tùy chọn giúp response đánh dấu review hiện tại đã liked hay chưa.
  @Get(":id")
  getStorefrontProductById(
    @Param("id", ParseUUIDPipe) id: string,
    @Headers("x-user-id") userId?: string,
  ): Promise<StorefrontProduct> {
    return this.storefrontProductsService.getStorefrontProductById(id, userId);
  }
}
