// File này điều phối review customer: xác minh đơn, chống review trùng, xuất bản review verified và like.
// Service không cho browser tự gửi userId/orderId; Product và purchase proof phải khớp dữ liệu server.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";
import {
  ReviewEvents,
  type ReviewCreatedEvent,
  type ReviewUpdatedEvent,
} from "@common/kafka/events";
import { ProductReview } from "../../../../database/reviews/entities/product-review.entity";
import { ProductReviewLike } from "../../../../database/reviews/entities/product-review-like.entity";
import {
  CreateProductReviewDto,
  UpdateProductReviewDto,
} from "../../presentation/dto/create-product-review.dto";
import { OrderReviewClient } from "../clients/order-review.client";
import { ReviewMediaClient } from "../clients/review-media.client";
import { KafkaProducerService } from "../../../../kafka/kafka-producer.service";
import type { ReviewItemProof } from "../types/review-order-context.type";
import type {
  ReviewMediaPurpose,
  ReviewMediaReference,
} from "../types/review-media-reference.type";
import {
  parseReviewMediaReference,
  uniqueReviewMediaReferences,
} from "../utils/review-media-reference.util";
import type { CleanupUploadedReviewMediaDto } from "../../presentation/dto/cleanup-uploaded-review-media.dto";

@Injectable()
export class ProductReviewService {
  private readonly logger = new Logger(ProductReviewService.name);

  constructor(
    @InjectRepository(ProductReview)
    private readonly reviews: Repository<ProductReview>,
    @InjectRepository(ProductReviewLike)
    private readonly likes: Repository<ProductReviewLike>,
    private readonly orderReviewClient: OrderReviewClient,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly reviewMediaClient: ReviewMediaClient,
  ) {}

  // Tạo review verified purchase sau khi Order Service xác minh item thuộc user và còn trong cửa sổ 30 ngày.
  // Review được approved ngay vì đây là đánh giá từ giao dịch thật và hệ thống hiện chưa có moderation queue.
  // userId/orderId/productId không lấy từ body; điều này ngăn customer giả mạo giao dịch hoặc đánh giá sản phẩm khác.
  async create(
    userId: string,
    productId: string,
    dto: CreateProductReviewDto,
    reviewerName?: string,
    reviewerAvatarUrl?: string,
  ): Promise<ProductReview> {
    const proof = await this.orderReviewClient.getItemProof(dto.orderItemId);
    this.assertReviewEligibility(proof, userId, productId);

    const uploadedMedia = this.parseReviewMediaUrls(
      dto.images ?? [],
      userId,
      "review_image",
    ).concat(
      this.parseReviewMediaUrls(dto.videos ?? [], userId, "review_video"),
    );

    const existing = await this.reviews.findOne({
      where: { orderItemId: dto.orderItemId },
    });
    if (existing) {
      await this.cleanupUnreferencedReviewMedia(
        userId,
        uploadedMedia,
        existing.id,
      );
      throw new ConflictException("Bạn đã đánh giá sản phẩm này rồi.");
    }

    const review = this.reviews.create({
      userId,
      reviewerName: reviewerName?.trim() || null,
      reviewerAvatarUrl: reviewerAvatarUrl?.trim() || null,
      isAnonymous: dto.isAnonymous ?? false,
      productId,
      variantId: proof.variantId,
      orderId: proof.orderId,
      orderItemId: proof.orderItemId,
      rating: dto.rating,
      title: dto.title?.trim() || null,
      content: dto.content?.trim() || null,
      images: dto.images ?? [],
      videos: dto.videos ?? [],
      status: "approved",
      sourcePlatform: null,
      externalReviewId: null,
    });
    let savedReview: ProductReview;
    try {
      savedReview = await this.reviews.save(review);
    } catch (error) {
      await this.cleanupUnreferencedReviewMedia(userId, uploadedMedia);
      // Unique index vẫn là lớp bảo vệ cuối cùng khi hai request review chạy đồng thời cho cùng order item.
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === "23505"
      ) {
        throw new ConflictException("Bạn đã đánh giá sản phẩm này rồi.");
      }
      throw error;
    }

    await this.publishReviewEvent(
      savedReview,
      proof,
      userId,
      ReviewEvents.CREATED,
    );
    return savedReview;
  }

  // Chỉnh sửa review theo đúng review identity; service không nhận productId hoặc orderId từ body để không cho đổi giao dịch gốc.
  async update(
    userId: string,
    reviewId: string,
    dto: UpdateProductReviewDto,
  ): Promise<ProductReview> {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException(
        "Cần có ít nhất một trường để cập nhật đánh giá.",
      );
    }
    const review = await this.reviews.findOne({ where: { id: reviewId } });
    if (!review) throw new NotFoundException("Không tìm thấy đánh giá.");
    if (review.userId !== userId) {
      throw new ForbiddenException(
        "Bạn chỉ có thể chỉnh sửa đánh giá của mình.",
      );
    }
    if (!review.orderItemId || review.status.toLowerCase() !== "approved") {
      throw new ForbiddenException("Đánh giá này không thể chỉnh sửa.");
    }

    const proof = await this.orderReviewClient.getItemProof(review.orderItemId);
    this.assertReviewEligibility(proof, userId, review.productId);

    const addedMedia = this.collectAddedReviewMedia(review, dto, userId);
    const removedMedia = this.collectRemovedReviewMedia(review, dto, userId);

    // Undefined giữ nguyên dữ liệu cũ; chuỗi rỗng được chuyển thành null để Customer có thể xóa tiêu đề hoặc nội dung.
    if (dto.rating !== undefined) review.rating = dto.rating;
    if (dto.title !== undefined) review.title = dto.title.trim() || null;
    if (dto.content !== undefined) review.content = dto.content.trim() || null;
    if (dto.images !== undefined) review.images = dto.images;
    if (dto.videos !== undefined) review.videos = dto.videos;
    if (dto.isAnonymous !== undefined) review.isAnonymous = dto.isAnonymous;

    let savedReview: ProductReview;
    try {
      savedReview = await this.reviews.save(review);
    } catch (error) {
      await this.cleanupUnreferencedReviewMedia(userId, addedMedia, review.id);
      throw error;
    }
    await this.cleanupUnreferencedReviewMedia(userId, removedMedia, review.id);
    await this.publishReviewEvent(
      savedReview,
      proof,
      userId,
      ReviewEvents.UPDATED,
    );
    return savedReview;
  }

  // Dọn các asset vừa upload nhưng không còn được gắn vào review khi request cleanup từ frontend thất bại giữa chừng.
  async cleanupUploadedMedia(
    userId: string,
    dto: CleanupUploadedReviewMediaDto,
  ): Promise<void> {
    const references = uniqueReviewMediaReferences(
      dto.assets.map((asset) => ({
        assetId: asset.assetId.toLowerCase(),
        ownerId: userId,
        purpose: asset.purpose,
      })),
    );
    const safeReferences = await this.filterReferencedReviewMedia(
      userId,
      references,
    );
    await this.reviewMediaClient.cleanupReviewAssets(userId, safeReferences);
  }

  // Trả trạng thái review theo order để UI hiển thị CTA “Đánh giá ngay” hoặc “Đã gửi đánh giá” cho từng item.
  async getMine(userId: string, orderId: string) {
    const context = await this.orderReviewClient.getOrderContext(
      orderId,
      userId,
    );
    const reviews = await this.reviews.find({ where: { orderId, userId } });
    const reviewByItem = new Map(
      reviews
        .filter((review) => review.orderItemId)
        .map((review) => [review.orderItemId!, review]),
    );
    // Cùng một cửa sổ thời gian điều khiển cả CTA review mới và nút chỉnh sửa, tránh hai trạng thái lệch nhau trên UI.
    const reviewWindowOpen =
      ["DELIVERED", "COMPLETED"].includes(context.fulfillmentStatus) &&
      !context.hasOpenDeliveryIssue &&
      (!context.reviewDeadline ||
        new Date(context.reviewDeadline) >= new Date());
    return {
      orderId,
      canReview: reviewWindowOpen,
      reviewDeadline: context.reviewDeadline,
      items: context.items.map((item) => {
        const review = reviewByItem.get(item.orderItemId);
        const canEdit =
          Boolean(review) &&
          review?.status.toLowerCase() === "approved" &&
          reviewWindowOpen;
        return {
          ...item,
          canReview: !review && reviewWindowOpen,
          canEdit,
          review: review
            ? {
                id: review.id,
                rating: review.rating,
                status: review.status,
                title: review.title,
                content: review.content,
                images: review.images ?? [],
                videos: review.videos ?? [],
                isAnonymous: review.isAnonymous ?? false,
                createdAt: review.createdAt,
                updatedAt: review.updatedAt,
              }
            : null,
        };
      }),
    };
  }

  // Bảo vệ chung cho create và update: purchase proof phải khớp user, sản phẩm và thời hạn đánh giá.
  private assertReviewEligibility(
    proof: ReviewItemProof,
    userId: string,
    productId: string,
  ): void {
    if (proof.ownerId !== userId || proof.productId !== productId) {
      throw new ForbiddenException("Bạn chỉ có thể đánh giá sản phẩm đã mua.");
    }
    if (
      !["DELIVERED", "COMPLETED"].includes(proof.fulfillmentStatus) ||
      proof.hasOpenDeliveryIssue
    ) {
      throw new ForbiddenException("Đơn hàng chưa đủ điều kiện đánh giá.");
    }
    if (proof.deliveryConfirmationStatus === "ISSUE_REPORTED") {
      throw new ForbiddenException(
        "Vui lòng xử lý vấn đề đơn hàng trước khi đánh giá.",
      );
    }
    if (proof.reviewDeadline && new Date(proof.reviewDeadline) < new Date()) {
      throw new ForbiddenException("Thời hạn đánh giá sản phẩm đã hết.");
    }
  }

  // Chuyển URL CDN về asset reference có owner/purpose để không bao giờ gửi S3 key tùy ý xuống Media Service.
  private parseReviewMediaUrls(
    mediaUrls: string[],
    userId: string,
    expectedPurpose: ReviewMediaPurpose,
  ): ReviewMediaReference[] {
    const references = mediaUrls.map((mediaUrl) =>
      parseReviewMediaReference(mediaUrl, expectedPurpose),
    );
    if (
      references.some((reference) => !reference || reference.ownerId !== userId)
    ) {
      throw new BadRequestException("Ảnh hoặc video đánh giá không hợp lệ.");
    }

    const uniqueReferences = uniqueReviewMediaReferences(
      references as ReviewMediaReference[],
    );
    if (uniqueReferences.length !== mediaUrls.length) {
      throw new BadRequestException("Ảnh hoặc video đánh giá bị trùng.");
    }
    return uniqueReferences;
  }

  // Tính phần media bị loại khỏi payload mới; field không truyền lên được hiểu là giữ nguyên media cũ.
  private collectRemovedReviewMedia(
    review: ProductReview,
    dto: UpdateProductReviewDto,
    userId: string,
  ): ReviewMediaReference[] {
    const oldReferences = [
      ...this.parseStoredReviewMedia(
        review.images ?? [],
        "review_image",
        userId,
      ),
      ...this.parseStoredReviewMedia(
        review.videos ?? [],
        "review_video",
        userId,
      ),
    ];
    const nextReferences = [
      ...(dto.images === undefined
        ? this.parseStoredReviewMedia(
            review.images ?? [],
            "review_image",
            userId,
          )
        : this.parseReviewMediaUrls(dto.images, userId, "review_image")),
      ...(dto.videos === undefined
        ? this.parseStoredReviewMedia(
            review.videos ?? [],
            "review_video",
            userId,
          )
        : this.parseReviewMediaUrls(dto.videos, userId, "review_video")),
    ];
    const nextKeys = new Set(
      nextReferences.map((reference) => this.reviewMediaKey(reference)),
    );
    return oldReferences.filter(
      (reference) => !nextKeys.has(this.reviewMediaKey(reference)),
    );
  }

  // Tìm media mới được thêm trong payload để dọn riêng khi thao tác lưu review bị lỗi.
  private collectAddedReviewMedia(
    review: ProductReview,
    dto: UpdateProductReviewDto,
    userId: string,
  ): ReviewMediaReference[] {
    const oldReferences = [
      ...this.parseStoredReviewMedia(
        review.images ?? [],
        "review_image",
        userId,
      ),
      ...this.parseStoredReviewMedia(
        review.videos ?? [],
        "review_video",
        userId,
      ),
    ];
    const oldKeys = new Set(
      oldReferences.map((reference) => this.reviewMediaKey(reference)),
    );
    const nextReferences = [
      ...(dto.images === undefined
        ? []
        : this.parseReviewMediaUrls(dto.images, userId, "review_image")),
      ...(dto.videos === undefined
        ? []
        : this.parseReviewMediaUrls(dto.videos, userId, "review_video")),
    ];
    return nextReferences.filter(
      (reference) => !oldKeys.has(this.reviewMediaKey(reference)),
    );
  }

  // Đọc media đã lưu từ database; URL legacy không còn nhận diện được thì được bỏ qua để không chặn thao tác sửa review.
  private parseStoredReviewMedia(
    mediaUrls: string[],
    purpose: ReviewMediaPurpose,
    userId: string,
  ): ReviewMediaReference[] {
    return uniqueReviewMediaReferences(
      mediaUrls
        .map((mediaUrl) => parseReviewMediaReference(mediaUrl, purpose))
        .filter(
          (reference): reference is ReviewMediaReference =>
            reference !== null && reference.ownerId === userId,
        ),
    );
  }

  // Chỉ xóa asset không còn được review khác tham chiếu; cách này an toàn với dữ liệu cũ đang dùng mảng URL.
  private async cleanupUnreferencedReviewMedia(
    userId: string,
    references: ReviewMediaReference[],
    excludedReviewId?: string,
  ): Promise<void> {
    if (references.length === 0) return;
    try {
      const safeReferences = await this.filterReferencedReviewMedia(
        userId,
        references,
        excludedReviewId,
      );
      await this.reviewMediaClient.cleanupReviewAssets(userId, safeReferences);
    } catch (error) {
      // Cleanup là hậu xử lý; không rollback review đã lưu chỉ vì Media Service tạm thời lỗi.
      this.logger.warn(
        `Không thể cleanup asset review: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  // Bảo vệ asset đang được review khác dùng trước khi gọi lệnh xóa theo owner.
  private async filterReferencedReviewMedia(
    userId: string,
    references: ReviewMediaReference[],
    excludedReviewId?: string,
  ): Promise<ReviewMediaReference[]> {
    const reviews = (await this.reviews.find()) ?? [];
    const referencedKeys = new Set(
      reviews
        .filter((review) => review.id !== excludedReviewId)
        .flatMap((review) => [
          ...this.parseStoredReviewMedia(
            review.images ?? [],
            "review_image",
            userId,
          ),
          ...this.parseStoredReviewMedia(
            review.videos ?? [],
            "review_video",
            userId,
          ),
        ])
        .map((reference) => this.reviewMediaKey(reference)),
    );
    return references.filter(
      (reference) => !referencedKeys.has(this.reviewMediaKey(reference)),
    );
  }

  // Tạo khóa ổn định theo purpose và asset ID để so sánh media giữa hai phiên bản review.
  private reviewMediaKey(reference: ReviewMediaReference): string {
    return `${reference.purpose}:${reference.ownerId}:${reference.assetId}`;
  }

  // Phát event sau khi save để Seller nhận notification cho cả review mới và review được chỉnh sửa.
  private async publishReviewEvent(
    review: ProductReview,
    proof: ReviewItemProof,
    userId: string,
    eventName: typeof ReviewEvents.CREATED | typeof ReviewEvents.UPDATED,
  ): Promise<void> {
    if (!proof.sellerOwnerId) return;

    const occurredAt =
      eventName === ReviewEvents.CREATED
        ? (review.createdAt?.toISOString() ?? new Date().toISOString())
        : (review.updatedAt?.toISOString() ?? new Date().toISOString());
    const event: ReviewCreatedEvent | ReviewUpdatedEvent = {
      eventId:
        eventName === ReviewEvents.CREATED
          ? `review-created:${review.id}`
          : `review-updated:${review.id}:${occurredAt}`,
      eventName,
      eventVersion: 1,
      source: "product-service",
      occurredAt,
      aggregateId: review.id,
      metadata: { actorUserId: userId },
      data: {
        reviewId: review.id,
        productId: review.productId,
        productName: proof.productName,
        sellerUserId: proof.sellerOwnerId,
        customerUserId: userId,
        orderId: proof.orderId,
        rating: review.rating,
        reviewerName: review.isAnonymous ? null : review.reviewerName,
        isAnonymous: review.isAnonymous ?? false,
        hasComment: Boolean(review.title || review.content),
        mediaCount: (review.images?.length ?? 0) + (review.videos?.length ?? 0),
        createdAt: occurredAt,
      },
    };
    await this.kafkaProducer.publish(eventName, event, review.id);
  }

  // Thêm lượt thích theo kiểu idempotent để bấm nhiều lần hoặc mở nhiều tab vẫn không tạo bản ghi trùng.
  // Chỉ review approved mới được tương tác; userId bắt buộc đến từ header tin cậy của API Gateway.
  async like(
    userId: string | undefined,
    reviewId: string,
  ): Promise<ReviewLikeResponse> {
    const ownerId = this.requireUserId(userId);
    await this.requirePublicReview(reviewId);

    const existing = await this.likes.findOne({
      where: { reviewId, userId: ownerId },
    });
    if (!existing) {
      try {
        await this.likes.save(this.likes.create({ reviewId, userId: ownerId }));
      } catch (error) {
        // Unique index xử lý race giữa hai request like đồng thời; trạng thái cuối vẫn là liked.
        if (
          !(
            error instanceof QueryFailedError &&
            (error.driverError as { code?: string }).code === "23505"
          )
        ) {
          throw error;
        }
      }
    }

    return this.getLikeState(ownerId, reviewId);
  }

  // Bỏ lượt thích an toàn nhiều lần và trả lại tổng số like mới nhất cho optimistic UI phía customer.
  async unlike(
    userId: string | undefined,
    reviewId: string,
  ): Promise<ReviewLikeResponse> {
    const ownerId = this.requireUserId(userId);
    await this.requirePublicReview(reviewId);
    await this.likes.delete({ reviewId, userId: ownerId });
    return this.getLikeState(ownerId, reviewId);
  }

  // Đọc số like và trạng thái liked của user hiện tại mà không trả danh sách userId ra API public.
  async getLikeState(
    userId: string | undefined,
    reviewId: string,
  ): Promise<ReviewLikeResponse> {
    await this.requirePublicReview(reviewId);
    const count = await this.likes.count({ where: { reviewId } });
    const liked = userId
      ? Boolean(await this.likes.findOne({ where: { reviewId, userId } }))
      : false;
    return { reviewId, liked, likeCount: count };
  }

  // Kiểm tra header user do Gateway inject để các endpoint like không thể chạy ẩn danh.
  private requireUserId(userId: string | undefined): string {
    if (!userId)
      throw new UnauthorizedException("Bạn cần đăng nhập để thích đánh giá.");
    return userId;
  }

  // Không cho tương tác với review pending/rejected; public catalog chỉ tương tác review đã approved.
  private async requirePublicReview(reviewId: string): Promise<ProductReview> {
    const review = await this.reviews.findOne({
      where: { id: reviewId, status: "approved" },
    });
    if (!review)
      throw new NotFoundException("Không tìm thấy đánh giá công khai.");
    return review;
  }
}

export interface ReviewLikeResponse {
  reviewId: string;
  liked: boolean;
  likeCount: number;
}
