// Kiểm tra adapter giữ bộ lọc ACTIVE và shape review công khai khi tải qua TypeORM.
import type { Repository } from 'typeorm';
import type { Product } from '@/database/catalog/entities/product.entity';
import type { ProductVariant } from '@/database/catalog/entities/product-variant.entity';
import type { ProductReview } from '@/database/reviews/entities/product-review.entity';
import type { ProductReviewLike } from '@/database/reviews/entities/product-review-like.entity';
import { TypeOrmStorefrontProductRepository } from '@/modules/storefront/infrastructure/repositories/products/typeorm-storefront-product.repository';

describe('TypeOrmStorefrontProductRepository', () => {
    const mockFindProduct = jest.fn();
    const mockFindLikes = jest.fn();
    let target: TypeOrmStorefrontProductRepository;

    // Tạo adapter với mock TypeORM, không dùng catalog hoặc PostgreSQL thật.
    beforeEach(() => {
        mockFindProduct.mockReset().mockResolvedValue(null);
        mockFindLikes.mockReset().mockResolvedValue([]);
        target = new TypeOrmStorefrontProductRepository(
            { findOne: mockFindProduct } as unknown as Repository<Product>,
            {} as Repository<ProductVariant>,
            {} as Repository<ProductReview>,
            { find: mockFindLikes } as unknown as Repository<ProductReviewLike>,
        );
    });

    // URL dạng UUID vẫn có thể là slug; cả hai nhánh đều chỉ trả sản phẩm ACTIVE.
    it('should look up UUID or slug without expanding joined relations', async () => {
        const identifier = '10000000-0000-4000-8000-000000000001';
        await target.findActiveProduct(identifier);

        expect(mockFindProduct).toHaveBeenCalledWith(
            expect.objectContaining({
                where: [
                    { id: identifier, status: 'ACTIVE' },
                    { slug: identifier, status: 'ACTIVE' },
                ],
                relationLoadStrategy: 'query',
                relations: expect.objectContaining({
                    images: true,
                    reviews: { variant: true },
                }),
            }),
        );
    });

    // Slug chữ không đi vào cột UUID để PostgreSQL không báo lỗi cast.
    it('should use only the slug column for text identifiers', async () => {
        await target.findActiveProduct('dep-boston');

        expect(mockFindProduct).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { slug: 'dep-boston', status: 'ACTIVE' },
            }),
        );
    });

    // Chỉ trả tổng lượt thích và trạng thái của người xem, giữ danh sách user trong adapter.
    it('should return review like summaries without exposing other users', async () => {
        mockFindLikes.mockResolvedValue([
            { reviewId: 'review-1', userId: 'viewer' },
            { reviewId: 'review-1', userId: 'other-user' },
            { reviewId: 'review-2', userId: 'other-user' },
        ]);

        expect(
            await target.findReviewLikeSummaries(
                ['review-1', 'review-2'],
                'viewer',
            ),
        ).toEqual(
            new Map([
                ['review-1', { likeCount: 2, likedByCurrentUser: true }],
                ['review-2', { likeCount: 1, likedByCurrentUser: false }],
            ]),
        );
    });
});
