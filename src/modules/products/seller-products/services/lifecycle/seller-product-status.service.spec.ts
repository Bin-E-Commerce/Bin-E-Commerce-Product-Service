import { ConflictException, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { Product } from "../../../../../database/entities/product.entity";
import { ProductOriginType } from "../../../shared/enums/product-origin-type.enum";
import { ProductStatus } from "../../../shared/enums/product-status.enum";
import type { SellerProductUserContext } from "../../types/seller-product-user-context.type";
import { SellerProductStatusService } from "./seller-product-status.service";

const PRODUCT_ID = "6d89a4f8-2f4e-4a98-9d7d-e7c3c5c7a101";
const OWNER_ID = "c6d2f3c8-4ae7-4c74-9d39-63e2f9af9e02";

describe("SellerProductStatusService", () => {
  let target: SellerProductStatusService;
  let mockTransaction: jest.Mock;
  let mockManager: {
    findOne: jest.Mock;
    save: jest.Mock;
  };

  const currentUser: SellerProductUserContext = {
    userId: OWNER_ID,
    email: "seller@bin.local",
    permissions: [],
  };

  beforeEach(() => {
    // Arrange: mô phỏng transaction manager để test domain rule mà không kết nối database thật.
    mockManager = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    mockTransaction = jest.fn(async (callback: (manager: EntityManager) => unknown) =>
      callback(mockManager as unknown as EntityManager),
    );
    target = new SellerProductStatusService(
      { transaction: mockTransaction } as unknown as DataSource,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("activates an inactive product and saves only the status change", async () => {
    // Arrange: sản phẩm thuộc seller và đang tạm ẩn.
    const product = Object.assign(new Product(), {
      id: PRODUCT_ID,
      sellerOwnerId: OWNER_ID,
      originType: ProductOriginType.INTERNAL,
      status: ProductStatus.INACTIVE,
      updatedAt: new Date("2026-08-23T08:00:00.000Z"),
    });
    mockManager.findOne.mockResolvedValue(product);
    mockManager.save.mockResolvedValue(product);

    // Act: bật bán bằng status use case riêng.
    const result = await target.changeStatus(
      currentUser,
      PRODUCT_ID,
      ProductStatus.ACTIVE,
    );

    // Assert: trạng thái được đổi và entity được save trong transaction.
    expect(result).toEqual({
      id: PRODUCT_ID,
      status: ProductStatus.ACTIVE,
      updatedAt: product.updatedAt,
    });
    expect(product.status).toBe(ProductStatus.ACTIVE);
    expect(mockManager.save).toHaveBeenCalledWith(Product, product);
    expect(mockManager.save).toHaveBeenCalledTimes(1);
  });

  it("deactivates an active product without changing its product data", async () => {
    // Arrange: sản phẩm đang bán và có các trường dữ liệu khác không liên quan đến status.
    const product = Object.assign(new Product(), {
      id: PRODUCT_ID,
      sellerOwnerId: OWNER_ID,
      originType: ProductOriginType.INTERNAL,
      status: ProductStatus.ACTIVE,
      name: "Sản phẩm vận hành",
      totalSold: 4,
      updatedAt: new Date("2026-08-23T08:00:00.000Z"),
    });
    mockManager.findOne.mockResolvedValue(product);
    mockManager.save.mockResolvedValue(product);

    // Act: tắt bán sản phẩm.
    const result = await target.changeStatus(
      currentUser,
      PRODUCT_ID,
      ProductStatus.INACTIVE,
    );

    // Assert: giữ nguyên lịch sử bán và thông tin sản phẩm, chỉ đổi lifecycle status.
    expect(result.status).toBe(ProductStatus.INACTIVE);
    expect(product.name).toBe("Sản phẩm vận hành");
    expect(product.totalSold).toBe(4);
    expect(product.status).toBe(ProductStatus.INACTIVE);
    expect(mockManager.save).toHaveBeenCalledTimes(1);
  });

  it("returns an idempotent response without saving when status is unchanged", async () => {
    // Arrange: sản phẩm đã ở đúng trạng thái đích.
    const product = Object.assign(new Product(), {
      id: PRODUCT_ID,
      sellerOwnerId: OWNER_ID,
      originType: ProductOriginType.INTERNAL,
      status: ProductStatus.ACTIVE,
      updatedAt: new Date("2026-08-23T08:00:00.000Z"),
    });
    mockManager.findOne.mockResolvedValue(product);

    // Act: gửi lại yêu cầu ACTIVE.
    const result = await target.changeStatus(
      currentUser,
      PRODUCT_ID,
      ProductStatus.ACTIVE,
    );

    // Assert: PATCH idempotent, không tạo lần ghi thừa.
    expect(result.status).toBe(ProductStatus.ACTIVE);
    expect(mockManager.save).not.toHaveBeenCalled();
  });

  it("rejects a draft product when the target status is inactive", async () => {
    // Arrange: bản nháp chưa có lifecycle ngừng bán hợp lệ.
    const product = Object.assign(new Product(), {
      id: PRODUCT_ID,
      sellerOwnerId: OWNER_ID,
      originType: ProductOriginType.INTERNAL,
      status: ProductStatus.DRAFT,
    });
    mockManager.findOne.mockResolvedValue(product);

    // Act/Assert: seller phải đăng bán trước rồi mới có thể tắt bán.
    await expect(
      target.changeStatus(currentUser, PRODUCT_ID, ProductStatus.INACTIVE),
    ).rejects.toThrow(ConflictException);
    expect(mockManager.save).not.toHaveBeenCalled();
  });

  it("returns not found for a missing or deleted product", async () => {
    // Arrange: ownership query không tìm thấy product hợp lệ.
    mockManager.findOne.mockResolvedValue(null);

    // Act/Assert: không để lộ product của seller khác.
    await expect(
      target.changeStatus(currentUser, PRODUCT_ID, ProductStatus.ACTIVE),
    ).rejects.toThrow(NotFoundException);
    expect(mockManager.save).not.toHaveBeenCalled();
  });
});
