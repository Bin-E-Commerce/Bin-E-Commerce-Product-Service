import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager, In, Not } from "typeorm";
import { ProductImage } from "../../../../../database/entities/product-image.entity";
import { ProductVariant } from "../../../../../database/entities/product-variant.entity";
import { Product } from "../../../../../database/entities/product.entity";
import { ProductOriginType } from "../../../shared/enums/product-origin-type.enum";
import { ProductStatus } from "../../../shared/enums/product-status.enum";
import { ProductMediaClient } from "../../integrations/product-media.client";
import type { ProductMediaReference } from "../../types/product-media-reference.type";
import type { SellerProductUserContext } from "../../types/seller-product-user-context.type";
import type { DeleteProductResponse } from "../../types/delete-product-response.type";
import {
  parseProductMediaReference,
  uniqueProductMediaReferences,
} from "../../utils/product-media-reference.util";

@Injectable()
export class SellerProductDeletionService {
  private readonly logger = new Logger(SellerProductDeletionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly productMediaClient: ProductMediaClient,
  ) {}

  // Khóa product theo ownership, kiểm tra vòng đời/bán hàng rồi chuyển sang DELETED trong một transaction.
  async delete(
    currentUser: SellerProductUserContext,
    productId: string,
  ): Promise<DeleteProductResponse> {
    const transactionResult = await this.dataSource.transaction(async (manager) => {
      const product = await this.loadProductForDelete(
        manager,
        productId,
        currentUser.userId,
      );
      const variants = await manager.find(ProductVariant, {
        where: { productId: product.id },
        relations: { inventory: true },
      });

      this.assertCanDelete(product, variants);

      const images = await manager.find(ProductImage, {
        where: { productId: product.id },
      });
      const oldVideoReference = product.videoAssetId
        ? { assetId: product.videoAssetId, purpose: "product_video" as const }
        : parseProductMediaReference(product.videoUrl, "product_video");
      const mediaCandidates = uniqueProductMediaReferences([
        ...images.map((image) =>
          parseProductMediaReference(image.imageUrl, "product_image"),
        ),
        oldVideoReference,
      ]);
      const mediaToCleanup = await this.filterSharedMedia(
        manager,
        product.id,
        images,
        oldVideoReference,
        mediaCandidates,
      );

      product.status = ProductStatus.DELETED;
      await manager.save(Product, product);

      return {
        response: {
          id: product.id,
          status: ProductStatus.DELETED as const,
          updatedAt: product.updatedAt,
        },
        mediaToCleanup,
      };
    });

    await this.cleanupMedia(currentUser.userId, transactionResult.mediaToCleanup);
    return transactionResult.response;
  }

  // Chỉ cho phép xóa mềm bản nháp/ngừng bán và chặn sản phẩm đang bán hoặc đã phát sinh giao dịch.
  private assertCanDelete(product: Product, variants: ProductVariant[]): void {
    if (product.status === ProductStatus.ACTIVE) {
      throw new ConflictException(
        "Không thể xóa sản phẩm đang hoạt động. Hãy ngừng bán sản phẩm trước.",
      );
    }

    const hasSales =
      product.totalSold > 0 ||
      variants.some((variant) => (variant.inventory?.quantitySold ?? 0) > 0);
    if (hasSales) {
      throw new ConflictException(
        "Không thể xóa sản phẩm đã phát sinh bán hàng để bảo toàn lịch sử giao dịch.",
      );
    }
  }

  // Tải product bằng pessimistic lock và không JOIN inventory nullable trong câu SELECT bị khóa.
  private async loadProductForDelete(
    manager: EntityManager,
    productId: string,
    ownerId: string,
  ): Promise<Product> {
    const product = await manager.findOne(Product, {
      where: {
        id: productId,
        sellerOwnerId: ownerId,
        originType: ProductOriginType.INTERNAL,
      },
      lock: { mode: "pessimistic_write" },
    });

    if (!product || product.status === ProductStatus.DELETED) {
      throw new NotFoundException("Không tìm thấy sản phẩm trong shop của bạn.");
    }

    return product;
  }

  // Không dọn asset nếu URL hoặc video ID vẫn được product khác tham chiếu.
  private async filterSharedMedia(
    manager: EntityManager,
    productId: string,
    images: ProductImage[],
    videoReference: ProductMediaReference | null,
    mediaCandidates: ProductMediaReference[],
  ): Promise<ProductMediaReference[]> {
    if (mediaCandidates.length === 0) return [];

    const imageUrls = images
      .filter((image) =>
        mediaCandidates.some(
          (media) =>
            media.purpose === "product_image" &&
            parseProductMediaReference(image.imageUrl, "product_image")?.assetId ===
              media.assetId,
        ),
      )
      .map((image) => image.imageUrl);
    const sharedImages = imageUrls.length
      ? await manager.find(ProductImage, {
          where: imageUrls.map((imageUrl) => ({
            imageUrl,
            productId: Not(productId),
          })),
        })
      : [];
    const sharedImageKeys = new Set(
      sharedImages
        .map((image) => parseProductMediaReference(image.imageUrl, "product_image"))
        .filter((media): media is ProductMediaReference => media !== null)
        .map((media) => `${media.purpose}:${media.assetId}`),
    );
    const sharedVideoCount = videoReference
      ? await manager.count(Product, {
          where: {
            id: Not(productId),
            videoAssetId: In([videoReference.assetId]),
          },
        })
      : 0;

    return mediaCandidates.filter((media) => {
      if (sharedImageKeys.has(`${media.purpose}:${media.assetId}`)) return false;
      if (
        media.purpose === "product_video" &&
        videoReference?.assetId === media.assetId &&
        sharedVideoCount > 0
      ) {
        return false;
      }
      return true;
    });
  }

  // Dọn media sau commit theo cơ chế best-effort để lỗi S3 không rollback trạng thái DELETED.
  private async cleanupMedia(
    userId: string,
    mediaToCleanup: ProductMediaReference[],
  ): Promise<void> {
    if (mediaToCleanup.length === 0) return;

    try {
      await this.productMediaClient.cleanupProductAssets(userId, mediaToCleanup);
    } catch (error) {
      this.logger.warn(
        `Product deletion committed but media cleanup deferred for ${mediaToCleanup.length} assets: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }
}
