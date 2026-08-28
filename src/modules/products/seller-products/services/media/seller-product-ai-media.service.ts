//
// Quan ly apply/rollback output anh AI trong transaction Product Service.
// Service nay khong goi OpenAI va khong xoa asset S3; Media Service giu lifecycle asset sau commit.
//

import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { Product } from "../../../../../database/entities/product.entity";
import { ProductImage } from "../../../../../database/entities/product-image.entity";
import { ProductOriginType } from "../../../shared/enums/product-origin-type.enum";
import { ProductStatus } from "../../../shared/enums/product-status.enum";
import type { SellerProductUserContext } from "../../types/seller-product-user-context.type";
import type { AiMediaMutationResponse } from "../../types/ai-media-response.type";
import type { ApplyAiMediaDto } from "../../dto/ai-media/apply-ai-media.dto";

type OriginalImageSnapshot = {
  imageUrl: string;
  altText: string | null;
  sortOrder: number;
  isThumbnail: boolean;
  variantId?: string | null;
  externalImageId?: string | null;
  sourceAssetId?: string | null;
  aiAssetId?: string | null;
};

//  Service ghi output AI va snapshot anh goc cung mot transaction.
@Injectable()
export class SellerProductAiMediaService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  //
  // Apply anh AI sau khi lock product va kiem tra version seller da xem.
  // Snapshot anh goc duoc ghi vao metadata truoc khi thay ProductImage, vi vay rollback
  // khong can truy cap AI Service. Asset storage khong bi xoa trong transaction de tranh
  // mat kha nang khoi phuc khi Media Service gap loi sau commit.
  //
  async apply(currentUser: SellerProductUserContext, productId: string, dto: ApplyAiMediaDto): Promise<AiMediaMutationResponse> {
    if (dto.images.length === 0) throw new ConflictException("Can it nhat mot anh AI de ap dung.");
    return this.dataSource.transaction(async (manager) => {
      const product = await this.loadOwnedProduct(manager, currentUser.userId, productId);
      if (product.updatedAt.toISOString() !== new Date(dto.expectedProductUpdatedAt).toISOString()) {
        throw new ConflictException("San pham da thay doi trong luc AI xu ly.");
      }
      const previousImages = await manager.find(ProductImage, { where: { productId } });
      const snapshot: OriginalImageSnapshot[] = previousImages.map((image) => ({
        imageUrl: image.imageUrl,
        altText: image.altText,
        sortOrder: image.sortOrder,
        isThumbnail: image.isThumbnail,
        variantId: image.variantId,
        externalImageId: image.externalImageId,
        sourceAssetId: image.sourceAssetId,
        aiAssetId: image.aiAssetId,
      }));

      // Moi output phai tro ve dung mot asset goc; neu khong co mapping thi dung truoc mutation
      // de khong bao gio xoa/thay the nham gallery khi payload cu hoac payload tu client bi sai.
      const outputBySourceAssetId = new Map(dto.images.map((image) => [image.sourceAssetId.toLowerCase(), image]));
      if (outputBySourceAssetId.size !== dto.images.length) {
        throw new ConflictException("Moi anh AI phai co source asset duy nhat.");
      }
      const sourceImagesByAssetId = new Map(
        previousImages
          .flatMap((image) => [image.sourceAssetId, image.aiAssetId, image.externalImageId]
            .filter((assetId): assetId is string => Boolean(assetId))
            .map((assetId) => [assetId.toLowerCase(), image] as const)),
      );
      if ([...outputBySourceAssetId.keys()].some((sourceAssetId) => !sourceImagesByAssetId.has(sourceAssetId))) {
        throw new ConflictException("Khong tim thay anh goc cua output AI trong san pham.");
      }

      // Chi cap nhat cac row co sourceAssetId duoc chon; cac anh khac giu nguyen URL, thu tu,
      // thumbnail, variant va external ID. Day la invariant giup apply AI khong lam mat gallery.
      for (const image of previousImages) {
        const imageAssetIds = [image.aiAssetId, image.sourceAssetId, image.externalImageId]
          .filter((assetId): assetId is string => Boolean(assetId));
        const output = imageAssetIds
          .map((assetId) => outputBySourceAssetId.get(assetId.toLowerCase()))
          .find((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
        if (!output) continue;
        image.imageUrl = output.imageUrl.trim();
        // externalImageId giữ asset nguồn để worker có thể đọc lại ảnh này ở lần tối ưu kế tiếp.
        image.sourceAssetId = image.sourceAssetId ?? image.externalImageId ?? output.sourceAssetId;
        image.externalImageId = image.sourceAssetId;
        image.aiAssetId = output.assetId;
      }
      await manager.save(ProductImage, previousImages);
      product.metadata = {
        ...(product.metadata ?? {}),
        aiOptimizationOriginalImages: snapshot,
      };
      product.aiOptimizationJobId = dto.jobId;
      product.aiOptimizationStatus = "APPLIED";
      product.aiOptimizedAt = new Date();
      const saved = await manager.save(Product, product);
      return { productId, jobId: dto.jobId, status: "APPLIED", updatedAt: saved.updatedAt };
    });
  }

  //  Khoi phuc snapshot anh goc va xoa metadata tam de product quay ve trang thai truoc apply.
  async rollback(currentUser: SellerProductUserContext, productId: string, jobId: string): Promise<AiMediaMutationResponse> {
    return this.dataSource.transaction(async (manager) => {
      const product = await this.loadOwnedProduct(manager, currentUser.userId, productId);
      if (product.aiOptimizationJobId !== jobId || product.aiOptimizationStatus !== "APPLIED") {
        throw new ConflictException("San pham khong co output AI de khoi phuc.");
      }
      const snapshot = this.readSnapshot(product.metadata?.aiOptimizationOriginalImages);
      if (snapshot.length === 0) throw new ConflictException("Khong tim thay snapshot anh goc.");
      await manager.delete(ProductImage, { productId });
      await manager.save(ProductImage, snapshot.map((image) => manager.create(ProductImage, {
        productId,
        variantId: image.variantId ?? null,
        imageUrl: image.imageUrl,
        altText: image.altText,
        sortOrder: image.sortOrder,
        isThumbnail: image.isThumbnail,
        externalImageId: image.externalImageId ?? null,
        sourceAssetId: image.sourceAssetId ?? null,
        aiAssetId: image.aiAssetId ?? null,
      })));
      const metadata = { ...(product.metadata ?? {}) };
      delete metadata.aiOptimizationOriginalImages;
      product.metadata = metadata;
      product.aiOptimizationStatus = "ROLLED_BACK";
      const saved = await manager.save(Product, product);
      return { productId, jobId, status: "ROLLED_BACK", updatedAt: saved.updatedAt };
    });
  }

  //  Lock product va chan product deleted/crawler khong thuoc luong seller noi bo.
  private async loadOwnedProduct(manager: EntityManager, ownerId: string, productId: string): Promise<Product> {
    const product = await manager.findOne(Product, {
      where: { id: productId, sellerOwnerId: ownerId, originType: ProductOriginType.INTERNAL },
      lock: { mode: "pessimistic_write" },
    });
    if (!product || product.status === ProductStatus.DELETED) throw new NotFoundException("Khong tim thay san pham trong shop.");
    return product;
  }

  //  Parse snapshot JSONB theo whitelist field de metadata hong khong lam hong rollback.
  private readSnapshot(value: unknown): OriginalImageSnapshot[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is OriginalImageSnapshot => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Record<string, unknown>;
      return typeof candidate.imageUrl === "string" && typeof candidate.sortOrder === "number" && typeof candidate.isThumbnail === "boolean";
    });
  }
}
