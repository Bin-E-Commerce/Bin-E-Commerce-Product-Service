// File này cung cấp review status riêng của user cho màn chi tiết order, không làm lộ review pending của người khác.

import { Controller, Get, Headers, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ProductReviewService } from "../../application/services/product-review.service";

@Controller("reviews")
export class MyReviewController {
  constructor(private readonly reviewService: ProductReviewService) {}

  // Lấy trạng thái review theo orderId; Order Service vẫn là nơi xác minh owner và thời gian giao hàng.
  @Get("me")
  getMine(
    @Headers("x-user-id") userId: string,
    @Query("orderId", new ParseUUIDPipe()) orderId: string,
  ) {
    return this.reviewService.getMine(userId, orderId);
  }
}
