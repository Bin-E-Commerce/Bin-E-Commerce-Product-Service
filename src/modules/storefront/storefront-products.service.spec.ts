// File này kiểm tra storefront giữ số bán local khi Order Service tạm thời không khả dụng.

/// <reference types="jest" />

import { type DeepMocked, createMock } from "@golevelup/ts-jest";
import { Repository } from "typeorm";
import { Product } from "../../database/catalog/entities/product.entity";
import { ProductStatus } from "../../database/catalog/enums/product-status.enum";
import { ProductReviewLike } from "../../database/reviews/entities/product-review-like.entity";
import { OrderSalesClient } from "../seller-products/integrations/order-sales.client";
import { ReviewerProfileClient } from "../reviews/integrations/reviewer-profile.client";
import { StorefrontProductsService } from "./storefront-products.service";

describe("StorefrontProductsService", () => {
  let target: StorefrontProductsService;
  let mockProductRepository: DeepMocked<Repository<Product>>;
  let mockReviewLikeRepository: DeepMocked<Repository<ProductReviewLike>>;
  let mockReviewerProfileClient: DeepMocked<ReviewerProfileClient>;
  let mockOrderSalesClient: DeepMocked<OrderSalesClient>;

  // Tạo product tối thiểu nhưng giữ totalSold đã đọc từ Product DB để kiểm tra fallback không ghi đè dữ liệu.
  const createProduct = (totalSold: number): Product =>
    ({
      id: "product-001",
      sellerOwnerId: "owner-001",
      status: ProductStatus.ACTIVE,
      totalSold,
      reviews: [],
      images: [],
    }) as unknown as Product;

  beforeEach(() => {
    mockProductRepository = createMock<Repository<Product>>();
    mockReviewLikeRepository = createMock<Repository<ProductReviewLike>>();
    mockReviewerProfileClient = createMock<ReviewerProfileClient>();
    mockOrderSalesClient = createMock<OrderSalesClient>();
    target = new StorefrontProductsService(
      mockProductRepository,
      mockReviewLikeRepository,
      mockReviewerProfileClient,
      mockOrderSalesClient,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Khi Order Service lỗi, storefront phải trả counter local cũ để lỗi phụ thuộc không làm số bán nhảy về 0.
  it("should preserve local sold counter when Order Service is unavailable", async () => {
    // Arrange
    const product = createProduct(7);
    mockProductRepository.findOne.mockResolvedValue(product);
    mockOrderSalesClient.getSoldQuantities.mockResolvedValue(null);

    // Act
    const result = await target.getStorefrontProductById("product-001", "owner-001");

    // Assert
    expect(result.totalSold).toBe(7);
    expect(mockOrderSalesClient.getSoldQuantities).toHaveBeenCalledWith(
      "owner-001",
      ["product-001"],
    );
  });

  // Khi nguồn authoritative trả dữ liệu hợp lệ, số bán local phải được cập nhật theo số lượng đã hoàn thành.
  it("should use completed sales from Order Service when available", async () => {
    // Arrange
    const product = createProduct(7);
    mockProductRepository.findOne.mockResolvedValue(product);
    mockOrderSalesClient.getSoldQuantities.mockResolvedValue(
      new Map([["product-001", 12]]),
    );

    // Act
    const result = await target.getStorefrontProductById("product-001", "owner-001");

    // Assert
    expect(result.totalSold).toBe(12);
  });
});
