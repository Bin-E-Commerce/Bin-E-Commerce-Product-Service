// Read model dashboard seller của Product Service, chỉ sở hữu dữ liệu product và inventory.
// Service này không quyết định quyền truy cập; controller đã bảo vệ endpoint bằng internal guard.

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '@/database/catalog/entities/product.entity';
import { ProductStatus } from '@/database/catalog/enums/product-status.enum';
import { ProductOriginType } from '@/database/catalog/enums/product-origin-type.enum';
import { ProductVariantStatus } from '@/database/catalog/enums/product-variant-status.enum';
import type { InternalSellerDashboardProductSnapshot } from '@/modules/internal/application/types/internal-seller-dashboard-product.type';

// Tách aggregate catalog/tồn khỏi HTTP layer; không đưa số bán tích lũy vào read model bán theo kỳ.
@Injectable()
export class InternalSellerDashboardProductService {
    constructor(
        @InjectRepository(Product)
        private readonly productRepository: Repository<Product>,
    ) {}

    // Tổng hợp catalog/tồn theo shop và owner; owner khôi phục sản phẩm legacy thiếu shopId, DISTINCT tránh đếm lặp nhánh OR.
    async getSnapshot(
        shopId: string,
        ownerUserId?: string,
    ): Promise<InternalSellerDashboardProductSnapshot> {
        const summaryRow = await this.productRepository
            .createQueryBuilder('product')
            .select(
                'COUNT(DISTINCT product.id) FILTER (WHERE product.status != :deletedStatus)',
                'catalogProducts',
            )
            .addSelect(
                'COUNT(DISTINCT product.id) FILTER (WHERE product.status = :activeStatus)',
                'activeProducts',
            )
            .addSelect(
                `COUNT(DISTINCT product.id) FILTER (
                    WHERE product.status = :activeStatus
                    AND EXISTS (
                        SELECT 1 FROM product_variants stock_variant
                        LEFT JOIN inventories stock_inventory
                            ON stock_inventory.variant_id = stock_variant.id
                        WHERE stock_variant.product_id = product.id
                          AND stock_variant.status = :activeVariantStatus
                          AND COALESCE(stock_inventory.quantity_available, stock_variant.stock_quantity) > 0
                    )
                )`,
                'inStockProducts',
            )
            .addSelect(
                `COALESCE(SUM(
                    CASE
                        WHEN product.status = :activeStatus
                          AND variant.status = :activeVariantStatus
                        THEN GREATEST(
                            COALESCE(inventory.quantity_available, variant.stock_quantity),
                            0
                        )
                        ELSE 0
                    END
                ), 0)`,
                'stockUnits',
            )
            .addSelect(
                `COUNT(DISTINCT product.id) FILTER (
                    WHERE product.status = :activeStatus
                    AND NOT EXISTS (
                        SELECT 1 FROM product_variants stock_variant
                        LEFT JOIN inventories stock_inventory
                            ON stock_inventory.variant_id = stock_variant.id
                        WHERE stock_variant.product_id = product.id
                          AND stock_variant.status = :activeVariantStatus
                          AND COALESCE(stock_inventory.quantity_available, stock_variant.stock_quantity) > 0
                    )
                )`,
                'outOfStockProducts',
            )
            .where(
                ownerUserId
                    ? '(product.seller_shop_id = :shopId OR product.seller_owner_id = :ownerUserId)'
                    : 'product.seller_shop_id = :shopId',
                { shopId, ...(ownerUserId ? { ownerUserId } : {}) },
            )
            .andWhere('product.origin_type = :originType', {
                originType: ProductOriginType.INTERNAL,
            })
            .leftJoin('product.variants', 'variant')
            .leftJoin('variant.inventory', 'inventory')
            .setParameters({
                deletedStatus: ProductStatus.DELETED,
                activeStatus: ProductStatus.ACTIVE,
                activeVariantStatus: ProductVariantStatus.ACTIVE,
            })
            .getRawOne<{
                catalogProducts: string;
                activeProducts: string;
                inStockProducts: string;
                stockUnits: string;
                outOfStockProducts: string;
            }>();

        return {
            summary: {
                catalogProducts: Number(summaryRow?.catalogProducts ?? 0),
                activeProducts: Number(summaryRow?.activeProducts ?? 0),
                inStockProducts: Number(summaryRow?.inStockProducts ?? 0),
                stockUnits: Number(summaryRow?.stockUnits ?? 0),
                outOfStockProducts: Number(summaryRow?.outOfStockProducts ?? 0),
            },
        };
    }
}
