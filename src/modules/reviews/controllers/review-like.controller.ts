// File này công bố API like/unlike review public.
// Controller chỉ nhận identity từ Gateway; trạng thái review và unique user/review do service kiểm tra.
import { Controller, Delete, Headers, Param, ParseUUIDPipe, Put } from "@nestjs/common";
import { ProductReviewService } from "../services/product-review.service";

@Controller("reviews")
export class ReviewLikeController {
  constructor(private readonly reviewService: ProductReviewService) {}

  // Gắn like idempotent cho review đã công khai và trả count để UI cập nhật ngay.
  @Put(":reviewId/like")
  like(
    @Headers("x-user-id") userId: string | undefined,
    @Param("reviewId", new ParseUUIDPipe()) reviewId: string,
  ) {
    return this.reviewService.like(userId, reviewId);
  }

  // Xóa like idempotent, không lỗi nếu user đã bỏ like từ trước.
  @Delete(":reviewId/like")
  unlike(
    @Headers("x-user-id") userId: string | undefined,
    @Param("reviewId", new ParseUUIDPipe()) reviewId: string,
  ) {
    return this.reviewService.unlike(userId, reviewId);
  }
}
