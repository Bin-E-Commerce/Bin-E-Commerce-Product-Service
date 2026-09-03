// Service này xử lý soft-delete product cùng các variant trong transaction và bảo toàn khả năng restore.
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { ProductVariant } from "../../../../../database/catalog/entities/product-variant.entity";
import { Product } from "../../../../../database/catalog/entities/product.entity";
import { ProductOriginType } from "../../../../../database/catalog/enums/product-origin-type.enum";
import { ProductStatus } from "../../../../../database/catalog/enums/product-status.enum";
import type { DeleteProductResponse } from "../../types/delete-product-response.type";
import type { SellerProductUserContext } from "../../types/seller-product-user-context.type";

@Injectable()
export class SellerProductDeletionService {
  constructor(private readonly dataSource: DataSource) {}

  // Khóa product theo ownership, kiểm tra vòng đời/bán hàng rồi chuyển sang DELETED trong một transaction.
  async delete(
    currentUser: SellerProductUserContext,
    productId: string,
  ): Promise<DeleteProductResponse> {
    return this.dataSource.transaction(async (manager) => {
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

      // Giữ nguyên product graph và media để API restore có thể khôi phục đầy đủ dữ liệu.
      product.status = ProductStatus.DELETED;
      product.deletedAt = new Date();
      product.deletedBy = currentUser.userId;
      await manager.save(Product, product);

      return {
        id: product.id,
        status: ProductStatus.DELETED as const,
        updatedAt: product.updatedAt,
      };
    });
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

  // Tải product bằng pessimistic lock và dùng cùng phản hồi not-found cho product khác owner.
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
}
