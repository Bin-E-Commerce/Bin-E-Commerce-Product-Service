// File này kiểm tra storefront giữ số bán local khi Order Service tạm thời không khả dụng.

/// <reference types="jest" />

import { type DeepMocked, createMock } from "@golevelup/ts-jest";
import { Repository } from "typeorm";
import { Product } from "../../../../database/catalog/entities/product.entity";
import { ProductVariant } from "../../../../database/catalog/entities/product-variant.entity";
import { ProductStatus } from "../../../../database/catalog/enums/product-status.enum";
import { ProductVariantStatus } from "../../../../database/catalog/enums/product-variant-status.enum";
import { ProductReviewLike } from "../../../../database/reviews/entities/product-review-like.entity";
import { ProductReview } from "../../../../database/reviews/entities/product-review.entity";
import { OrderSalesClient } from "../../../seller-products/application/clients/order-sales.client";
import { ReviewerProfileClient } from "../../../reviews/application/clients/reviewer-profile.client";
import { StorefrontProductsService } from "./storefront-products.service";

describe("StorefrontProductsService", () => {
  let target: StorefrontProductsService;
  let mockProductRepository: DeepMocked<Repository<Product>>;
  let mockProductVariantRepository: DeepMocked<Repository<ProductVariant>>;
  let mockReviewLikeRepository: DeepMocked<Repository<ProductReviewLike>>;
  let mockReviewRepository: DeepMocked<Repository<ProductReview>>;
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
      variants: [],
    }) as unknown as Product;

  beforeEach(() => {
    mockProductRepository = createMock<Repository<Product>>();
    mockProductVariantRepository = createMock<Repository<ProductVariant>>();
    mockReviewLikeRepository = createMock<Repository<ProductReviewLike>>();
    mockReviewRepository = createMock<Repository<ProductReview>>();
    mockReviewerProfileClient = createMock<ReviewerProfileClient>();
    mockOrderSalesClient = createMock<OrderSalesClient>();
    target = new StorefrontProductsService(
      mockProductRepository,
      mockProductVariantRepository,
      mockReviewLikeRepository,
      mockReviewRepository,
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

  // Giá hiển thị và giá gốc phải thuộc cùng variant active rẻ nhất để phần trăm giảm không bị sai.
  it("should expose the price pair from the cheapest active variant", async () => {
    // Arrange
    const product = createProduct(7);
    product.minPrice = "150000.00";
    product.variants = [
      {
        id: "variant-inactive",
        status: ProductVariantStatus.INACTIVE,
        price: "100000.00",
        originalPrice: "120000.00",
      },
      {
        id: "variant-expensive",
        status: ProductVariantStatus.ACTIVE,
        price: "200000.00",
        originalPrice: "250000.00",
      },
      {
        id: "variant-cheapest",
        status: ProductVariantStatus.ACTIVE,
        price: "150000.00",
        originalPrice: "180000.00",
      },
    ] as ProductVariant[];
    mockProductRepository.findOne.mockResolvedValue(product);
    mockOrderSalesClient.getSoldQuantities.mockResolvedValue(null);

    // Act
    const result = await target.getStorefrontProductById("product-001");

    // Assert
    expect(result.displayPrice).toBe("150000.00");
    expect(result.displayOriginalPrice).toBe("180000.00");
  });

  // Giá gốc không hợp lệ không được truyền sang storefront để card không hiển thị một ưu đãi giả.
  it("should omit an invalid original price", async () => {
    // Arrange
    const product = createProduct(0);
    product.minPrice = "150000.00";
    product.variants = [
      {
        id: "variant-001",
        status: ProductVariantStatus.ACTIVE,
        price: "150000.00",
        originalPrice: "150000.00",
      },
    ] as ProductVariant[];
    mockProductRepository.findOne.mockResolvedValue(product);
    mockOrderSalesClient.getSoldQuantities.mockResolvedValue(null);

    // Act
    const result = await target.getStorefrontProductById("product-001");

    // Assert
    expect(result.displayPrice).toBe("150000.00");
    expect(result.displayOriginalPrice).toBeNull();
  });
});
