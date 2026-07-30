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
import { SellerProductsController } from "./controllers/seller-products.controller";
import { StorefrontProductsController } from "./controllers/storefront-products.controller";
import { SellerProductsService } from "./services/seller-products.service";
import { StorefrontProductsService } from "./services/storefront-products.service";

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
  controllers: [StorefrontProductsController, SellerProductsController],
  providers: [StorefrontProductsService, SellerProductsService],
  exports: [StorefrontProductsService, SellerProductsService],
})
export class ProductsModule {}
