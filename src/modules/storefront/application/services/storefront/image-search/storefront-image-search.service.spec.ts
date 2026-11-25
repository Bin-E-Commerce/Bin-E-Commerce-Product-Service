// Unit tests cho ngưỡng tương đồng, lọc catalog, fallback và session; không gọi database, AI hoặc Recommendation thật.
import {
    BadRequestException,
    GoneException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { StorefrontSort } from '@/database/catalog/enums/storefront-sort.enum';
import type { StorefrontSearchRepositoryPort } from '@/modules/storefront/application/ports/storefront-search.repository.port';
import type { StorefrontImageEmbeddingPort } from '@/modules/storefront/application/ports/image-search/image-search-embedding.port';
import type { StorefrontImageRecommendationPort } from '@/modules/storefront/application/ports/image-search/image-search-recommendation.port';
import type { StorefrontProductsService } from '@/modules/storefront/application/services/storefront/products/storefront-products.service';
import { StorefrontImageSearchService } from '@/modules/storefront/application/services/storefront/image-search/storefront-image-search.service';
import type { StorefrontImageSearchCandidate } from '@/modules/storefront/application/types/image-search/image-search.type';

describe('StorefrontImageSearchService', () => {
    const embedding = {
        modelVersion: 'pe-core-test-v1',
        dimensions: 512,
        preprocessVersion: 'pe-core-image-transform-v1',
        vector: new Array(512).fill(0),
    };
    const imageCandidates: StorefrontImageSearchCandidate[] = [
        {
            productId: 'image-first',
            catalogRevision: '3',
            imageFingerprint: 'a'.repeat(64),
            rank: 1,
        },
        {
            productId: 'both-sources',
            catalogRevision: '4',
            imageFingerprint: 'b'.repeat(64),
            rank: 2,
        },
    ];
    let imageEmbedding: jest.Mocked<StorefrontImageEmbeddingPort>;
    let recommendation: jest.Mocked<StorefrontImageRecommendationPort>;
    let repository: jest.Mocked<
        Pick<StorefrontSearchRepositoryPort, 'findImageSearchProductIds'>
    >;
    let products: jest.Mocked<
        Pick<
            StorefrontProductsService,
            'getStorefrontProductsByIds' | 'listStorefrontProducts'
        >
    >;
    let target: StorefrontImageSearchService;

    // Mỗi test nhận dependency spies mới để không chia sẻ session hoặc query state.
    beforeEach(() => {
        imageEmbedding = {
            embedImage: jest.fn().mockResolvedValue(embedding),
        };
        recommendation = {
            findCandidates: jest.fn().mockResolvedValue(imageCandidates),
            createSession: jest.fn().mockResolvedValue('search-session'),
            getSession: jest.fn().mockResolvedValue(imageCandidates),
        };
        repository = {
            findImageSearchProductIds: jest
                .fn()
                .mockImplementation(
                    async (
                        _filters: Parameters<
                            StorefrontSearchRepositoryPort['findImageSearchProductIds']
                        >[0],
                        candidates: StorefrontImageSearchCandidate[],
                    ) => candidates.map((candidate) => candidate.productId),
                ),
        };
        products = {
            getStorefrontProductsByIds: jest.fn().mockResolvedValue([]),
            listStorefrontProducts: jest.fn().mockResolvedValue({
                items: [],
                total: 0,
                page: 1,
                pageSize: 20,
                totalPages: 0,
            }),
        };
        target = new StorefrontImageSearchService(
            imageEmbedding,
            recommendation,
            repository as unknown as StorefrontSearchRepositoryPort,
            products as unknown as StorefrontProductsService,
        );
    });

    // Mô tả chữ thu hẹp tập ảnh; nếu tập giao rỗng thì giữ trạng thái không có kết quả.
    it('should return an empty combined result when no image candidate matches the text', async () => {
        // Arrange
        repository.findImageSearchProductIds.mockResolvedValue([]);

        // Act
        const result = await target.createSearch(
            Buffer.from('image bytes'),
            'image/png',
            {
                search: 'túi xách',
                page: 1,
                pageSize: 2,
                sort: StorefrontSort.RELEVANCE,
            },
        );

        // Assert
        expect(repository.findImageSearchProductIds).toHaveBeenCalledWith(
            expect.objectContaining({ query: 'túi xách' }),
            imageCandidates,
        );
        expect(result).toMatchObject({
            mode: 'IMAGE_AND_TEXT',
            total: 0,
            items: [],
        });
        expect(products.listStorefrontProducts).not.toHaveBeenCalled();
    });

    // Session từ bản cũ chỉ có rank vẫn đọc được đến hết TTL.
    it('should preserve legacy session ordering when similarity scores are unavailable', async () => {
        // Act
        const result = await target.getSearch('legacy-session', {
            page: 1,
            pageSize: 20,
        });

        // Assert
        expect(result.total).toBe(2);
        expect(products.getStorefrontProductsByIds).toHaveBeenCalledWith(
            ['image-first', 'both-sources'],
            true,
        );
    });

    // Ảnh bị AI từ chối là lỗi đầu vào, không được che bằng text fallback dù có query chữ.
    it('should preserve invalid-image errors instead of falling back to text', async () => {
        imageEmbedding.embedImage.mockRejectedValue(
            new BadRequestException('IMAGE_INVALID'),
        );

        await expect(
            target.createSearch(Buffer.from('image bytes'), 'image/png', {
                search: 'red bag',
                page: 1,
                pageSize: 20,
            }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(products.listStorefrontProducts).not.toHaveBeenCalled();
    });

    // Image-only không được âm thầm trả kết quả chữ hoặc danh sách rỗng khi vector service down.
    it('should return 503 for image-only dependency failure', async () => {
        imageEmbedding.embedImage.mockRejectedValue(
            new Error('dependency down'),
        );

        await expect(
            target.createSearch(Buffer.from('image bytes'), 'image/png', {
                page: 1,
                pageSize: 20,
            }),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    // MIME unsupported bị từ chối trước khi raw bytes được chuyển tới AI Service.
    it('should reject unsupported image type before calling the embedding client', async () => {
        await expect(
            target.createSearch(Buffer.from('not allowed'), 'image/gif', {
                page: 1,
                pageSize: 20,
            }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(imageEmbedding.embedImage).not.toHaveBeenCalled();
    });

    // Session hết hạn trả Gone cho image-only để client có thể yêu cầu người dùng chọn ảnh lại.
    it('should return 410 when an image-only session expires', async () => {
        recommendation.getSession.mockResolvedValue(null);

        await expect(
            target.getSearch('expired-session', { page: 1, pageSize: 20 }),
        ).rejects.toBeInstanceOf(GoneException);
    });
});
