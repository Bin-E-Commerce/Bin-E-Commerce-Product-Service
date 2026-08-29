// File này công bố contract reserve/release nội bộ cho Order Service, không mở ra Gateway.

import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { CheckoutInventoryService } from "../services/checkout-inventory.service";
import { InternalServiceGuard } from "../guards/internal-service.guard";
import { ReleaseCheckoutDto, ReserveCheckoutDto } from "../dto/checkout-reservation.dto";

// Mọi thay đổi inventory từ checkout đều phải qua shared internal token.
@Controller("internal/checkout")
@UseGuards(InternalServiceGuard)
export class CheckoutInventoryController {
  constructor(private readonly checkoutInventoryService: CheckoutInventoryService) {}

  // Revalidate giá/trạng thái và giữ stock trước khi Order Service tạo snapshot order.
  @Post("reserve")
  reserve(@Body() dto: ReserveCheckoutDto) {
    return this.checkoutInventoryService.reserve(dto);
  }

  // Compensation trả stock khi persistence Order thất bại.
  @Post("release")
  release(@Body() dto: ReleaseCheckoutDto) {
    return this.checkoutInventoryService.release(dto);
  }
}
