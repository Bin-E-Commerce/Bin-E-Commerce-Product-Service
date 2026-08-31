// File này kiểm thử điều kiện restore product mà không cần chạy database thật.
import { ConflictException, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { Product } from "../../../../database/catalog/entities/product.entity";
import { ProductOriginType } from "../../../../database/catalog/enums/product-origin-type.enum";
import { ProductStatus } from "../../../../database/catalog/enums/product-status.enum";
import type { SellerProductUserContext } from "../../types/seller-product-user-context.type";
import { SellerProductRestoreService } from "./seller-product-restore.service";

const PRODUCT_ID = "6d89a4f8-2f4e-4a98-9d7d-e7c3c5c7a101";
const OWNER_ID = "c6d2f3c8-4ae7-4c74-9d39-63e2f9af9e02";

describe("SellerProductRestoreService", () => {
  let target: SellerProductRestoreService;
  let mockTransaction: jest.Mock;
  let mockManager: { findOne: jest.Mock; save: jest.Mock };

  const currentUser: SellerProductUserContext = {
    userId: OWNER_ID,
    email: "seller@bin.local",
    permissions: [],
  };

  beforeEach(() => {
    // Arrange: mô phỏng transaction manager để kiểm tra restore không chạm database thật.
    mockManager = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    mockTransaction = jest.fn(async (callback: (manager: EntityManager) => unknown) =>
      callback(mockManager as unknown as EntityManager),
    );
    target = new SellerProductRestoreService({
      transaction: mockTransaction,
    } as unknown as DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("restores a deleted product to inactive and clears deletion metadata", async () => {
    // Arrange: product đã xóa nhưng vẫn còn media graph trong database.
    const product = Object.assign(new Product(), {
      id: PRODUCT_ID,
      sellerOwnerId: OWNER_ID,
      originType: ProductOriginType.INTERNAL,
      status: ProductStatus.DELETED,
      deletedAt: new Date("2026-08-22T12:00:00.000Z"),
      deletedBy: OWNER_ID,
      updatedAt: new Date("2026-08-23T12:00:00.000Z"),
    });
    mockManager.findOne.mockResolvedValue(product);
    mockManager.save.mockResolvedValue(product);

    // Act: khôi phục product thuộc seller hiện tại.
    const result = await target.restore(currentUser, PRODUCT_ID);

    // Assert: product trở về INACTIVE và không tự xuất hiện trên storefront.
    expect(result).toEqual({
      id: PRODUCT_ID,
      status: ProductStatus.INACTIVE,
      updatedAt: product.updatedAt,
    });
    expect(product.status).toBe(ProductStatus.INACTIVE);
    expect(product.deletedAt).toBeNull();
    expect(product.deletedBy).toBeNull();
    expect(mockManager.save).toHaveBeenCalledWith(Product, product);
  });

  it("returns not found when the product is missing or owned by another seller", async () => {
    // Arrange: ownership query không tìm thấy product hợp lệ.
    mockManager.findOne.mockResolvedValue(null);

    // Act/Assert: không để lộ product của shop khác.
    await expect(target.restore(currentUser, PRODUCT_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(mockManager.save).not.toHaveBeenCalled();
  });

  it("rejects restoring a product that is not deleted", async () => {
    // Arrange: product đang ở trạng thái INACTIVE, không phải bản ghi trong thùng rác.
    const product = Object.assign(new Product(), {
      id: PRODUCT_ID,
      sellerOwnerId: OWNER_ID,
      originType: ProductOriginType.INTERNAL,
      status: ProductStatus.INACTIVE,
    });
    mockManager.findOne.mockResolvedValue(product);

    // Act/Assert: chỉ DELETED mới được restore.
    await expect(target.restore(currentUser, PRODUCT_ID)).rejects.toThrow(
      ConflictException,
    );
    expect(mockManager.save).not.toHaveBeenCalled();
  });
});
