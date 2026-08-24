import { ConflictException, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { ProductImage } from "../../../../../database/entities/product-image.entity";
import { ProductVariant } from "../../../../../database/entities/product-variant.entity";
import { Product } from "../../../../../database/entities/product.entity";
import { ProductOriginType } from "../../../shared/enums/product-origin-type.enum";
import { ProductStatus } from "../../../shared/enums/product-status.enum";
import { ProductMediaClient } from "../../integrations/product-media.client";
import type { SellerProductUserContext } from "../../types/seller-product-user-context.type";
import { SellerProductDeletionService } from "./seller-product-deletion.service";

const PRODUCT_ID = "6d89a4f8-2f4e-4a98-9d7d-e7c3c5c7a101";
const OWNER_ID = "c6d2f3c8-4ae7-4c74-9d39-63e2f9af9e02";
const ASSET_ID = "1c3b6a4e-3a3c-4f5e-9c7f-9d6a1f2b3c4d";

describe("SellerProductDeletionService", () => {
  let target: SellerProductDeletionService;
  let mockTransaction: jest.Mock;
  let mockManager: {
    findOne: jest.Mock;
    find: jest.Mock;
    count: jest.Mock;
    save: jest.Mock;
  };
  let mockProductMediaClient: { cleanupProductAssets: jest.Mock };

  const currentUser: SellerProductUserContext = {
    userId: OWNER_ID,
    email: "seller@bin.local",
    permissions: [],
  };

  beforeEach(() => {
    // Arrange: mô phỏng transaction manager và client media, không chạm database/S3 thật.
    mockManager = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
      save: jest.fn(),
    };
    mockTransaction = jest.fn(async (callback: (manager: EntityManager) => unknown) =>
      callback(mockManager as unknown as EntityManager),
    );
    mockProductMediaClient = { cleanupProductAssets: jest.fn() };

    target = new SellerProductDeletionService(
      { transaction: mockTransaction } as unknown as DataSource,
      mockProductMediaClient as unknown as ProductMediaClient,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("soft deletes an eligible product and cleans orphaned media after commit", async () => {
    // Arrange: product nháp chưa bán và ảnh thuộc riêng product này.
    const updatedAt = new Date("2026-08-22T12:00:00.000Z");
    const product = Object.assign(new Product(), {
      id: PRODUCT_ID,
      sellerOwnerId: OWNER_ID,
      originType: ProductOriginType.INTERNAL,
      status: ProductStatus.DRAFT,
      totalSold: 0,
      videoAssetId: null,
      videoUrl: null,
      updatedAt,
    });
    const image = Object.assign(new ProductImage(), {
      productId: PRODUCT_ID,
      imageUrl: `https://media.local/media/processed/product_image/source/${ASSET_ID}/image.webp`,
    });
    mockManager.findOne.mockResolvedValue(product);
    mockManager.find
      .mockResolvedValueOnce([] as ProductVariant[])
      .mockResolvedValueOnce([image])
      .mockResolvedValueOnce([] as ProductImage[]);
    mockManager.save.mockResolvedValue(product);

    // Act: thực hiện xóa mềm qua use case.
    const result = await target.delete(currentUser, PRODUCT_ID);

    // Assert: database đổi lifecycle trước, cleanup media nhận đúng asset sau commit.
    expect(result).toEqual({
      id: PRODUCT_ID,
      status: ProductStatus.DELETED,
      updatedAt,
    });
    expect(product.status).toBe(ProductStatus.DELETED);
    expect(mockManager.save).toHaveBeenCalledWith(Product, product);
    expect(mockProductMediaClient.cleanupProductAssets).toHaveBeenCalledWith(
      OWNER_ID,
      [{ assetId: ASSET_ID, purpose: "product_image" }],
    );
    expect(mockProductMediaClient.cleanupProductAssets).toHaveBeenCalledTimes(1);
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
    expect(mockProductMediaClient.cleanupProductAssets).not.toHaveBeenCalled();
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

    // Act/Assert: không được chuyển trạng thái hoặc gọi cleanup media.
    await expect(target.delete(currentUser, PRODUCT_ID)).rejects.toThrow(
      ConflictException,
    );
    expect(mockManager.save).not.toHaveBeenCalled();
    expect(mockProductMediaClient.cleanupProductAssets).not.toHaveBeenCalled();
  });

  it("returns not found when the product is missing or already deleted", async () => {
    // Arrange: query ownership + lifecycle không tìm thấy product hợp lệ.
    mockManager.findOne.mockResolvedValue(null);

    // Act/Assert: không để lộ product của shop khác và không chạy cleanup.
    await expect(target.delete(currentUser, PRODUCT_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(mockManager.save).not.toHaveBeenCalled();
    expect(mockProductMediaClient.cleanupProductAssets).not.toHaveBeenCalled();
  });
});
