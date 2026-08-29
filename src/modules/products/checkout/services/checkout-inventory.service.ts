// Service này là transaction boundary cho quote và reservation tồn kho.
// Product Service sở hữu giá, trạng thái và inventory nên mọi checkout phải đi qua đây.
// Các inventory row được lock theo thứ tự variant ID để giảm nguy cơ deadlock khi nhiều checkout đồng thời.

import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { Inventory } from "../../../../database/entities/inventory.entity";
import { ProductVariant } from "../../../../database/entities/product-variant.entity";
import { ProductOriginType } from "../../shared/enums/product-origin-type.enum";
import { ProductStatus } from "../../shared/enums/product-status.enum";
import { ProductVariantStatus } from "../../shared/enums/product-variant-status.enum";
import type { ReleaseCheckoutDto, ReserveCheckoutDto } from "../dto/checkout-reservation.dto";
import type { CheckoutReservationResponse, CheckoutSnapshotItem } from "../types/checkout-response.type";

// Giữ hoặc trả inventory atomically; Product Service không mở transaction xuyên database với Order.
@Injectable()
export class CheckoutInventoryService {
  constructor(private readonly dataSource: DataSource) {}

  // Revalidate tất cả dòng, lock inventory, giảm available và trả snapshot authoritative trong một transaction.
  async reserve(dto: ReserveCheckoutDto): Promise<CheckoutReservationResponse> {
    return this.dataSource.transaction(async (manager) => {
      const variantIds = [...new Set(dto.items.map((item) => item.variantId))].sort();
      const variants = await manager.getRepository(ProductVariant).find({
        where: { id: In(variantIds) },
        relations: { product: true, inventory: true },
      });
      const variantById = new Map(variants.map((variant) => [variant.id, variant]));
      const snapshots: CheckoutSnapshotItem[] = [];

      // Lock riêng các inventory row trước khi kiểm tra để hai order không cùng tiêu thụ một stock.
      const inventories = await manager
        .getRepository(Inventory)
        .createQueryBuilder("inventory")
        .where("inventory.variant_id IN (:...variantIds)", { variantIds })
        .orderBy("inventory.variant_id", "ASC")
        .setLock("pessimistic_write")
        .getMany();
      const inventoryByVariantId = new Map(inventories.map((inventory) => [inventory.variantId, inventory]));

      for (const item of dto.items) {
        const variant = variantById.get(item.variantId);
        if (!variant || variant.productId !== item.productId) {
          throw new NotFoundException("Không tìm thấy variant thuộc sản phẩm đã chọn.");
        }
        if (variant.product.status !== ProductStatus.ACTIVE || variant.product.originType !== ProductOriginType.INTERNAL) {
          throw new UnprocessableEntityException("Sản phẩm không còn được bán trên hệ thống.");
        }
        if (variant.status !== ProductVariantStatus.ACTIVE) {
          throw new UnprocessableEntityException("Variant không còn được bán trên hệ thống.");
        }

        const inventory = inventoryByVariantId.get(variant.id);
        if (!inventory || inventory.quantityAvailable < item.quantity) {
          throw new ConflictException(`Variant ${variant.sku} không còn đủ tồn kho.`);
        }

        inventory.quantityAvailable -= item.quantity;
        inventory.quantityReserved += item.quantity;
        await manager.getRepository(Inventory).save(inventory);

        snapshots.push({
          productId: variant.productId,
          variantId: variant.id,
          sellerShopId: variant.product.sellerShopId,
          sku: variant.sku,
          productName: variant.product.name,
          variantName: variant.name,
          imageUrl: variant.imageUrl,
          unitPrice: variant.price,
          quantity: item.quantity,
          lineTotal: this.multiplyMoney(variant.price, item.quantity),
        });
      }

      return { reservationKey: dto.reservationKey, items: snapshots };
    });
  }

  // Trả lại lượng reserved khi Order Service không thể commit order sau bước reserve.
  async release(dto: ReleaseCheckoutDto): Promise<{ released: boolean }> {
    await this.dataSource.transaction(async (manager) => {
      const variantIds = [...new Set(dto.items.map((item) => item.variantId))].sort();
      const inventories = await manager
        .getRepository(Inventory)
        .createQueryBuilder("inventory")
        .where("inventory.variant_id IN (:...variantIds)", { variantIds })
        .orderBy("inventory.variant_id", "ASC")
        .setLock("pessimistic_write")
        .getMany();
      const inventoryByVariantId = new Map(inventories.map((inventory) => [inventory.variantId, inventory]));

      for (const item of dto.items) {
        const inventory = inventoryByVariantId.get(item.variantId);
        if (!inventory || inventory.quantityReserved < item.quantity) {
          throw new NotFoundException("Không tìm thấy reservation để hoàn tồn kho.");
        }
        inventory.quantityReserved -= item.quantity;
        inventory.quantityAvailable += item.quantity;
        await manager.getRepository(Inventory).save(inventory);
      }
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
}
