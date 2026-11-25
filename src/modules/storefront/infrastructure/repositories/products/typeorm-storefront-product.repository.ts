// Adapter TypeORM tải read model storefront và tập trung điều kiện catalog tại tầng hạ tầng.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { In, Repository } from 'typeorm';
import { Product } from '@/database/catalog/entities/product.entity';
import { ProductVariant } from '@/database/catalog/entities/product-variant.entity';
import { ProductStatus } from '@/database/catalog/enums/product-status.enum';
import { ProductVariantStatus } from '@/database/catalog/enums/product-variant-status.enum';
import { ProductReview } from '@/database/reviews/entities/product-review.entity';
import { ProductReviewLike } from '@/database/reviews/entities/product-review-like.entity';
import type { StorefrontProductRepositoryPort } from '@/modules/storefront/application/ports/products/storefront-product.repository.port';
import type {
    ShopCatalogSummary,
    StorefrontDisplayVariant,
    StorefrontProductDetailRecord,
    StorefrontProductRecord,
    StorefrontReviewLikeSummary,
    StorefrontReviewSummary,
} from '@/modules/storefront/application/types/products/storefront-product.type';

@Injectable()
export class TypeOrmStorefrontProductRepository
    implements StorefrontProductRepositoryPort
{
    // Nhận các repository qua DI để dùng chung kết nối Product cho mọi truy vấn storefront.
    constructor(
        @InjectRepository(Product)
        private readonly products: Repository<Product>,
        @InjectRepository(ProductVariant)
        private readonly variants: Repository<ProductVariant>,
        @InjectRepository(ProductReview)
        private readonly reviews: Repository<ProductReview>,
        @InjectRepository(ProductReviewLike)
        private readonly reviewLikes: Repository<ProductReviewLike>,
    ) {}

    // Hydrate card theo tập ID đã xếp hạng và kiểm tra lại ACTIVE ở lần đọc cuối cho luồng công khai.
    findProductsByIds(
        productIds: string[],
        activeOnly: boolean,
    ): Promise<StorefrontProductRecord[]> {
        return this.products.find({
            where: {
                id: In(productIds),
                ...(activeOnly ? { status: ProductStatus.ACTIVE } : {}),
            },
            relations: { brand: true, images: true },
        });
    }

    // UUID có thể là ID hoặc slug hợp lệ; slug thường chỉ đi vào cột text.
    // Tải từng quan hệ 1-n bằng query riêng để giữ cấu trúc response và tránh tích Descartes.
    findActiveProduct(
        identifier: string,
    ): Promise<StorefrontProductDetailRecord | null> {
        const where = isUUID(identifier)
            ? [
                  { id: identifier, status: ProductStatus.ACTIVE },
                  { slug: identifier, status: ProductStatus.ACTIVE },
              ]
            : { slug: identifier, status: ProductStatus.ACTIVE };
        return this.products.findOne({
            where,
            relationLoadStrategy: 'query',
            relations: {
                brand: true,
                images: true,
                variants: {
                    inventory: true,
                    optionChoices: { optionValue: { option: true } },
                },
                options: { values: true },
                attributeValues: true,
                reviews: { variant: true },
            },
        });
    }

    // Đọc một lần các SKU đang bán cho cả trang và chỉ lấy cặp giá mà card sử dụng.
    findActiveDisplayVariants(
        productIds: string[],
    ): Promise<StorefrontDisplayVariant[]> {
        return this.variants.find({
            where: {
                productId: In(productIds),
                status: ProductVariantStatus.ACTIVE,
            },
            select: {
                id: true,
                productId: true,
                price: true,
                originalPrice: true,
                status: true,
            },
            order: { price: 'ASC', id: 'ASC' },
        });
    }

    // Gom các review được duyệt theo product; use case dùng giá trị mặc định khi sản phẩm chưa có review.
    async findApprovedReviewSummaries(
        productIds: string[],
    ): Promise<Map<string, StorefrontReviewSummary>> {
        const rows = await this.reviews
            .createQueryBuilder('review')
            .select('review.productId', 'productId')
            .addSelect('COUNT(review.id)', 'reviewCount')
            .addSelect('AVG(review.rating)', 'ratingAvg')
            .where('review.productId IN (:...productIds)', { productIds })
            .andWhere('LOWER(review.status) = :status', { status: 'approved' })
            .groupBy('review.productId')
            .getRawMany<{
                productId: string;
                reviewCount: string;
                ratingAvg: string | null;
            }>();
        return new Map(
            rows.map((row) => [
                row.productId,
                {
                    reviewCount: Number(row.reviewCount),
                    ratingAvg:
                        row.ratingAvg === null
                            ? null
                            : Number(row.ratingAvg).toFixed(2),
                },
            ]),
        );
    }

    // Gộp số lượt thích và cờ của người đang xem trước khi trả dữ liệu qua port.
    // Danh sách người dùng đã thích chỉ tồn tại trong repository.
    async findReviewLikeSummaries(
        reviewIds: string[],
        userId?: string,
    ): Promise<Map<string, StorefrontReviewLikeSummary>> {
        if (!reviewIds.length) return new Map();
        const likes = await this.reviewLikes.find({
            where: { reviewId: In(reviewIds) },
        });
        const summaries = new Map<string, StorefrontReviewLikeSummary>();
        for (const like of likes) {
            const summary = summaries.get(like.reviewId) ?? {
                likeCount: 0,
                likedByCurrentUser: false,
            };
            summary.likeCount += 1;
            summary.likedByCurrentUser ||= Boolean(
                userId && like.userId === userId,
            );
            summaries.set(like.reviewId, summary);
        }
        return summaries;
    }

    // Tổng hợp chỉ sản phẩm ACTIVE và review approved cho phần header shop.
    async getShopSummary(shopId: string): Promise<ShopCatalogSummary> {
        const productQuery = this.products
            .createQueryBuilder('product')
            .where('product.sellerShopId = :shopId', { shopId })
            .andWhere('product.status = :activeStatus', {
                activeStatus: ProductStatus.ACTIVE,
            });

        const [productCount, categoryRows, reviewSummary] = await Promise.all([
            productQuery.clone().getCount(),
            productQuery
                .clone()
                .select('product.categoryId', 'categoryId')
                .distinct(true)
                .getRawMany<{ categoryId: string }>(),
            this.reviews
                .createQueryBuilder('review')
                .innerJoin(Product, 'product', 'product.id = review.product_id')
                .select('COUNT(review.id)', 'reviewCount')
                .addSelect('AVG(review.rating)', 'ratingAvg')
                .where('product.seller_shop_id = :shopId', { shopId })
                .andWhere('product.status = :activeStatus', {
                    activeStatus: ProductStatus.ACTIVE,
                })
                .andWhere('LOWER(review.status) = :approvedStatus', {
                    approvedStatus: 'approved',
                })
                .getRawOne<{ reviewCount: string; ratingAvg: string | null }>(),
        ]);

        return {
            shopId,
            productCount,
            ratingAvg: reviewSummary?.ratingAvg
                ? Number(reviewSummary.ratingAvg).toFixed(2)
                : null,
            reviewCount: Number(reviewSummary?.reviewCount ?? 0),
            categoryIds: categoryRows.map((row) => row.categoryId),
        };
    }
}
