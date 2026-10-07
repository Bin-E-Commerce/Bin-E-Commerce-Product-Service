// Search và cập nhật tồn kho dành cho Seller Service; Product Service vẫn là chủ sở hữu transaction và inventory rules.
import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { Inventory } from '@/database/inventory/entities/inventory.entity';
import { Product } from '@/database/catalog/entities/product.entity';
import { ProductVariant } from '@/database/catalog/entities/product-variant.entity';
import { ProductOriginType } from '@/database/catalog/enums/product-origin-type.enum';
import { ProductStatus } from '@/database/catalog/enums/product-status.enum';
import { ProductVariantStatus } from '@/database/catalog/enums/product-variant-status.enum';
import { CatalogEventPublisherService } from '@/modules/seller-products/application/services/events/catalog-event-publisher.service';

export interface SellerInventorySearchResult {
    productId: string;
    productName: string;
    variantId: string;
    variantName: string;
    sku: string;
    sellerSku: string | null;
    available: number;
    reserved: number;
}

@Injectable()
// Application service sở hữu truy vấn và transaction tồn kho; mọi read/write đều buộc theo owner, shop và variant.
export class InternalSellerInventoryService {
    constructor(
        @InjectRepository(Product)
        private readonly productRepository: Repository<Product>,
        @InjectRepository(ProductVariant)
        private readonly variantRepository: Repository<ProductVariant>,
        @InjectRepository(Inventory)
        private readonly inventoryRepository: Repository<Inventory>,
        private readonly dataSource: DataSource,
        private readonly catalogEvents: CatalogEventPublisherService,
    ) {}

    // Tìm tối đa mười biến thể theo tên/SKU trong shop đã được resolve; không trả biến thể inactive hoặc shop khác.
    async search(shopId: string, query: string): Promise<SellerInventorySearchResult[]> {
        const normalizedQuery = query.trim();
        if (normalizedQuery.length < 2) return [];
        const excludedWords = new Set([
            'tồn', 'kho', 'khả', 'dụng', 'còn', 'bao', 'nhiêu', 'số', 'lượng',
            'sản', 'phẩm', 'shop', 'của', 'mình', 'tôi', 'bạn', 'cho',
            'xem', 'kiểm', 'tra', 'danh', 'sách', 'hiện', 'tại', 'đang', 'có',
            'nào', 'nhất', 'bán', 'chạy', 'hàng', 'giúp', 'nhé', 'nha', 'đi',
        ]);
        const searchTerms = (normalizedQuery.match(/[\p{L}\p{N}-]+/gu) ?? [])
            .filter((term) => term.length > 1)
            .filter((term) => !excludedWords.has(term.toLocaleLowerCase('vi')))
            .slice(0, 8);
        if (searchTerms.length === 0) return [];

        const products = await this.productRepository
            .createQueryBuilder('product')
            .innerJoin('product.variants', 'variant')
            .innerJoin('variant.inventory', 'inventory')
            .select('product.id', 'productId')
            .addSelect('product.name', 'productName')
            .addSelect('variant.id', 'variantId')
            .addSelect('variant.name', 'variantName')
            .addSelect('variant.sku', 'sku')
            .addSelect('variant.sellerSku', 'sellerSku')
            .addSelect('COALESCE(inventory.quantityAvailable, 0)', 'available')
            .addSelect('COALESCE(inventory.quantityReserved, 0)', 'reserved')
            .where('product.sellerShopId = :shopId', { shopId })
            .andWhere('product.originType = :originType', {
                originType: ProductOriginType.INTERNAL,
            })
            .andWhere('product.status != :deleted', {
                deleted: ProductStatus.DELETED,
            })
            .andWhere('variant.status = :variantStatus', {
                variantStatus: ProductVariantStatus.ACTIVE,
            })
            .andWhere(
                new Brackets((termsQuery) => {
                    // Mọi token còn lại phải khớp ít nhất tên sản phẩm, biến thể hoặc SKU để giảm kết quả nhiễu từ câu hỏi dài.
                    for (const [index, term] of searchTerms.entries()) {
                        const parameter = `searchTerm${index}`;
                        termsQuery.andWhere(
                            `(product.name ILIKE :${parameter} OR variant.name ILIKE :${parameter} OR variant.sku ILIKE :${parameter} OR variant.sellerSku ILIKE :${parameter})`,
                            { [parameter]: `%${escapeLike(term)}%` },
                        );
                    }
                }),
            )
            .orderBy('product.name', 'ASC')
            .addOrderBy('variant.name', 'ASC')
            .limit(10)
            .getRawMany<Record<string, string>>();

        return products.flatMap((row) => {
            // Bỏ raw row thiếu khóa nhận dạng thay vì tạo kết quả lỗi khiến tác nhân có thể nhắm nhầm variant.
            if (
                !row.productId ||
                !row.productName ||
                !row.variantId ||
                !row.variantName ||
                !row.sku
            ) {
                return [];
            }
            return [{
                productId: row.productId,
                productName: row.productName,
                variantId: row.variantId,
                variantName: row.variantName,
                sku: row.sku,
                sellerSku: row.sellerSku || null,
                available: Number(row.available),
                reserved: Number(row.reserved),
            }];
        });
    }

    // Đặt số tồn khả dụng theo preview có điều kiện optimistic; khóa inventory trước khi ghi để giao dịch checkout không bị ghi đè.
    async setAvailable(input: {
        shopId: string;
        ownerUserId: string;
        variantId: string;
        expectedAvailable: number;
        nextAvailable: number;
    }): Promise<{ variantId: string; available: number; reserved: number }> {
        if (
            !Number.isInteger(input.nextAvailable) ||
            input.nextAvailable < 0 ||
            input.nextAvailable > 2_147_483_647
        ) {
            throw new BadRequestException('Tồn khả dụng phải là số nguyên không âm.');
        }

        return this.dataSource.transaction(async (manager) => {
            const variant = await manager.getRepository(ProductVariant).findOne({
                where: {
                    id: input.variantId,
                    product: {
                        sellerShopId: input.shopId,
                        sellerOwnerId: input.ownerUserId,
                        originType: ProductOriginType.INTERNAL,
                    },
                    status: ProductVariantStatus.ACTIVE,
                },
                relations: { product: true },
            });
            if (!variant || variant.product.status === ProductStatus.DELETED) {
                throw new NotFoundException('Không tìm thấy biến thể trong shop của bạn.');
            }

            const inventory = await manager.getRepository(Inventory).findOne({
                where: { variantId: input.variantId },
                lock: { mode: 'pessimistic_write' },
            });
            if (!inventory) {
                throw new NotFoundException('Biến thể chưa có bản ghi tồn kho.');
            }
            if (inventory.quantityAvailable !== input.expectedAvailable) {
                throw new ConflictException(
                    'Tồn kho vừa thay đổi. Hãy tải lại số lượng mới trước khi xác nhận.',
                );
            }
            if (
                input.nextAvailable + inventory.quantityReserved >
                2_147_483_647
            ) {
                throw new BadRequestException(
                    'Tổng tồn kho vượt giới hạn hệ thống hỗ trợ.',
                );
            }

            // stockQuantity là tổng vật lý; phần đang được giữ cho đơn phải được cộng lại, không bị thao tác seller xóa.
            inventory.quantityAvailable = input.nextAvailable;
            variant.stockQuantity = input.nextAvailable + inventory.quantityReserved;
            await manager.getRepository(Inventory).save(inventory);
            await manager.getRepository(ProductVariant).save(variant);
            await this.catalogEvents.publishForVariants([variant.id], manager);

            return {
                variantId: variant.id,
                available: inventory.quantityAvailable,
                reserved: inventory.quantityReserved,
            };
        });
    }
}

// Escape wildcard SQL để tên có % hoặc _ được tìm như ký tự thật, không mở rộng ngẫu nhiên phạm vi tìm kiếm.
function escapeLike(value: string): string {
    return value.replace(/[\\%_]/gu, '\\$&');
}
