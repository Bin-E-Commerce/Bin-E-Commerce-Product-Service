// Unit test cho purchase proof và business rule tạo review của Product Service.
// OrderReviewClient được mock để test không phụ thuộc HTTP hoặc database thật.
/// <reference types="jest" />
import { ForbiddenException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { createMock, type DeepMocked } from "@golevelup/ts-jest";
import { QueryFailedError, Repository } from "typeorm";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ProductReview } from "../../../../database/reviews/entities/product-review.entity";
import { ProductReviewLike } from "../../../../database/reviews/entities/product-review-like.entity";
import { CreateProductReviewDto } from "../../presentation/dto/create-product-review.dto";
import { OrderReviewClient } from "../clients/order-review.client";
import { ReviewMediaClient } from "../clients/review-media.client";
import type {
  ReviewItemProof,
  ReviewOrderContext,
} from "../types/review-order-context.type";
import { ProductReviewService } from "./product-review.service";
import { KafkaProducerService } from "../../../../kafka/kafka-producer.service";
import { ReviewEvents } from "@common/kafka/events";

describe("ProductReviewService", () => {
  let target: ProductReviewService;
  let mockReviews: DeepMocked<Repository<ProductReview>>;
  let mockLikes: DeepMocked<Repository<ProductReviewLike>>;
  let mockOrderReviewClient: DeepMocked<OrderReviewClient>;
  let mockKafkaProducer: DeepMocked<KafkaProducerService>;
  let mockReviewMediaClient: DeepMocked<ReviewMediaClient>;

  const userId = "11111111-1111-4111-8111-111111111111";
  const productId = "22222222-2222-4222-8222-222222222222";
  const orderId = "33333333-3333-4333-8333-333333333333";
  const orderItemId = "44444444-4444-4444-8444-444444444444";
  const variantId = "66666666-6666-4666-8666-666666666666";

  // Tạo purchase proof hợp lệ để mỗi test chỉ thay đổi đúng điều kiện đang kiểm tra.
  const createProof = (
    overrides: Partial<ReviewItemProof> = {},
  ): ReviewItemProof => ({
    orderId,
    orderItemId,
    ownerId: userId,
    productId,
    variantId,
    sellerOwnerId: "77777777-7777-4777-8777-777777777777",
    productName: "Ao the thao",
    fulfillmentStatus: "COMPLETED",
    deliveredAt: "2026-08-31T10:00:00.000Z",
    reviewDeadline: "2026-09-30T10:00:00.000Z",
    deliveryConfirmationStatus: "CONFIRMED",
    hasOpenDeliveryIssue: false,
    ...overrides,
  });

  // Khởi tạo TestingModule với mock repository và mock internal client cho từng test.
  beforeEach(async () => {
    mockReviews = createMock<Repository<ProductReview>>();
    mockLikes = createMock<Repository<ProductReviewLike>>();
    mockOrderReviewClient = createMock<OrderReviewClient>();
    mockKafkaProducer = createMock<KafkaProducerService>();
    mockReviewMediaClient = createMock<ReviewMediaClient>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductReviewService,
        { provide: getRepositoryToken(ProductReview), useValue: mockReviews },
        { provide: getRepositoryToken(ProductReviewLike), useValue: mockLikes },
        { provide: OrderReviewClient, useValue: mockOrderReviewClient },
        { provide: KafkaProducerService, useValue: mockKafkaProducer },
        { provide: ReviewMediaClient, useValue: mockReviewMediaClient },
      ],
    }).compile();
    target = module.get<ProductReviewService>(ProductReviewService);
  });

  // Xóa lịch sử mock sau mỗi test để assertion không phụ thuộc thứ tự chạy.
  afterEach(() => {
    jest.clearAllMocks();
  });

  // Tạo DTO tối thiểu giống payload mà form review trên web gửi lên.
  const createDto = (
    overrides: Partial<CreateProductReviewDto> = {},
  ): CreateProductReviewDto => ({
    orderItemId,
    rating: 5,
    title: "Đúng mô tả",
    content: "Sản phẩm dùng tốt.",
    images: [],
    ...overrides,
  });

  // Cho phép review khi purchase proof khớp user, product và chưa quá hạn.
  it("should create a verified purchase review", async () => {
    // Arrange
    const proof = createProof();
    const savedReview = { id: "review-1", ...createDto() } as ProductReview;
    mockOrderReviewClient.getItemProof.mockResolvedValue(proof);
    mockReviews.findOne.mockResolvedValue(null);
    mockReviews.create.mockImplementation((input) => input as ProductReview);
    mockReviews.save.mockResolvedValue(savedReview);

    // Act
    const result = await target.create(userId, productId, createDto());

    // Assert
    expect(result).toBe(savedReview);
    expect(mockReviews.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        productId,
        orderId,
        orderItemId,
        status: "approved",
      }),
    );
  });

  // Cho phép chủ review cập nhật nội dung trong thời hạn và giữ nguyên identity giao dịch gốc.
  it("should update an owned review within the review window", async () => {
    // Arrange
    const existingReview = {
      id: "review-1",
      userId,
      productId,
      orderItemId,
      status: "approved",
      rating: 5,
      title: "Cũ",
      content: "Nội dung cũ",
      images: ["old-image"],
      videos: [],
    } as unknown as ProductReview;
    const updatedReview = {
      ...existingReview,
      rating: 4,
      title: null,
      content: "Nội dung mới",
      images: [],
      updatedAt: new Date("2026-09-01T01:00:00.000Z"),
    } as unknown as ProductReview;
    mockReviews.findOne.mockResolvedValue(existingReview);
    mockOrderReviewClient.getItemProof.mockResolvedValue(createProof());
    mockReviews.save.mockResolvedValue(updatedReview);

    // Act
    const result = await target.update(userId, "review-1", {
      rating: 4,
      title: "",
      content: "Nội dung mới",
      images: [],
      videos: [],
      isAnonymous: true,
    });

    // Assert
    expect(result).toBe(updatedReview);
    expect(mockReviews.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "review-1",
        productId,
        orderItemId,
        rating: 4,
        title: null,
        content: "Nội dung mới",
        images: [],
        videos: [],
        isAnonymous: true,
      }),
    );
    expect(mockKafkaProducer.publish).toHaveBeenCalledWith(
      ReviewEvents.UPDATED,
      expect.objectContaining({ eventName: ReviewEvents.UPDATED }),
      "review-1",
    );
  });

  // Xóa cả ảnh và video đã bị bỏ khỏi review sau khi database lưu thành công.
  it("should cleanup removed review image and video assets", async () => {
    // Arrange
    const imageUrl = `https://cdn.example.com/media/processed/review_image/${userId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/large.webp`;
    const videoUrl = `https://cdn.example.com/uploads/original/review_video/${userId}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/review.mp4`;
    const existingReview = {
      id: "review-1",
      userId,
      productId,
      orderItemId,
      status: "approved",
      rating: 5,
      images: [imageUrl],
      videos: [videoUrl],
    } as unknown as ProductReview;
    const updatedReview = {
      ...existingReview,
      images: [],
      videos: [],
    } as ProductReview;
    mockReviews.findOne.mockResolvedValue(existingReview);
    mockReviews.find.mockResolvedValue([]);
    mockOrderReviewClient.getItemProof.mockResolvedValue(createProof());
    mockReviews.save.mockResolvedValue(updatedReview);

    // Act
    await target.update(userId, "review-1", { images: [], videos: [] });

    // Assert
    expect(mockReviewMediaClient.cleanupReviewAssets).toHaveBeenCalledWith(
      userId,
      [
        {
          assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          ownerId: userId,
          purpose: "review_image",
        },
        {
          assetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          ownerId: userId,
          purpose: "review_video",
        },
      ],
    );
  });

  // Dọn media mới nếu database không lưu được phiên bản review cập nhật.
  it("should cleanup newly added media when update persistence fails", async () => {
    // Arrange
    const newImageUrl = `https://cdn.example.com/media/processed/review_image/${userId}/cccccccc-cccc-4ccc-8ccc-cccccccccccc/large.webp`;
    const existingReview = {
      id: "review-1",
      userId,
      productId,
      orderItemId,
      status: "approved",
      rating: 5,
      images: [],
      videos: [],
    } as unknown as ProductReview;
    const persistenceError = new Error("database unavailable");
    mockReviews.findOne.mockResolvedValue(existingReview);
    mockReviews.find.mockResolvedValue([]);
    mockOrderReviewClient.getItemProof.mockResolvedValue(createProof());
    mockReviews.save.mockRejectedValue(persistenceError);

    // Act & Assert
    await expect(
      target.update(userId, "review-1", { images: [newImageUrl] }),
    ).rejects.toBe(persistenceError);
    expect(mockReviewMediaClient.cleanupReviewAssets).toHaveBeenCalledWith(
      userId,
      [
        {
          assetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          ownerId: userId,
          purpose: "review_image",
        },
      ],
    );
  });

  // Không cho phép customer dùng reviewId của tài khoản khác để sửa nội dung hoặc media.
  it("should reject updating a review owned by another user", async () => {
    // Arrange
    mockReviews.findOne.mockResolvedValue({
      id: "review-1",
      userId: "55555555-5555-4555-8555-555555555555",
      status: "approved",
    } as unknown as ProductReview);

    // Act & Assert
    await expect(
      target.update(userId, "review-1", { rating: 4 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockOrderReviewClient.getItemProof).not.toHaveBeenCalled();
    expect(mockReviews.save).not.toHaveBeenCalled();
  });

  // Khóa sửa review sau deadline giống rule tạo review để không có đường vòng nghiệp vụ.
  it("should reject updating a review after the review window expires", async () => {
    // Arrange
    mockReviews.findOne.mockResolvedValue({
      id: "review-1",
      userId,
      productId,
      orderItemId,
      status: "approved",
    } as unknown as ProductReview);
    mockOrderReviewClient.getItemProof.mockResolvedValue(
      createProof({ reviewDeadline: "2020-01-01T00:00:00.000Z" }),
    );

    // Act & Assert
    await expect(
      target.update(userId, "review-1", { rating: 4 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockReviews.save).not.toHaveBeenCalled();
  });

  // Chặn user giả mạo product hoặc purchase proof của tài khoản khác.
  it("should reject a review when purchase proof belongs to another user", async () => {
    // Arrange
    mockOrderReviewClient.getItemProof.mockResolvedValue(
      createProof({ ownerId: "55555555-5555-4555-8555-555555555555" }),
    );

    // Act & Assert
    await expect(
      target.create(userId, productId, createDto()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockReviews.findOne).not.toHaveBeenCalled();
  });

  // Chặn review đã quá 30 ngày dù order vẫn còn ở COMPLETED.
  it("should reject a review after the review window expires", async () => {
    // Arrange
    mockOrderReviewClient.getItemProof.mockResolvedValue(
      createProof({ reviewDeadline: "2020-01-01T00:00:00.000Z" }),
    );

    // Act & Assert
    await expect(
      target.create(userId, productId, createDto()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockReviews.findOne).not.toHaveBeenCalled();
  });

  // Chuẩn hóa lỗi unique từ database thành lỗi nghiệp vụ nếu hai tab submit cùng lúc.
  it("should map a concurrent duplicate insert to conflict", async () => {
    // Arrange
    mockOrderReviewClient.getItemProof.mockResolvedValue(createProof());
    mockReviews.findOne.mockResolvedValue(null);
    mockReviews.create.mockImplementation((input) => input as ProductReview);
    mockReviews.save.mockRejectedValue(
      new QueryFailedError("INSERT", [], { code: "23505" } as unknown as Error),
    );

    // Act & Assert
    await expect(target.create(userId, productId, createDto())).rejects.toThrow(
      "Bạn đã đánh giá sản phẩm này rồi.",
    );
  });

  // Trả item đã review cùng trạng thái canReview để UI không hiển thị CTA trùng lần nữa.
  it("should return review status per order item", async () => {
    // Arrange
    const context: ReviewOrderContext = {
      orderId,
      ownerId: userId,
      fulfillmentStatus: "COMPLETED",
      deliveredAt: "2026-08-31T10:00:00.000Z",
      reviewDeadline: "2026-09-30T10:00:00.000Z",
      deliveryConfirmationStatus: "CONFIRMED",
      hasOpenDeliveryIssue: false,
      items: [
        {
          orderItemId,
          productId,
          variantId,
          productName: "Áo thể thao",
          variantName: "Đen - XL",
          imageUrl: null,
        },
      ],
    };
    mockOrderReviewClient.getOrderContext.mockResolvedValue(context);
    mockReviews.find.mockResolvedValue([
      {
        id: "review-1",
        orderItemId,
        rating: 5,
        status: "pending",
        content: "Sản phẩm dùng tốt.",
      } as ProductReview,
    ]);

    // Act
    const result = await target.getMine(userId, orderId);

    // Assert
    expect(result.canReview).toBe(true);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        orderItemId,
        canReview: false,
        review: expect.objectContaining({ id: "review-1", status: "pending" }),
      }),
    );
  });

  // Cho phép customer thích review công khai và trả đúng count sau khi lưu.
  it("should like an approved review idempotently", async () => {
    // Arrange
    mockReviews.findOne.mockResolvedValue({
      id: "review-1",
      status: "approved",
    } as ProductReview);
    mockLikes.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "like-1" } as ProductReviewLike);
    mockLikes.create.mockImplementation((input) => input as ProductReviewLike);
    mockLikes.save.mockResolvedValue({ id: "like-1" } as ProductReviewLike);
    mockLikes.count.mockResolvedValue(1);

    // Act
    const result = await target.like(userId, "review-1");

    // Assert
    expect(result).toEqual({ reviewId: "review-1", liked: true, likeCount: 1 });
    expect(mockLikes.create).toHaveBeenCalledWith({
      reviewId: "review-1",
      userId,
    });
    expect(mockLikes.save).toHaveBeenCalledTimes(1);
  });

  // Bỏ like không làm lỗi khi request lặp lại, phù hợp với thao tác toggle trên UI.
  it("should unlike an approved review and return the remaining count", async () => {
    // Arrange
    mockReviews.findOne.mockResolvedValue({
      id: "review-1",
      status: "approved",
    } as ProductReview);
    mockLikes.delete.mockResolvedValue({ affected: 1, raw: [] });
    mockLikes.findOne.mockResolvedValue(null);
    mockLikes.count.mockResolvedValue(0);

    // Act
    const result = await target.unlike(userId, "review-1");

    // Assert
    expect(result).toEqual({
      reviewId: "review-1",
      liked: false,
      likeCount: 0,
    });
    expect(mockLikes.delete).toHaveBeenCalledWith({
      reviewId: "review-1",
      userId,
    });
  });
});
