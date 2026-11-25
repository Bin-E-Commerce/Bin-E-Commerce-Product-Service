// Áp dụng hoặc khôi phục gallery ảnh AI trong Product Service, cùng sự kiện cập nhật catalog.
// Media Service sở hữu vòng đời asset. Product chỉ cập nhật tham chiếu và lưu snapshot để khôi phục.

import {
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Product } from '@/database/catalog/entities/product.entity';
import { ProductImage } from '@/database/catalog/entities/product-image.entity';
import { ProductStatus } from '@/database/catalog/enums/product-status.enum';
import { CatalogEventPublisherService } from '@/modules/seller-products/application/services/events/catalog-event-publisher.service';
import type { SellerProductUserContext } from '@/modules/seller-products/application/types/seller-product-user-context.type';
import type { AiMediaMutationResponse } from '@/modules/seller-products/application/types/ai-media-response.type';
import type { ApplyAiMediaDto } from '@/modules/seller-products/presentation/dto/ai-media/apply-ai-media.dto';

type OriginalImageSnapshot = {
    imageUrl: string;
    altText: string | null;
    sortOrder: number;
    isThumbnail: boolean;
    variantId?: string | null;
    sourceAssetId?: string | null;
    aiAssetId?: string | null;
};

// Cập nhật gallery, snapshot khôi phục và outbox trong cùng giao dịch Product.
@Injectable()
export class SellerProductAiMediaService {
    // Dùng publisher hiện có để cùng cơ chế revision và gửi lại như luồng sửa ảnh thường.
    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(Product)
        private readonly productRepository: Repository<Product>,
        private readonly catalogEvents: CatalogEventPublisherService,
    ) {}

    // Khóa sản phẩm và so phiên bản seller đã xem trước khi đổi các ảnh nguồn được chọn.
    // Giữ snapshot gallery cũ để có thể khôi phục tham chiếu ảnh gốc khi cần.
    // Chỉ ghi outbox sau khi đã lưu gallery và metadata, để worker đọc cùng phiên bản sau commit.
    async apply(
        currentUser: SellerProductUserContext,
        productId: string,
        dto: ApplyAiMediaDto,
    ): Promise<AiMediaMutationResponse> {
        if (dto.images.length === 0)
            throw new ConflictException('Can it nhat mot anh AI de ap dung.');
        return this.dataSource.transaction(async (manager) => {
            const product = await this.loadOwnedProduct(
                manager,
                currentUser.userId,
                productId,
            );
            if (
                product.updatedAt.toISOString() !==
                new Date(dto.expectedProductUpdatedAt).toISOString()
            ) {
                throw new ConflictException(
                    'San pham da thay doi trong luc AI xu ly.',
                );
            }
            const previousImages = await manager.find(ProductImage, {
                where: { productId },
            });
            const snapshot: OriginalImageSnapshot[] = previousImages.map(
                (image) => ({
                    imageUrl: image.imageUrl,
                    altText: image.altText,
                    sortOrder: image.sortOrder,
                    isThumbnail: image.isThumbnail,
                    variantId: image.variantId,
                    sourceAssetId: image.sourceAssetId,
                    aiAssetId: image.aiAssetId,
                }),
            );

            // Moi output phai tro ve dung mot asset goc; neu khong co mapping thi dung truoc mutation
            // de khong bao gio xoa/thay the nham gallery khi payload cu hoac payload tu client bi sai.
            const outputBySourceAssetId = new Map(
                dto.images.map((image) => [
                    image.sourceAssetId.toLowerCase(),
                    image,
                ]),
            );
            if (outputBySourceAssetId.size !== dto.images.length) {
                throw new ConflictException(
                    'Moi anh AI phai co source asset duy nhat.',
                );
            }
            const sourceImagesByAssetId = new Map(
                previousImages.flatMap((image) =>
                    [image.sourceAssetId, image.aiAssetId]
                        .filter((assetId): assetId is string =>
                            Boolean(assetId),
                        )
                        .map(
                            (assetId) =>
                                [assetId.toLowerCase(), image] as const,
                        ),
                ),
            );
            if (
                [...outputBySourceAssetId.keys()].some(
                    (sourceAssetId) =>
                        !sourceImagesByAssetId.has(sourceAssetId),
                )
            ) {
                throw new ConflictException(
                    'Khong tim thay anh goc cua output AI trong san pham.',
                );
            }

            // Chi cap nhat anh co asset goc khop payload; cac anh khac giu nguyen de khong mat gallery.
            for (const image of previousImages) {
                const imageAssetIds = [
                    image.aiAssetId,
                    image.sourceAssetId,
                ].filter((assetId): assetId is string => Boolean(assetId));
                const output = imageAssetIds
                    .map((assetId) =>
                        outputBySourceAssetId.get(assetId.toLowerCase()),
                    )
                    .find(
                        (
                            candidate,
                        ): candidate is NonNullable<typeof candidate> =>
                            candidate !== undefined,
                    );
                if (!output) continue;
                image.imageUrl = output.imageUrl.trim();
                // Giữ asset gốc qua các lần tối ưu; URL mới chỉ thay asset đang được hiển thị.
                image.sourceAssetId =
                    image.sourceAssetId ?? output.sourceAssetId;
                image.aiAssetId = output.assetId;
            }
            await manager.save(ProductImage, previousImages);
            product.metadata = {
                ...(product.metadata ?? {}),
                aiOptimizationOriginalImages: snapshot,
            };
            product.aiOptimizationJobId = dto.jobId;
            product.aiOptimizationStatus = 'APPLIED';
            product.aiOptimizedAt = new Date();
            const saved = await manager.save(Product, product);
            // Tăng revision và ghi event trong transaction đang giữ khóa sản phẩm.
            await this.catalogEvents.publish(
                productId,
                CatalogEventPublisherService.topics.upserted,
                manager,
            );
            return {
                productId,
                jobId: dto.jobId,
                status: 'APPLIED',
                updatedAt: saved.updatedAt,
            };
        });
    }

    // Xác minh job đang áp dụng rồi khôi phục đúng snapshot gallery trước lần tối ưu đó.
    // Xóa snapshot tạm và ghi outbox cùng transaction để index chuyển về ảnh gốc sau commit.
    async rollback(
        currentUser: SellerProductUserContext,
        productId: string,
        jobId: string,
    ): Promise<AiMediaMutationResponse> {
        return this.dataSource.transaction(async (manager) => {
            const product = await this.loadOwnedProduct(
                manager,
                currentUser.userId,
                productId,
            );
            if (
                product.aiOptimizationJobId !== jobId ||
                product.aiOptimizationStatus !== 'APPLIED'
            ) {
                throw new ConflictException(
                    'San pham khong co output AI de khoi phuc.',
                );
            }
            const snapshot = this.readSnapshot(
                product.metadata?.aiOptimizationOriginalImages,
            );
            if (snapshot.length === 0)
                throw new ConflictException('Khong tim thay snapshot anh goc.');
            await manager.delete(ProductImage, { productId });
            await manager.save(
                ProductImage,
                snapshot.map((image) =>
                    manager.create(ProductImage, {
                        productId,
                        variantId: image.variantId ?? null,
                        imageUrl: image.imageUrl,
                        altText: image.altText,
                        sortOrder: image.sortOrder,
                        isThumbnail: image.isThumbnail,
                        sourceAssetId: image.sourceAssetId ?? null,
                        aiAssetId: image.aiAssetId ?? null,
                    }),
                ),
            );
            const metadata = { ...(product.metadata ?? {}) };
            delete metadata.aiOptimizationOriginalImages;
            product.metadata = metadata;
            product.aiOptimizationStatus = 'ROLLED_BACK';
            const saved = await manager.save(Product, product);
            // Gallery khôi phục cần revision mới ngay cả khi từng được index trước đây.
            await this.catalogEvents.publish(
                productId,
                CatalogEventPublisherService.topics.upserted,
                manager,
            );
            return {
                productId,
                jobId,
                status: 'ROLLED_BACK',
                updatedAt: saved.updatedAt,
            };
        });
    }

    // Khóa sản phẩm khi cập nhật AI; chỉ chủ sở hữu đã xác thực mới được thao tác và sản phẩm đã xóa bị từ chối.
    private async loadOwnedProduct(
        manager: EntityManager,
        ownerId: string,
        productId: string,
    ): Promise<Product> {
        const product = await manager.findOne(Product, {
            where: {
                id: productId,
                sellerOwnerId: ownerId,
            },
            lock: { mode: 'pessimistic_write' },
        });
        if (!product || product.status === ProductStatus.DELETED)
            throw new NotFoundException('Khong tim thay san pham trong shop.');
        return product;
    }

    //  Parse snapshot JSONB theo whitelist field de metadata hong khong lam hong rollback.
    private readSnapshot(value: unknown): OriginalImageSnapshot[] {
        if (!Array.isArray(value)) return [];
        return value
            .filter((item): item is OriginalImageSnapshot => {
                if (!item || typeof item !== 'object') return false;
                const candidate = item as Record<string, unknown>;
                return (
                    typeof candidate.imageUrl === 'string' &&
                    typeof candidate.sortOrder === 'number' &&
                    typeof candidate.isThumbnail === 'boolean'
                );
            })
            .map((item) => {
                return item as OriginalImageSnapshot;
            });
    }
}
