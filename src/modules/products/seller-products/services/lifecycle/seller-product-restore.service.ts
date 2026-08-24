import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { Product } from "../../../../../database/entities/product.entity";
import { ProductOriginType } from "../../../shared/enums/product-origin-type.enum";
import { ProductStatus } from "../../../shared/enums/product-status.enum";
import type { RestoreProductResponse } from "../../types/restore-product-response.type";
import type { SellerProductUserContext } from "../../types/seller-product-user-context.type";

@Injectable()
export class SellerProductRestoreService {
  constructor(private readonly dataSource: DataSource) {}

  // Khôi phục product thuộc đúng seller về INACTIVE để không tự xuất hiện lại trên storefront.
  async restore(
    currentUser: SellerProductUserContext,
    productId: string,
  ): Promise<RestoreProductResponse> {
    return this.dataSource.transaction(async (manager) => {
      const product = await this.loadDeletedProduct(
        manager,
        productId,
        currentUser.userId,
      );

      product.status = ProductStatus.INACTIVE;
      product.deletedAt = null;
      product.deletedBy = null;
      await manager.save(Product, product);

      return {
        id: product.id,
        status: ProductStatus.INACTIVE as const,
        updatedAt: product.updatedAt,
      };
    });
  }

  // Khóa bản ghi để tránh restore đồng thời và phân biệt product không tồn tại với product chưa bị xóa.
  private async loadDeletedProduct(
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

    if (!product) {
      throw new NotFoundException("Không tìm thấy sản phẩm trong shop của bạn.");
    }

    if (product.status !== ProductStatus.DELETED) {
      throw new ConflictException("Sản phẩm này chưa ở trạng thái đã xóa.");
    }

    return product;
  }
}
