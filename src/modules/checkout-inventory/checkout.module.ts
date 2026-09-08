// File này đóng gói inventory checkout contract và không làm thay đổi các seller product use case.

import { Module } from "@nestjs/common";
import { CheckoutInventoryController } from "./presentation/controllers/checkout-inventory.controller";
import { CheckoutInventoryService } from "./application/services/checkout-inventory.service";
import { InternalServiceGuard } from "./presentation/guards/internal-service.guard";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CheckoutReservation } from "../../database/checkout/entities/checkout-reservation.entity";
import { Product } from "../../database/catalog/entities/product.entity";
import { ProductVariant } from "../../database/catalog/entities/product-variant.entity";
import { CatalogEventPublisherService } from "../seller-products/application/services/events/catalog-event-publisher.service";
import { CatalogEventOutboxEntity } from "../../database/integration/entities/catalog-event-outbox.entity";

// ProductModule import module này để expose internal endpoint cùng database transaction hiện tại.
@Module({
  imports: [
    TypeOrmModule.forFeature([CheckoutReservation, Product, ProductVariant, CatalogEventOutboxEntity]),
  ],
  controllers: [CheckoutInventoryController],
  providers: [
    CheckoutInventoryService,
    InternalServiceGuard,
    CatalogEventPublisherService,
  ],
  exports: [InternalServiceGuard, CatalogEventPublisherService],
})
export class CheckoutModule {}
