// Repository này chỉ đọc snapshot ảnh theo Product ID/cursor; controller và application không tự dựng truy vấn TypeORM.

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '@/database/catalog/entities/product.entity';
import { ProductStatus } from '@/database/catalog/enums/product-status.enum';
import {
    IMAGE_SEARCH_MAX_PRODUCT_IMAGES,
    type RecommendationPrimaryImageMedia,
} from '@common/kafka/events/recommendation.events';
import type { InternalProductImageSnapshotRepositoryPort } from '@/modules/internal/application/ports/internal-product-image-snapshot.repository.port';
import type { InternalProductImageSnapshot } from '@/modules/internal/application/types/internal-product-image-snapshot.type';

@Injectable()
export class InternalProductImageSnapshotRepository
    implements InternalProductImageSnapshotRepositoryPort
{
    // Repository được inject qua port để truy vấn catalog chỉ tồn tại trong infrastructure boundary.
    constructor(
        @InjectRepository(Product)
        private readonly products: Repository<Product>,
    ) {}

    // Cursor chỉ sắp theo product ID; toSnapshot sắp ảnh trong RAM để JOIN pagination không tạo alias sort mơ hồ.
    async findPage(
        afterProductId: string | undefined,
        limit: number,
    ): Promise<InternalProductImageSnapshot[]> {
        const query = this.products
            .createQueryBuilder('product')
            .select([
                'product.id',
                'product.status',
                'product.catalogRevision',
                'product.sellerOwnerId',
                'image.id',
                'image.sortOrder',
                'image.aiAssetId',
                'image.sourceAssetId',
            ])
            .leftJoinAndSelect('product.images', 'image')
            .where('product.status IN (:...statuses)', {
                statuses: [
                    ProductStatus.ACTIVE,
                    ProductStatus.INACTIVE,
                    ProductStatus.DELETED,
                ],
            });
        if (afterProductId) {
            query.andWhere('product.id > :afterProductId', {
                afterProductId,
            });
        }
        const products = await query
            .orderBy('product.id', 'ASC')
            .take(limit + 1)
            .getMany();
        return products.map((product) => this.toSnapshot(product));
    }

    // Đọc trạng thái authoritative của event; toSnapshot chọn ảnh trong RAM nên không cần ORDER BY cột JOIN.
    async findOne(
        productId: string,
    ): Promise<InternalProductImageSnapshot | null> {
        const product = await this.products
            .createQueryBuilder('product')
            .select([
                'product.id',
                'product.status',
                'product.catalogRevision',
                'product.sellerOwnerId',
                'image.id',
                'image.sortOrder',
                'image.aiAssetId',
                'image.sourceAssetId',
            ])
            .leftJoinAndSelect('product.images', 'image')
            .where('product.id = :productId', { productId })
            .andWhere('product.status IN (:...statuses)', {
                statuses: [
                    ProductStatus.ACTIVE,
                    ProductStatus.INACTIVE,
                    ProductStatus.DELETED,
                ],
            })
            .getOne();
        return product ? this.toSnapshot(product) : null;
    }

    // Trả tối đa năm asset duy nhất theo thứ tự gallery; URL không tham gia fingerprint hoặc được gửi sang Recommendation.
    private toSnapshot(product: Product): InternalProductImageSnapshot {
        const orderedImages = [...(product.images ?? [])].sort(
            (left, right) =>
                left.sortOrder - right.sortOrder ||
                left.id.localeCompare(right.id),
        );
        const seenAssetIds = new Set<string>();
        const images: RecommendationPrimaryImageMedia[] = [];
        for (const image of orderedImages) {
            // Bỏ asset trống/trùng trước khi giới hạn để ảnh gallery bị lặp không chiếm chỗ của ảnh khác.
            const assetId =
                image.aiAssetId?.trim() || image.sourceAssetId?.trim();
            if (
                !product.sellerOwnerId ||
                !assetId ||
                seenAssetIds.has(assetId)
            ) {
                continue;
            }
            seenAssetIds.add(assetId);
            images.push({
                ownerId: product.sellerOwnerId,
                assetId,
                purpose: 'product_image',
            });
            if (images.length >= IMAGE_SEARCH_MAX_PRODUCT_IMAGES) break;
        }
        return {
            productId: product.id,
            status:
                product.status === ProductStatus.ACTIVE
                    ? 'ACTIVE'
                    : product.status === ProductStatus.DELETED
                      ? 'DELETED'
                      : 'INACTIVE',
            catalogRevision: product.catalogRevision,
            images,
            primaryImageMedia: images[0] ?? null,
        };
    }
}
