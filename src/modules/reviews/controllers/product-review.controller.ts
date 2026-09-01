// File này công bố endpoint review customer; authorization ownership nằm trong service qua purchase proof từ Order Service.

import { Body, Controller, Headers, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { CreateProductReviewDto, UpdateProductReviewDto } from "../dto/create-product-review.dto";
import { CleanupUploadedReviewMediaDto } from "../dto/cleanup-uploaded-review-media.dto";
import { ProductReviewService } from "../services/product-review.service";

@Controller("products")
export class ProductReviewController {
  constructor(private readonly reviewService: ProductReviewService) {}

  // Nhận review theo productId trên URL và userId do API Gateway inject vào header.
  @Post(":productId/reviews")
  create(
    @Headers("x-user-id") userId: string,
    @Headers("x-user-name") reviewerName: string | undefined,
    @Headers("x-user-avatar-url") reviewerAvatarUrl: string | undefined,
    @Param("productId", new ParseUUIDPipe()) productId: string,
    @Body() dto: CreateProductReviewDto,
  ) {
    return this.reviewService.create(userId, productId, dto, reviewerName, reviewerAvatarUrl);
  }

  // Nhận nội dung review đã chỉnh sửa; ProductReviewService tự kiểm tra owner và hạn đánh giá.
  @Patch("reviews/:reviewId")
  update(
    @Headers("x-user-id") userId: string,
    @Param("reviewId", new ParseUUIDPipe()) reviewId: string,
    @Body() dto: UpdateProductReviewDto,
  ) {
    return this.reviewService.update(userId, reviewId, dto);
  }

  // Nhận asset upload dở dang từ frontend; service sẽ bỏ qua asset còn được review khác tham chiếu.
  @Post("reviews/media/cleanup")
  cleanupUploadedMedia(
    @Headers("x-user-id") userId: string,
    @Body() dto: CleanupUploadedReviewMediaDto,
  ): Promise<void> {
    return this.reviewService.cleanupUploadedMedia(userId, dto);
  }
}
