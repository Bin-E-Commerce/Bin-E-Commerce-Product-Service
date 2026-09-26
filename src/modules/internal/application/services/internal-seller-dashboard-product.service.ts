// Read model dashboard seller của Product Service, chỉ sở hữu dữ liệu product và inventory.
// Service này không quyết định quyền truy cập; controller đã bảo vệ endpoint bằng internal guard.

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '@/database/catalog/entities/product.entity';
import { ProductStatus } from '@/database/catalog/enums/product-status.enum';
import { ProductVariantStatus } from '@/database/catalog/enums/product-variant-status.enum';
import type {
    InternalSellerDashboardProductItem,
    InternalSellerDashboardProductSnapshot,
} from '@/modules/internal/application/types/internal-seller-dashboard-product.type';

// Tách toàn bộ aggregate dashboard khỏi presentation để query có thể kiểm thử và tái sử dụng độc lập.
@Injectable()
export class InternalSellerDashboardProductService {
    constructor(
        @InjectRepository(Product)
        private readonly productRepository: Repository<Product>,
    ) {}

    // Tổng hợp summary và top product trong service để controller chỉ còn làm HTTP binding.
    // Mọi query đều scope theo shopId và giới hạn kết quả nhằm tránh tải toàn bộ catalog vào memory.
    async getSnapshot(
        shopId: string,
    ): Promise<InternalSellerDashboardProductSnapshot> {
        const summaryRow = await this.productRepository
            .createQueryBuilder('product')
            .select(
                'COUNT(DISTINCT product.id) FILTER (WHERE product.status = :activeStatus)',
                'activeProducts',
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
            .where('product.seller_shop_id = :shopId', { shopId })
            .setParameters({
                activeStatus: ProductStatus.ACTIVE,
                activeVariantStatus: ProductVariantStatus.ACTIVE,
            })
            .getRawOne<{
                activeProducts: string;
                outOfStockProducts: string;
            }>();

        const topRows = await this.productRepository
            .createQueryBuilder('product')
            .leftJoin(
                'product.variants',
                'variant',
                'variant.status = :activeVariantStatus',
            )
            .leftJoin('variant.inventory', 'inventory')
            .leftJoin(
                'product.images',
                'thumbnail',
                'thumbnail.is_thumbnail = true',
            )
            .select('product.id', 'productId')
            .addSelect('product.name', 'name')
            .addSelect('MAX(thumbnail.image_url)', 'thumbnailUrl')
            .addSelect('product.total_sold', 'quantitySold')
            .addSelect(
                'COALESCE(SUM(COALESCE(inventory.quantity_available, variant.stock_quantity)), 0)',
                'stock',
            )
            .where('product.seller_shop_id = :shopId', { shopId })
            .andWhere('product.status = :activeStatus', {
                activeStatus: ProductStatus.ACTIVE,
            })
            .setParameter('activeVariantStatus', ProductVariantStatus.ACTIVE)
            .groupBy('product.id')
            .addGroupBy('product.name')
            .addGroupBy('product.total_sold')
            .orderBy('product.total_sold', 'DESC')
            .limit(5)
            .getRawMany<{
                productId: string;
                name: string;
                thumbnailUrl: string | null;
                quantitySold: string;
                stock: string;
            }>();

        const topProducts: InternalSellerDashboardProductItem[] = topRows.map(
            (row) => ({
                productId: row.productId,
                name: row.name,
                thumbnailUrl: row.thumbnailUrl,
                quantitySold: Number(row.quantitySold),
                revenue: null,
                stock: Number(row.stock),
            }),
        );

        return {
            summary: {
                activeProducts: Number(summaryRow?.activeProducts ?? 0),
                outOfStockProducts: Number(summaryRow?.outOfStockProducts ?? 0),
            },
            topProducts,
        };
    }
}
