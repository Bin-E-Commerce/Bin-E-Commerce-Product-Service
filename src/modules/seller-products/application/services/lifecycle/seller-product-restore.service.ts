// Service này phục hồi product đã soft-delete sau khi kiểm tra quyền seller và trạng thái hợp lệ.
import {
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Product } from '@/database/catalog/entities/product.entity';
import { ProductOriginType } from '@/database/catalog/enums/product-origin-type.enum';
import { ProductStatus } from '@/database/catalog/enums/product-status.enum';
import type { RestoreProductResponse } from '@/modules/seller-products/application/types/restore-product-response.type';
import type { SellerProductUserContext } from '@/modules/seller-products/application/types/seller-product-user-context.type';
import { CatalogEventPublisherService } from '@/modules/seller-products/application/services/events/catalog-event-publisher.service';
import { Optional } from '@nestjs/common';

@Injectable()
export class SellerProductRestoreService {
    constructor(
        private readonly dataSource: DataSource,
        @Optional()
        private readonly catalogEvents?: CatalogEventPublisherService,
    ) {}

    // Khôi phục product thuộc đúng seller về INACTIVE để không tự xuất hiện lại trên storefront.
    async restore(
        currentUser: SellerProductUserContext,
        productId: string,
    ): Promise<RestoreProductResponse> {
        const response = await this.dataSource.transaction(async (manager) => {
            const product = await this.loadDeletedProduct(
                manager,
                productId,
                currentUser.userId,
            );

            product.status = ProductStatus.INACTIVE;
            product.deletedAt = null;
            product.deletedBy = null;
            await manager.save(Product, product);
            await this.catalogEvents?.publish(
                product.id,
                CatalogEventPublisherService.topics.statusChanged,
                manager,
            );

            return {
                id: product.id,
                status: ProductStatus.INACTIVE as const,
                updatedAt: product.updatedAt,
            };
        });
        return response;
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
            lock: { mode: 'pessimistic_write' },
        });

        if (!product) {
            throw new NotFoundException(
                'Không tìm thấy sản phẩm trong shop của bạn.',
            );
        }

        if (product.status !== ProductStatus.DELETED) {
            throw new ConflictException(
                'Sản phẩm này chưa ở trạng thái đã xóa.',
            );
        }

        return product;
    }
}
