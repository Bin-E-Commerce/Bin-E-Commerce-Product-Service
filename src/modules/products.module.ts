// File này đăng ký các module Product, gồm storefront, seller product và checkout inventory.
// Checkout module chỉ thao tác inventory thông qua transaction của Product Service.

import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Brand } from "../database/catalog/entities/brand.entity";
import { ExternalShop } from "../database/catalog/entities/external-shop.entity";
import { Inventory } from "../database/inventory/entities/inventory.entity";
import { ProductAttributeValue } from "../database/catalog/entities/product-attribute-value.entity";
import { ProductImage } from "../database/catalog/entities/product-image.entity";
import { ProductOptionValue } from "../database/catalog/entities/product-option-value.entity";
import { ProductOption } from "../database/catalog/entities/product-option.entity";
import { ProductReview } from "../database/reviews/entities/product-review.entity";
import { ProductReviewLike } from "../database/reviews/entities/product-review-like.entity";
import { ProductVariantOptionValue } from "../database/catalog/entities/product-variant-option-value.entity";
import { ProductVariant } from "../database/catalog/entities/product-variant.entity";
import { Product } from "../database/catalog/entities/product.entity";
import { BrandsController } from "./brands/presentation/controllers/brands.controller";
import { BrandsService } from "./brands/application/services/brands.service";
import { SellerProductsController } from "./seller-products/presentation/controllers/seller-products.controller";
import { InternalProductController } from "./internal/presentation/controllers/internal-product.controller";
import { CatalogClient } from "./seller-products/application/clients/catalog.client";
import { SellerShopClient } from "./seller-products/application/clients/seller-shop.client";
import { ProductMediaClient } from "./seller-products/application/clients/product-media.client";
import { SellerProductAccessService } from "./seller-products/application/services/access/seller-product-access.service";
import { ProductIdentifierService } from "./seller-products/application/services/identity/product-identifier.service";
import { SellerProductCreationService } from "./seller-products/application/services/management/seller-product-creation.service";
import { SellerProductUpdateService } from "./seller-products/application/services/management/seller-product-update.service";
import { SellerProductDeletionService } from "./seller-products/application/services/lifecycle/seller-product-deletion.service";
import { SellerProductRestoreService } from "./seller-products/application/services/lifecycle/seller-product-restore.service";
import { SellerProductStatusService } from "./seller-products/application/services/lifecycle/seller-product-status.service";
import { SellerProductsService } from "./seller-products/application/services/queries/seller-products.service";
import { SellerProductValidatorService } from "./seller-products/application/services/validation/seller-product-validator.service";
import { SellerProductAiMediaService } from "./seller-products/application/services/media/seller-product-ai-media.service";
import { StorefrontProductsController } from "./storefront/presentation/controllers/storefront-products.controller";
import { StorefrontProductsService } from "./storefront/application/services/storefront-products.service";
import { CheckoutModule } from "./checkout-inventory/checkout.module";
import { ProductReviewController } from "./reviews/presentation/controllers/product-review.controller";
import { MyReviewController } from "./reviews/presentation/controllers/my-review.controller";
import { ReviewLikeController } from "./reviews/presentation/controllers/review-like.controller";
import { ProductReviewService } from "./reviews/application/services/product-review.service";
import { OrderReviewClient } from "./reviews/application/clients/order-review.client";
import { ReviewerProfileClient } from "./reviews/application/clients/reviewer-profile.client";
import { ReviewMediaClient } from "./reviews/application/clients/review-media.client";
import { OrderSalesClient } from "./seller-products/application/clients/order-sales.client";

@Module({
  imports: [
    CheckoutModule,
    TypeOrmModule.forFeature([
      Product,
      Brand,
      ExternalShop,
      ProductImage,
      ProductVariant,
      ProductOption,
      ProductOptionValue,
      ProductVariantOptionValue,
      Inventory,
      ProductAttributeValue,
      ProductReview,
      ProductReviewLike,
    ]),
  ],
  controllers: [
    StorefrontProductsController,
    BrandsController,
    SellerProductsController,
    InternalProductController,
    ProductReviewController,
    MyReviewController,
    ReviewLikeController,
  ],
  providers: [
    StorefrontProductsService,
    BrandsService,
    CatalogClient,
    SellerShopClient,
    ProductMediaClient,
    ProductIdentifierService,
    SellerProductAccessService,
    SellerProductCreationService,
    SellerProductDeletionService,
    SellerProductRestoreService,
    SellerProductStatusService,
    SellerProductUpdateService,
    SellerProductValidatorService,
    SellerProductAiMediaService,
    SellerProductsService,
    ProductReviewService,
    OrderReviewClient,
    ReviewerProfileClient,
    ReviewMediaClient,
    OrderSalesClient,
  ],
  exports: [StorefrontProductsService, SellerProductsService],
})
export class ProductsModule {}
