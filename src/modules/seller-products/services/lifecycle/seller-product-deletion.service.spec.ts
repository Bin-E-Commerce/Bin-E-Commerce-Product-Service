// File này kiểm thử các rule xóa product và rollback transaction bằng fake manager.
import { ConflictException, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { ProductVariant } from "../../../../database/catalog/entities/product-variant.entity";
import { Product } from "../../../../database/catalog/entities/product.entity";
import { ProductOriginType } from "../../../../database/catalog/enums/product-origin-type.enum";
import { ProductStatus } from "../../../../database/catalog/enums/product-status.enum";
import type { SellerProductUserContext } from "../../types/seller-product-user-context.type";
import { SellerProductDeletionService } from "./seller-product-deletion.service";

const PRODUCT_ID = "6d89a4f8-2f4e-4a98-9d7d-e7c3c5c7a101";
const OWNER_ID = "c6d2f3c8-4ae7-4c74-9d39-63e2f9af9e02";

describe("SellerProductDeletionService", () => {
  let target: SellerProductDeletionService;
  let mockTransaction: jest.Mock;
  let mockManager: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };

  const currentUser: SellerProductUserContext = {
    userId: OWNER_ID,
    email: "seller@bin.local",
    permissions: [],
  };

  beforeEach(() => {
    // Arrange: mô phỏng transaction manager và không kết nối database thật.
    mockManager = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
    };
    mockTransaction = jest.fn(async (callback: (manager: EntityManager) => unknown) =>
      callback(mockManager as unknown as EntityManager),
    );
    target = new SellerProductDeletionService({
      transaction: mockTransaction,
    } as unknown as DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("soft deletes an eligible product and preserves media references", async () => {
    // Arrange: product nháp chưa bán có product graph cần giữ lại để restore.
    const product = Object.assign(new Product(), {
      id: PRODUCT_ID,
      sellerOwnerId: OWNER_ID,
      originType: ProductOriginType.INTERNAL,
      status: ProductStatus.DRAFT,
      totalSold: 0,
      videoAssetId: "video-asset-id",
      videoUrl: "https://media.local/video.mp4",
      updatedAt: new Date("2026-08-22T12:00:00.000Z"),
    });
    mockManager.findOne.mockResolvedValue(product);
    mockManager.find.mockResolvedValue([] as ProductVariant[]);
    mockManager.save.mockResolvedValue(product);

    // Act: thực hiện xóa mềm qua use case.
    const result = await target.delete(currentUser, PRODUCT_ID);

    // Assert: metadata xóa được ghi nhưng service không đụng tới media client.
    expect(result).toEqual({
      id: PRODUCT_ID,
      status: ProductStatus.DELETED,
      updatedAt: product.updatedAt,
    });
    expect(product.status).toBe(ProductStatus.DELETED);
    expect(product.deletedAt).toBeInstanceOf(Date);
    expect(product.deletedBy).toBe(OWNER_ID);
    expect(product.videoAssetId).toBe("video-asset-id");
    expect(mockManager.save).toHaveBeenCalledWith(Product, product);
  });

  it("rejects an active product before changing its lifecycle", async () => {
    // Arrange: sản phẩm đang hoạt động phải ngừng bán trước khi xóa.
    const product = Object.assign(new Product(), {
      id: PRODUCT_ID,
      sellerOwnerId: OWNER_ID,
      originType: ProductOriginType.INTERNAL,
      status: ProductStatus.ACTIVE,
      totalSold: 0,
    });
    mockManager.findOne.mockResolvedValue(product);
    mockManager.find.mockResolvedValue([]);

    // Act/Assert: rule domain trả về conflict và transaction không save.
    await expect(target.delete(currentUser, PRODUCT_ID)).rejects.toThrow(
      ConflictException,
    );
    expect(mockManager.save).not.toHaveBeenCalled();
  });

  it("rejects a product that already has sales", async () => {
    // Arrange: lịch sử giao dịch làm product immutable để bảo toàn đối soát.
    const product = Object.assign(new Product(), {
      id: PRODUCT_ID,
      sellerOwnerId: OWNER_ID,
      originType: ProductOriginType.INTERNAL,
      status: ProductStatus.INACTIVE,
      totalSold: 1,
    });
    mockManager.findOne.mockResolvedValue(product);
    mockManager.find.mockResolvedValue([]);

    // Act/Assert: không được chuyển trạng thái.
    await expect(target.delete(currentUser, PRODUCT_ID)).rejects.toThrow(
      ConflictException,
    );
    expect(mockManager.save).not.toHaveBeenCalled();
  });

  it("returns not found when the product is missing or already deleted", async () => {
    // Arrange: query ownership + lifecycle không tìm thấy product hợp lệ.
    mockManager.findOne.mockResolvedValue(null);

    // Act/Assert: không để lộ product của shop khác.
    await expect(target.delete(currentUser, PRODUCT_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(mockManager.save).not.toHaveBeenCalled();
  });
});
