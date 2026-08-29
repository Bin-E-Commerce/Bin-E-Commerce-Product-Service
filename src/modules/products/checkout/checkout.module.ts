// File này đóng gói inventory checkout contract và không làm thay đổi các seller product use case.

import { Module } from "@nestjs/common";
import { CheckoutInventoryController } from "./controllers/checkout-inventory.controller";
import { CheckoutInventoryService } from "./services/checkout-inventory.service";
import { InternalServiceGuard } from "./guards/internal-service.guard";

// ProductModule import module này để expose internal endpoint cùng database transaction hiện tại.
@Module({
  controllers: [CheckoutInventoryController],
  providers: [CheckoutInventoryService, InternalServiceGuard],
})
export class CheckoutModule {}
