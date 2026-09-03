//
// Kiem thu viec apply output AI ma khong lam mat cac anh khong duoc seller chon.
// Test chi dung fake transaction manager, khong ket noi PostgreSQL hay Media Service.
//

import { ConflictException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { Product } from "../../../../../database/catalog/entities/product.entity";
import { ProductImage } from "../../../../../database/catalog/entities/product-image.entity";
import { ProductOriginType } from "../../../../../database/catalog/enums/product-origin-type.enum";
import { ProductStatus } from "../../../../../database/catalog/enums/product-status.enum";
import type { SellerProductUserContext } from "../../types/seller-product-user-context.type";
import { SellerProductAiMediaService } from "./seller-product-ai-media.service";

const PRODUCT_ID = "6d89a4f8-2f4e-4a98-9d7d-e7c3c5c7a101";
const OWNER_ID = "c6d2f3c8-4ae7-4c74-9d39-63e2f9af9e02";
const SOURCE_IMAGE_ID = "50d41f74-624d-4553-8e4a-e18dd9e77289";
const OTHER_IMAGE_ID = "13aaaec3-f892-41ce-990c-c17343107290";

// Kiem tra aggregate product sau apply van giu nguyen cac image row khong duoc chon.
describe("SellerProductAiMediaService", () => {
  let target: SellerProductAiMediaService;
  let mockTransaction: jest.Mock;
  let mockManager: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };

  const currentUser: SellerProductUserContext = {
    userId: OWNER_ID,
    email: "seller@bin.local",
    permissions: [],
  };

  beforeEach(() => {
    // Khoi tao fake transaction de test tap trung vao merge media va khong can database that.
    mockManager = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(async (_entity: unknown, value: unknown) => value),
    };
    mockTransaction = jest.fn(async (callback: (manager: EntityManager) => unknown) =>
      callback(mockManager as unknown as EntityManager),
    );
    target = new SellerProductAiMediaService({
      transaction: mockTransaction,
    } as unknown as DataSource, {} as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Apply mot output vao anh nguon tuong ung va bao toan anh thu hai trong gallery.
  it("replaces only selected source images and preserves the rest of the gallery", async () => {
    // Arrange: product co hai anh goc, seller chi chon toi uu anh dau tien.
    const product = Object.assign(new Product(), {
      id: PRODUCT_ID,
      sellerOwnerId: OWNER_ID,
      originType: ProductOriginType.INTERNAL,
      status: ProductStatus.DRAFT,
      name: "Bo do the thao",
      updatedAt: new Date("2026-08-28T10:00:00.000Z"),
      metadata: {},
    });
    const images = [
      Object.assign(new ProductImage(), {
        id: "image-row-1",
        productId: PRODUCT_ID,
        variantId: null,
        imageUrl: "https://cdn.example.com/original-cover.webp",
        altText: "Bo do the thao",
        sortOrder: 0,
        isThumbnail: true,
        externalImageId: SOURCE_IMAGE_ID,
      }),
      Object.assign(new ProductImage(), {
        id: "image-row-2",
        productId: PRODUCT_ID,
        variantId: null,
        imageUrl: "https://cdn.example.com/original-back.webp",
        altText: "Bo do the thao",
        sortOrder: 1,
        isThumbnail: false,
        externalImageId: OTHER_IMAGE_ID,
      }),
    ];
    mockManager.findOne.mockResolvedValue(product);
    mockManager.find.mockResolvedValue(images);

    // Act: apply output co sourceAssetId cua anh dau tien.
    const result = await target.apply(currentUser, PRODUCT_ID, {
      jobId: "e05eb54a-b9fa-4328-9e57-0dda8971c146",
      expectedProductUpdatedAt: product.updatedAt.toISOString(),
      images: [
        {
          assetId: "a9bbf36e-53fd-4986-a909-0ba27ca0c6aa",
          sourceAssetId: SOURCE_IMAGE_ID,
          imageUrl: "https://cdn.example.com/optimized-cover.webp",
          sortOrder: 0,
        },
      ],
    });

    // Assert: chi URL va external ID cua anh duoc chon thay doi; anh con lai va thu tu van con nguyen.
    expect(result.status).toBe("APPLIED");
    expect(images[0]!.imageUrl).toBe("https://cdn.example.com/optimized-cover.webp");
    expect(images[0]!.externalImageId).toBe(SOURCE_IMAGE_ID);
    expect(images[0]!.sourceAssetId).toBe(SOURCE_IMAGE_ID);
    expect(images[0]!.aiAssetId).toBe("a9bbf36e-53fd-4986-a909-0ba27ca0c6aa");
    expect(images[1]!.imageUrl).toBe("https://cdn.example.com/original-back.webp");
    expect(images[1]!.externalImageId).toBe(OTHER_IMAGE_ID);
    expect(images).toHaveLength(2);
    expect(mockManager.save).toHaveBeenCalledWith(ProductImage, images);

    // Lần tối ưu thứ hai dùng output AI đang hiển thị làm source nhưng vẫn giữ ảnh gốc trong lineage.
    await target.apply(currentUser, PRODUCT_ID, {
      jobId: "f06eb54a-b9fa-4328-9e57-0dda8971c146",
      expectedProductUpdatedAt: product.updatedAt.toISOString(),
      images: [
        {
          assetId: "b9bbf36e-53fd-4986-a909-0ba27ca0c6aa",
          sourceAssetId: "a9bbf36e-53fd-4986-a909-0ba27ca0c6aa",
          imageUrl: "https://cdn.example.com/optimized-cover-v2.webp",
          sortOrder: 0,
        },
      ],
    });
    expect(images[0]!.imageUrl).toBe("https://cdn.example.com/optimized-cover-v2.webp");
    expect(images[0]!.sourceAssetId).toBe(SOURCE_IMAGE_ID);
    expect(images[0]!.aiAssetId).toBe("b9bbf36e-53fd-4986-a909-0ba27ca0c6aa");
  });

  // Chan payload khong co source mapping truoc khi co bat ky mutation nao tren product image.
  it("rejects an output when its source image is not in the product gallery", async () => {
    // Arrange: product co gallery nhung source asset tu request khong ton tai.
    const product = Object.assign(new Product(), {
      id: PRODUCT_ID,
      sellerOwnerId: OWNER_ID,
      originType: ProductOriginType.INTERNAL,
      status: ProductStatus.DRAFT,
      updatedAt: new Date("2026-08-28T10:00:00.000Z"),
      metadata: {},
    });
    mockManager.findOne.mockResolvedValue(product);
    mockManager.find.mockResolvedValue([]);

    // Act/Assert: request bi tu choi, product image khong bi save.
    await expect(
      target.apply(currentUser, PRODUCT_ID, {
        jobId: "e05eb54a-b9fa-4328-9e57-0dda8971c146",
        expectedProductUpdatedAt: product.updatedAt.toISOString(),
        images: [
          {
            assetId: "a9bbf36e-53fd-4986-a909-0ba27ca0c6aa",
            sourceAssetId: SOURCE_IMAGE_ID,
            imageUrl: "https://cdn.example.com/optimized-cover.webp",
          },
        ],
      }),
    ).rejects.toThrow(ConflictException);
    expect(mockManager.save).not.toHaveBeenCalled();
  });
});
