// Controller này công bố API đọc product public và không cho phép thay đổi catalog.
import {
    Controller,
    Get,
    Headers,
    Param,
    ParseUUIDPipe,
    Query,
} from '@nestjs/common';
import type { PaginatedProductResponse } from '@/modules/shared/application/types/paginated-product-response.type';
import { ListStorefrontProductsQueryDto } from '@/modules/storefront/presentation/dto/list-storefront-products-query.dto';
import { ProductSearchSuggestionsQueryDto } from '@/modules/storefront/presentation/dto/product-search-suggestions-query.dto';
import { StorefrontProductsService } from '@/modules/storefront/application/services/storefront/storefront-products.service';
import type { ProductSearchSuggestion } from '@/modules/storefront/application/types/text-search/product-search-suggestion.type';
import type {
    ShopCatalogSummary,
    StorefrontProduct,
} from '@/modules/storefront/application/services/storefront/storefront-products.service';

@Controller('products')
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

    // Trả autocomplete nhẹ qua Product Service, không gọi qua dữ liệu review/lượt bán từ các service khác.
    @Get('search/suggestions')
    getProductSearchSuggestions(
        @Query() query: ProductSearchSuggestionsQueryDto,
    ): Promise<ProductSearchSuggestion[]> {
        return this.storefrontProductsService.getProductSearchSuggestions(
            query.q,
        );
    }

    // Trả summary của riêng shop để header public không phải tải toàn bộ catalog chỉ để đếm sản phẩm và review.
    @Get('shops/:shopId/summary')
    getShopSummary(
        @Param('shopId', ParseUUIDPipe) shopId: string,
    ): Promise<ShopCatalogSummary> {
        return this.storefrontProductsService.getShopSummary(shopId);
    }

    // Trả chi tiết sản phẩm công khai theo UUID hoặc slug; userId chỉ dùng để đánh dấu review hiện tại đã liked hay chưa.
    @Get(':identifier')
    getStorefrontProductByIdentifier(
        @Param('identifier') identifier: string,
        @Headers('x-user-id') userId?: string,
    ): Promise<StorefrontProduct> {
        return this.storefrontProductsService.getStorefrontProductByIdentifier(
            identifier,
            userId,
        );
    }
}
