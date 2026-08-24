import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { Product } from "../../../../../database/entities/product.entity";
import { ProductOriginType } from "../../../shared/enums/product-origin-type.enum";
import { ProductStatus } from "../../../shared/enums/product-status.enum";
import type { SellerProductUserContext } from "../../types/seller-product-user-context.type";
import type { ChangeProductStatusResponse } from "../../types/change-product-status-response.type";

type SellerProductPublicationStatus =
  | ProductStatus.ACTIVE
  | ProductStatus.INACTIVE;

@Injectable()
export class SellerProductStatusService {
  constructor(private readonly dataSource: DataSource) {}

  // Đổi trạng thái vận hành trong transaction, khóa đúng product theo owner để tránh cập nhật nhầm shop hoặc ghi đè đồng thời.
  async changeStatus(
    currentUser: SellerProductUserContext,
    productId: string,
    targetStatus: SellerProductPublicationStatus,
  ): Promise<ChangeProductStatusResponse> {
    return this.dataSource.transaction(async (manager) => {
      const product = await this.loadProductForStatusChange(
        manager,
        productId,
        currentUser.userId,
      );

      this.assertStatusTransition(product.status, targetStatus);

      // PATCH lặp lại cùng trạng thái là idempotent nên không tạo thêm lần cập nhật không cần thiết.
      if (product.status === targetStatus) {
        return this.toResponse(product, targetStatus);
      }

      product.status = targetStatus;
      await manager.save(Product, product);
      return this.toResponse(product, targetStatus);
    });
  }

  // Chỉ cho phép bật/tắt sản phẩm nội bộ thuộc đúng seller, đồng thời ẩn product đã xóa như một not-found.
  private async loadProductForStatusChange(
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

  // Không biến bản nháp thành INACTIVE; seller phải hoàn thiện và đăng bán bản nháp trước.
  private assertStatusTransition(
    currentStatus: ProductStatus,
    targetStatus: SellerProductPublicationStatus,
  ): void {
    if (
      currentStatus === ProductStatus.DRAFT &&
      targetStatus === ProductStatus.INACTIVE
    ) {
      throw new ConflictException(
        "Sản phẩm bản nháp chưa thể chuyển sang trạng thái ngừng bán. Hãy đăng bán sản phẩm trước.",
      );
    }
  }

  // Chuẩn hóa response để controller không trả toàn bộ entity và không làm lộ dữ liệu nội bộ.
  private toResponse(
    product: Product,
    status: SellerProductPublicationStatus,
  ): ChangeProductStatusResponse {
    return {
      id: product.id,
      status,
      updatedAt: product.updatedAt,
    };
  }
}
