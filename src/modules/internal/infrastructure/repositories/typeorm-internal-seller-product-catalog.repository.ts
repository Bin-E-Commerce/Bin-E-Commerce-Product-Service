// Repository TypeORM dựng catalog nội bộ từ product/variant/inventory; chỉ trả snapshot thuộc shop được yêu cầu.
// Query lọc mọi sản phẩm INTERNAL chưa xóa theo shop hoặc owner đã xác thực; ảnh lấy từ biến thể/thumbnail catalog.

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Product } from '@/database/catalog/entities/product.entity';
import { ProductOriginType } from '@/database/catalog/enums/product-origin-type.enum';
import { ProductStatus } from '@/database/catalog/enums/product-status.enum';
import { ProductVariantStatus } from '@/database/catalog/enums/product-variant-status.enum';
import type { InternalSellerProductCatalogRepositoryPort } from '@/modules/internal/application/ports/internal-seller-product-catalog.repository.port';
import type {
    InternalSellerProductCatalogItem,
    InternalSellerProductCatalogSnapshot,
} from '@/modules/internal/application/types/internal-seller-product-catalog.type';

// Adapter sở hữu toàn bộ relation load, tenant filter và projection từ entity sang read model.
@Injectable()
export class TypeOrmInternalSellerProductCatalogRepository implements InternalSellerProductCatalogRepositoryPort {
    constructor(
        @InjectRepository(Product)
        private readonly productRepository: Repository<Product>,
    ) {}

    // Nạp payload có giới hạn; OR theo owner chỉ khôi phục record legacy thiếu seller_shop_id, còn origin/status vẫn khóa tập hợp.
    async getSellerCatalog(
        shopId: string,
        ownerUserId: string,
        productLimit: number,
        variantLimit: number,
    ): Promise<InternalSellerProductCatalogSnapshot> {
        // Đếm và phân trang trước khi nạp collection: phân trang trên join ảnh/variant làm TypeORM bỏ sót product.
        const [page, totalCount] = await this.productRepository.findAndCount({
            where: [
                {
                    sellerShopId: shopId,
                    originType: ProductOriginType.INTERNAL,
                    status: Not(ProductStatus.DELETED),
                },
                {
                    sellerShopId: IsNull(),
                    sellerOwnerId: ownerUserId,
                    originType: ProductOriginType.INTERNAL,
                    status: Not(ProductStatus.DELETED),
                },
            ],
            order: { updatedAt: 'DESC', id: 'ASC' },
            take: productLimit,
        });
        const pageIds = page.map((product) => product.id);
        if (!pageIds.length) {
            return { items: [], totalCount, hasMore: totalCount > 0 };
        }

        // Nạp relation chỉ cho ID đã phân trang, áp lại tenant/status/origin để không mở rộng phạm vi đọc.
        const loadedProducts = await this.productRepository.find({
            where: [
                {
                    id: In(pageIds),
                    sellerShopId: shopId,
                    originType: ProductOriginType.INTERNAL,
                    status: Not(ProductStatus.DELETED),
                },
                {
                    id: In(pageIds),
                    sellerShopId: IsNull(),
                    sellerOwnerId: ownerUserId,
                    originType: ProductOriginType.INTERNAL,
                    status: Not(ProductStatus.DELETED),
                },
            ],
            relations: {
                images: true,
                variants: {
                    inventory: true,
                    images: true,
                    optionChoices: {
                        optionValue: {
                            option: true,
                        },
                    },
                },
            },
            order: {
                images: { sortOrder: 'ASC' },
                variants: { name: 'ASC' },
            },
        });
        // Giai đoạn nạp relation không có take; khôi phục thứ tự ổn định từ trang ID để card không đảo vị trí.
        const productById = new Map(
            loadedProducts.map((product) => [product.id, product]),
        );
        const products = pageIds
            .map((id) => productById.get(id))
            .filter((product): product is Product => product !== undefined);

        // Chọn thumbnail ổn định theo cờ chính; ảnh đầu tiên chỉ là fallback khi catalog chưa đánh dấu ảnh đại diện.
        const items: InternalSellerProductCatalogItem[] = products.map(
            (product) => {
                const productThumbnail =
                    product.images.find((image) => image.isThumbnail)
                        ?.imageUrl ??
                    product.images[0]?.imageUrl ??
                    null;
                const activeVariants = product.variants.filter(
                    (variant) => variant.status === ProductVariantStatus.ACTIVE,
                );
                const visibleVariants = activeVariants.slice(0, variantLimit);

                return {
                    productId: product.id,
                    name: product.name,
                    description:
                        product.shortDescription?.trim() ||
                        product.description?.trim().slice(0, 400) ||
                        null,
                    thumbnailUrl: productThumbnail,
                    status: product.status,
                    totalSold: product.totalSold,
                    // Tổng lấy từ mọi variant ACTIVE trước khi cắt payload, để số tổng không bị thấp giả khi danh sách bị giới hạn.
                    availableTotal: activeVariants.reduce(
                        (total, variant) =>
                            total +
                            (variant.inventory?.quantityAvailable ??
                                variant.stockQuantity),
                        0,
                    ),
                    variants: visibleVariants.map((variant) => ({
                        variantId: variant.id,
                        name: variant.name,
                        sku: variant.sku,
                        sellerSku: variant.sellerSku,
                        options: variant.optionChoices
                            .map((choice) => ({
                                name: choice.optionValue.option.name,
                                value: choice.optionValue.value,
                                position: choice.optionValue.option.position,
                            }))
                            .sort(
                                (left, right) => left.position - right.position,
                            )
                            .map(({ name, value }) => ({ name, value })),
                        price: Number(variant.price),
                        originalPrice: variant.originalPrice
                            ? Number(variant.originalPrice)
                            : null,
                        available:
                            variant.inventory?.quantityAvailable ??
                            variant.stockQuantity,
                        reserved: variant.inventory?.quantityReserved ?? 0,
                        quantitySold: variant.inventory?.quantitySold ?? 0,
                        lowStockThreshold:
                            variant.inventory?.lowStockThreshold ?? 5,
                        thumbnailUrl:
                            variant.imageUrl ??
                            variant.images.find((image) => image.isThumbnail)
                                ?.imageUrl ??
                            productThumbnail,
                    })),
                    variantCount: activeVariants.length,
                    hasMoreVariants:
                        activeVariants.length > visibleVariants.length,
                };
            },
        );

        // findAndCount giới hạn product, nhưng variant cap là tổng cho cả payload để chặn dữ liệu quá lớn từ một shop.
        let variantsRemaining = variantLimit;
        for (const item of items) {
            const permittedCount = Math.min(
                item.variants.length,
                variantsRemaining,
            );
            item.variants = item.variants.slice(0, permittedCount);
            item.hasMoreVariants ||= permittedCount < item.variantCount;
            variantsRemaining -= permittedCount;
        }

        return {
            items,
            totalCount,
            hasMore: totalCount > items.length,
        };
    }
}
