// Service này là transaction boundary cho quote và reservation tồn kho.
// Product Service sở hữu giá, trạng thái và inventory nên mọi checkout phải đi qua đây.
// Các inventory row được lock theo thứ tự variant ID để giảm nguy cơ deadlock khi nhiều checkout đồng thời.

import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { CheckoutReservation } from "../../../database/checkout/entities/checkout-reservation.entity";
import { CheckoutReservationStatus } from "../../../database/checkout/enums/checkout-reservation-status.enum";
import { Inventory } from "../../../database/inventory/entities/inventory.entity";
import { ProductVariant } from "../../../database/catalog/entities/product-variant.entity";
import { Product } from "../../../database/catalog/entities/product.entity";
import { ProductOriginType } from "../../../database/catalog/enums/product-origin-type.enum";
import { ProductStatus } from "../../../database/catalog/enums/product-status.enum";
import { ProductVariantStatus } from "../../../database/catalog/enums/product-variant-status.enum";
import type {
  ReleaseCheckoutDto,
  ReserveCheckoutDto,
} from "../dto/checkout-reservation.dto";
import type {
  CheckoutReservationResponse,
  CheckoutSnapshotItem,
} from "../types/checkout-response.type";

// Giữ hoặc trả inventory atomically; Product Service không mở transaction xuyên database với Order.
@Injectable()
export class CheckoutInventoryService {
  constructor(private readonly dataSource: DataSource) {}

  // Revalidate tất cả dòng, lock inventory, giảm available và trả snapshot authoritative trong một transaction.
  async reserve(dto: ReserveCheckoutDto): Promise<CheckoutReservationResponse> {
    return this.dataSource.transaction(async (manager) => {
      // Advisory lock tuần tự hóa request đầu tiên cùng key trước khi insert unique reservation.
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        dto.reservationKey,
      ]);
      const reservationRepository = manager.getRepository(CheckoutReservation);
      const existing = await reservationRepository.findOne({
        where: { reservationKey: dto.reservationKey },
        lock: { mode: "pessimistic_write" },
      });
      if (existing?.status === CheckoutReservationStatus.RELEASED) {
        throw new ConflictException(
          "Reservation đã được release và không thể reserve lại.",
        );
      }
      if (existing)
        return existing.response as unknown as CheckoutReservationResponse;

      const variantIds = [
        ...new Set(dto.items.map((item) => item.variantId)),
      ].sort();
      const variants = await manager.getRepository(ProductVariant).find({
        where: { id: In(variantIds) },
        relations: { product: { images: true }, inventory: true },
      });
      const variantById = new Map(
        variants.map((variant) => [variant.id, variant]),
      );
      const snapshots: CheckoutSnapshotItem[] = [];
      const soldByProductId = new Map<string, number>();

      // Lock riêng các inventory row trước khi kiểm tra để hai order không cùng tiêu thụ một stock.
      const inventories = await manager
        .getRepository(Inventory)
        .createQueryBuilder("inventory")
        .where("inventory.variant_id IN (:...variantIds)", { variantIds })
        .orderBy("inventory.variant_id", "ASC")
        .setLock("pessimistic_write")
        .getMany();
      const inventoryByVariantId = new Map(
        inventories.map((inventory) => [inventory.variantId, inventory]),
      );

      for (const item of dto.items) {
        const variant = variantById.get(item.variantId);
        if (!variant || variant.productId !== item.productId) {
          throw new NotFoundException(
            "Không tìm thấy variant thuộc sản phẩm đã chọn.",
          );
        }
        if (
          variant.product.status !== ProductStatus.ACTIVE ||
          variant.product.originType !== ProductOriginType.INTERNAL
        ) {
          throw new UnprocessableEntityException(
            "Sản phẩm không còn được bán trên hệ thống.",
          );
        }
        if (variant.status !== ProductVariantStatus.ACTIVE) {
          throw new UnprocessableEntityException(
            "Variant không còn được bán trên hệ thống.",
          );
        }

        // Chặn checkout khi seller chưa khai báo kiện hàng thay vì tự đoán trọng lượng/kích thước.
        const packageValues = [
          variant.product.packageWeightGrams,
          variant.product.packageLengthCm,
          variant.product.packageWidthCm,
          variant.product.packageHeightCm,
        ];
        if (!packageValues.every((value) => value !== null && Number(value) > 0)) {
          throw new UnprocessableEntityException(
            "Sản phẩm chưa đủ thông tin đóng gói để tính phí giao hàng.",
          );
        }

        const inventory = inventoryByVariantId.get(variant.id);
        if (!inventory || inventory.quantityAvailable < item.quantity) {
          throw new ConflictException(
            `Variant ${variant.sku} không còn đủ tồn kho.`,
          );
        }

        inventory.quantityAvailable -= item.quantity;
        inventory.quantityReserved += item.quantity;
        inventory.quantitySold += item.quantity;
        await manager.getRepository(Inventory).save(inventory);
        soldByProductId.set(
          variant.productId,
          (soldByProductId.get(variant.productId) ?? 0) + item.quantity,
        );

        snapshots.push({
          productId: variant.productId,
          variantId: variant.id,
          sellerShopId: variant.product.sellerShopId,
          sellerOwnerId: variant.product.sellerOwnerId,
          sku: variant.sku,
          productName: variant.product.name,
          variantName: variant.name,
          imageUrl: this.getSnapshotImageUrl(variant),
          unitPrice: variant.price,
          quantity: item.quantity,
          lineTotal: this.multiplyMoney(variant.price, item.quantity),
          packageWeightGrams: Number(variant.product.packageWeightGrams),
          packageLengthCm: Number(variant.product.packageLengthCm),
          packageWidthCm: Number(variant.product.packageWidthCm),
          packageHeightCm: Number(variant.product.packageHeightCm),
        });
      }

      // Ghi nhận sold cùng transaction với reservation để retry idempotent không cộng trùng lượt bán.
      for (const [productId, quantity] of soldByProductId) {
        await manager.getRepository(Product).increment({ id: productId }, "totalSold", quantity);
      }

      const response: CheckoutReservationResponse = {
        reservationKey: dto.reservationKey,
        items: snapshots,
      };
      await reservationRepository.save(
        reservationRepository.create({
          reservationKey: dto.reservationKey,
          status: CheckoutReservationStatus.RESERVED,
          response: response as unknown as Record<string, unknown>,
          releasedAt: null,
        }),
      );
      return response;
    });
  }

  // Đọc snapshot authoritative cho quote mà không giữ hoặc thay đổi tồn kho.
  async quote(dto: ReserveCheckoutDto): Promise<CheckoutReservationResponse> {
    return this.dataSource.transaction(async (manager) => {
      const variantIds = [...new Set(dto.items.map((item) => item.variantId))].sort();
      const variants = await manager.getRepository(ProductVariant).find({
        where: { id: In(variantIds) },
        relations: { product: { images: true }, inventory: true },
      });
      const variantById = new Map(variants.map((variant) => [variant.id, variant]));
      const snapshots: CheckoutSnapshotItem[] = [];
      for (const item of dto.items) {
        const variant = variantById.get(item.variantId);
        if (!variant || variant.productId !== item.productId) {
          throw new NotFoundException("Không tìm thấy variant thuộc sản phẩm đã chọn.");
        }
        if (variant.product.status !== ProductStatus.ACTIVE || variant.product.originType !== ProductOriginType.INTERNAL || variant.status !== ProductVariantStatus.ACTIVE) {
          throw new UnprocessableEntityException("Sản phẩm không còn được bán trên hệ thống.");
        }
        const packageValues = [variant.product.packageWeightGrams, variant.product.packageLengthCm, variant.product.packageWidthCm, variant.product.packageHeightCm];
        if (!packageValues.every((value) => value !== null && Number(value) > 0)) {
          throw new UnprocessableEntityException("Sản phẩm chưa đủ thông tin đóng gói để tính phí giao hàng.");
        }
        snapshots.push({
          productId: variant.productId,
          variantId: variant.id,
          sellerShopId: variant.product.sellerShopId,
          sellerOwnerId: variant.product.sellerOwnerId,
          sku: variant.sku,
          productName: variant.product.name,
          variantName: variant.name,
          imageUrl: this.getSnapshotImageUrl(variant),
          unitPrice: variant.price,
          quantity: item.quantity,
          lineTotal: this.multiplyMoney(variant.price, item.quantity),
          packageWeightGrams: Number(variant.product.packageWeightGrams),
          packageLengthCm: Number(variant.product.packageLengthCm),
          packageWidthCm: Number(variant.product.packageWidthCm),
          packageHeightCm: Number(variant.product.packageHeightCm),
        });
      }
      return { reservationKey: dto.reservationKey, items: snapshots };
    });
  }

  // Trả lại lượng reserved khi Order Service không thể commit order sau bước reserve.
  async release(dto: ReleaseCheckoutDto): Promise<{ released: boolean }> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        dto.reservationKey,
      ]);
      const reservationRepository = manager.getRepository(CheckoutReservation);
      const reservation = await reservationRepository.findOne({
        where: { reservationKey: dto.reservationKey },
        lock: { mode: "pessimistic_write" },
      });
      if (reservation?.status === CheckoutReservationStatus.RELEASED) return;

      // Cho phép hủy order tạo từ Phase 1 trước khi ledger được triển khai; lần release này sẽ tạo marker RELEASED.
      const releaseItems: Array<{
        productId?: string;
        variantId: string;
        quantity: number;
      }> = reservation
        ? (
            reservation.response as unknown as CheckoutReservationResponse
          ).items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
          }))
        : dto.items.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
          }));
      const variantIds = [
        ...new Set(releaseItems.map((item) => item.variantId)),
      ].sort();
      const inventories = await manager
        .getRepository(Inventory)
        .createQueryBuilder("inventory")
        .where("inventory.variant_id IN (:...variantIds)", { variantIds })
        .orderBy("inventory.variant_id", "ASC")
        .setLock("pessimistic_write")
        .getMany();
      const inventoryByVariantId = new Map(
        inventories.map((inventory) => [inventory.variantId, inventory]),
      );

      for (const item of releaseItems) {
        const inventory = inventoryByVariantId.get(item.variantId);
        if (!inventory || inventory.quantityReserved < item.quantity) {
          throw new NotFoundException(
            "Không tìm thấy reservation để hoàn tồn kho.",
          );
        }
        inventory.quantityReserved -= item.quantity;
        inventory.quantityAvailable += item.quantity;
        inventory.quantitySold = Math.max(inventory.quantitySold - item.quantity, 0);
        await manager.getRepository(Inventory).save(inventory);

        if (item.productId) {
          // Không để dữ liệu cũ hoặc request retry làm totalSold âm khi hoàn tác reservation.
          await manager.query(
            `UPDATE products SET total_sold = GREATEST(total_sold - $1, 0) WHERE id = $2`,
            [item.quantity, item.productId],
          );
        }
      }
      const releasedReservation =
        reservation ??
        reservationRepository.create({
          reservationKey: dto.reservationKey,
            status: CheckoutReservationStatus.RELEASED,
          response: { reservationKey: dto.reservationKey, items: releaseItems },
          releasedAt: new Date(),
        });
      if (reservation) {
        reservation.status = CheckoutReservationStatus.RELEASED;
        reservation.releasedAt = new Date();
      }
      await reservationRepository.save(releasedReservation);
    });
    return { released: true };
  }

  // Nhân giá decimal hai chữ số bằng số nguyên để snapshot lineTotal không bị sai số.
  private multiplyMoney(value: string, quantity: number): string {
    const [whole = "", fraction = ""] = value.split(".");
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
    const total = cents * BigInt(quantity);
    return `${total / 100n}.${(total % 100n).toString().padStart(2, "0")}`;
  }

  // Chọn ảnh snapshot theo thứ tự ảnh URL của variant, ảnh gallery gắn với variant, thumbnail product rồi ảnh đầu tiên.
  // Ảnh variant có độ ưu tiên cao nhất vì phản ánh đúng SKU khách đã chọn; fallback product giúp các sản phẩm
  // chỉ khai báo ảnh ở gallery vẫn hiển thị đúng trên lịch sử đơn hàng.
  private getSnapshotImageUrl(variant: ProductVariant): string | null {
    if (variant.imageUrl) return variant.imageUrl;

    const productImages = variant.product.images ?? [];
    const variantGalleryImage = productImages.find(
      (image) => image.variantId === variant.id,
    );
    if (variantGalleryImage) return variantGalleryImage.imageUrl;

    const thumbnail = productImages.find((image) => image.isThumbnail);
    if (thumbnail) return thumbnail.imageUrl;

    return [...productImages].sort(
      (left, right) => left.sortOrder - right.sortOrder,
    )[0]?.imageUrl ?? null;
  }
}
