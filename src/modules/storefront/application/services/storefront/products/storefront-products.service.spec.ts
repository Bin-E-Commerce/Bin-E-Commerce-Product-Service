// Kiểm tra enrichment storefront không làm mất dữ liệu catalog khi Order Service lỗi.

/// <reference types="jest" />

import type { StorefrontProductRepositoryPort } from '@/modules/storefront/application/ports/products/storefront-product.repository.port';
import type { StorefrontProductDetailRecord } from '@/modules/storefront/application/types/products/storefront-product.type';
import { OrderSalesClient } from '@/modules/seller-products/application/clients/order-sales.client';
import { ReviewerProfileClient } from '@/modules/reviews/application/clients/reviewer-profile.client';
import { StorefrontSearchRankingService } from '@/modules/storefront/application/services/storefront/search/storefront-search-ranking.service';
import { StorefrontProductsService } from '@/modules/storefront/application/services/storefront/products/storefront-products.service';

describe('StorefrontProductsService', () => {
    let target: StorefrontProductsService;
    let mockProducts: jest.Mocked<StorefrontProductRepositoryPort>;
    let mockReviewerProfileClient: ReviewerProfileClient & {
        getPublicProfiles: jest.Mock;
    };
    let mockOrderSalesClient: OrderSalesClient & {
        getSoldQuantities: jest.Mock;
    };
    let mockStorefrontSearchRankingService: StorefrontSearchRankingService;

    // Tạo product tối thiểu nhưng giữ totalSold đã đọc từ Product DB để kiểm tra fallback không ghi đè dữ liệu.
    const createProduct = (
        totalSold: number,
    ): StorefrontProductDetailRecord => ({
        id: 'product-001',
        sellerOwnerId: 'owner-001',
        minPrice: '0',
        totalSold,
        reviewCount: 0,
        ratingAvg: null,
        reviews: [],
        images: [],
        variants: [],
    });

    // Tạo adapter tìm kiếm giả vì các ca này chỉ kiểm tra enrichment sản phẩm, không truy vấn search.
    beforeEach(() => {
        mockProducts = {
            findActiveProduct: jest.fn(),
            findProductsByIds: jest.fn(),
            findActiveDisplayVariants: jest.fn(),
            findApprovedReviewSummaries: jest.fn(),
            findReviewLikeSummaries: jest.fn().mockResolvedValue(new Map()),
            getShopSummary: jest.fn(),
        };
        mockReviewerProfileClient = {
            getPublicProfiles: jest.fn().mockResolvedValue([]),
        } as unknown as ReviewerProfileClient & {
            getPublicProfiles: jest.Mock;
        };
        mockOrderSalesClient = {
            getSoldQuantities: jest.fn(),
        } as unknown as OrderSalesClient & {
            getSoldQuantities: jest.Mock;
        };
        mockStorefrontSearchRankingService =
            {} as unknown as StorefrontSearchRankingService;
        target = new StorefrontProductsService(
            mockProducts,
            mockReviewerProfileClient,
            mockOrderSalesClient,
            mockStorefrontSearchRankingService,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // Khi Order Service lỗi, storefront phải trả counter local cũ để lỗi phụ thuộc không làm số bán nhảy về 0.
    it('should preserve local sold counter when Order Service is unavailable', async () => {
        // Arrange
        const product = createProduct(7);
        mockProducts.findActiveProduct.mockResolvedValue(product);
        mockOrderSalesClient.getSoldQuantities.mockResolvedValue(null);

        // Act
        const result = await target.getStorefrontProductById(
            'product-001',
            'owner-001',
        );

        // Assert
        expect(result.totalSold).toBe(7);
        expect(mockOrderSalesClient.getSoldQuantities).toHaveBeenCalledWith(
            'owner-001',
            ['product-001'],
        );
    });

    // Khi nguồn authoritative trả dữ liệu hợp lệ, số bán local phải được cập nhật theo số lượng đã hoàn thành.
    it('should use completed sales from Order Service when available', async () => {
        // Arrange
        const product = createProduct(7);
        mockProducts.findActiveProduct.mockResolvedValue(product);
        mockOrderSalesClient.getSoldQuantities.mockResolvedValue(
            new Map([['product-001', 12]]),
        );

        // Act
        const result = await target.getStorefrontProductById(
            'product-001',
            'owner-001',
        );

        // Assert
        expect(result.totalSold).toBe(12);
    });

    // Giá hiển thị và giá gốc phải thuộc cùng variant active rẻ nhất để phần trăm giảm không bị sai.
    it('should expose the price pair from the cheapest active variant', async () => {
        // Arrange
        const product = createProduct(7);
        product.minPrice = '150000.00';
        product.variants = [
            {
                id: 'variant-inactive',
                productId: product.id,
                status: 'INACTIVE',
                price: '100000.00',
                originalPrice: '120000.00',
            },
            {
                id: 'variant-expensive',
                productId: product.id,
                status: 'ACTIVE',
                price: '200000.00',
                originalPrice: '250000.00',
            },
            {
                id: 'variant-cheapest',
                productId: product.id,
                status: 'ACTIVE',
                price: '150000.00',
                originalPrice: '180000.00',
            },
        ];
        mockProducts.findActiveProduct.mockResolvedValue(product);
        mockOrderSalesClient.getSoldQuantities.mockResolvedValue(null);

        // Act
        const result = await target.getStorefrontProductById('product-001');

        // Assert
        expect(result.displayPrice).toBe('150000.00');
        expect(result.displayOriginalPrice).toBe('180000.00');
    });

    // Giá gốc không hợp lệ không được truyền sang storefront để card không hiển thị một ưu đãi giả.
    it('should omit an invalid original price', async () => {
        // Arrange
        const product = createProduct(0);
        product.minPrice = '150000.00';
        product.variants = [
            {
                id: 'variant-001',
                productId: product.id,
                status: 'ACTIVE',
                price: '150000.00',
                originalPrice: '150000.00',
            },
        ];
        mockProducts.findActiveProduct.mockResolvedValue(product);
        mockOrderSalesClient.getSoldQuantities.mockResolvedValue(null);

        // Act
        const result = await target.getStorefrontProductById('product-001');

        // Assert
        expect(result.displayPrice).toBe('150000.00');
        expect(result.displayOriginalPrice).toBeNull();
    });

    // Detail chỉ công bố review approved; với review ẩn danh, dữ liệu người dùng không vào response.
    it('should preserve the public review shape after reading through the port', async () => {
        const product = createProduct(0);
        const anonymousReview = {
            id: 'review-1',
            rating: 5,
            title: 'Đánh giá thử',
            content: null,
            images: [],
            videos: [],
            status: 'APPROVED',
            createdAt: new Date(0),
            updatedAt: new Date(0),
            userId: 'reviewer-id',
            isAnonymous: true,
            reviewerName: 'Tên riêng',
            reviewerAvatarUrl: 'avatar.png',
            variant: { name: 'Size M' },
        };
        product.reviews = [
            anonymousReview,
            { ...anonymousReview, id: 'review-2', status: 'pending' },
        ];
        mockProducts.findActiveProduct.mockResolvedValue(product);
        mockProducts.findReviewLikeSummaries.mockResolvedValue(
            new Map([['review-1', { likeCount: 2, likedByCurrentUser: true }]]),
        );
        mockOrderSalesClient.getSoldQuantities.mockResolvedValue(null);

        const result = await target.getStorefrontProductByIdentifier(
            'dep-boston',
            'viewer',
        );

        expect(mockProducts.findReviewLikeSummaries).toHaveBeenCalledWith(
            ['review-1'],
            'viewer',
        );
        expect(
            mockReviewerProfileClient.getPublicProfiles,
        ).toHaveBeenCalledWith([]);
        expect(result.reviews).toEqual([
            {
                id: 'review-1',
                rating: 5,
                title: 'Đánh giá thử',
                content: null,
                images: [],
                videos: [],
                status: 'APPROVED',
                createdAt: new Date(0),
                updatedAt: new Date(0),
                isAnonymous: true,
                reviewerName: null,
                reviewerAvatarUrl: null,
                variantName: 'Size M',
                likeCount: 2,
                likedByCurrentUser: true,
            },
        ]);
        expect(result.reviewCount).toBe(1);
        expect(result.ratingAvg).toBe('5.00');
    });
});
