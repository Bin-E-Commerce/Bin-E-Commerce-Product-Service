import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Brand } from "../../database/entities/brand.entity";
import { ExternalShop } from "../../database/entities/external-shop.entity";
import { Inventory } from "../../database/entities/inventory.entity";
import { ProductAttributeValue } from "../../database/entities/product-attribute-value.entity";
import { ProductImage } from "../../database/entities/product-image.entity";
import { ProductOptionValue } from "../../database/entities/product-option-value.entity";
import { ProductOption } from "../../database/entities/product-option.entity";
import { ProductReview } from "../../database/entities/product-review.entity";
import { ProductVariantOptionValue } from "../../database/entities/product-variant-option-value.entity";
import { ProductVariant } from "../../database/entities/product-variant.entity";
import { Product } from "../../database/entities/product.entity";
import { BrandsController } from "./brands/brands.controller";
import { BrandsService } from "./brands/brands.service";
import { SellerProductsController } from "./seller-products/seller-products.controller";
import { CatalogClient } from "./seller-products/integrations/catalog.client";
import { SellerShopClient } from "./seller-products/integrations/seller-shop.client";
import { ProductMediaClient } from "./seller-products/integrations/product-media.client";
import { ProductIdentifierService } from "./seller-products/services/product-identifier.service";
import { SellerProductAccessService } from "./seller-products/services/seller-product-access.service";
import { SellerProductCreationService } from "./seller-products/services/seller-product-creation.service";
import { SellerProductUpdateService } from "./seller-products/services/seller-product-update.service";
import { SellerProductValidatorService } from "./seller-products/services/seller-product-validator.service";
import { SellerProductsService } from "./seller-products/services/seller-products.service";
import { StorefrontProductsController } from "./storefront/storefront-products.controller";
import { StorefrontProductsService } from "./storefront/storefront-products.service";

@Module({
  imports: [
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
    ]),
  ],
  controllers: [
    StorefrontProductsController,
    BrandsController,
    SellerProductsController,
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
    SellerProductUpdateService,
    SellerProductValidatorService,
    SellerProductsService,
  ],
  exports: [StorefrontProductsService, SellerProductsService],
})
export class ProductsModule {}
