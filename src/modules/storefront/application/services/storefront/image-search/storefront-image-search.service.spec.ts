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

    // Điểm của sản phẩm bị loại bởi catalog không được nâng ngưỡng của kết quả còn lại.
    it('should trim weak visual matches after catalog filtering and before pagination', async () => {
        // Arrange
        const candidates = [
            { ...imageCandidates[0]!, similarityScore: 0.99 },
            { ...imageCandidates[1]!, similarityScore: 0.87 },
            {
                ...imageCandidates[1]!,
                productId: 'borderline',
                rank: 3,
                similarityScore: 0.82,
            },
            {
                ...imageCandidates[1]!,
                productId: 'weak-match',
                rank: 4,
                similarityScore: 0.81,
            },
        ];
        recommendation.getSession.mockResolvedValue(candidates);
        // Sort giá xếp điểm cao nhất xuống cuối; nó vẫn phải làm mốc tương đồng.
        repository.findImageSearchProductIds.mockResolvedValue([
            'weak-match',
            'borderline',
            'both-sources',
        ]);

        // Act
        const result = await target.getSearch('search-session', {
            inStock: true,
            sort: StorefrontSort.PRICE_ASC,
            page: 2,
            pageSize: 1,
        });

        // Assert
        expect(repository.findImageSearchProductIds).toHaveBeenCalledWith(
            expect.objectContaining({
                inStock: true,
                sort: StorefrontSort.PRICE_ASC,
            }),
            candidates,
        );
        expect(result).toMatchObject({
            mode: 'IMAGE',
            total: 2,
            totalPages: 2,
        });
        expect(products.getStorefrontProductsByIds).toHaveBeenCalledWith(
            ['both-sources'],
            true,
        );
        expect(recommendation.createSession).not.toHaveBeenCalled();
    });

    // Đổi hướng ảnh hoán đổi hai vùng nhưng không được làm ứng viên khác dáng quay lại.
    it.each([
        [
            [0.788, 0.715],
            [0.738, 0.714],
        ],
        [
            [0.709, 0.791],
            [0.73, 0.731],
        ],
    ] as Array<[[number, number], [number, number]]>)(
        'should remove a close whole-image match that disagrees on a confident detail',
        async (closestDetails, otherDetails) => {
            recommendation.getSession.mockResolvedValue([
                {
                    ...imageCandidates[0]!,
                    similarityScore: 0.831,
                    detailScores: closestDetails,
                },
                {
                    ...imageCandidates[1]!,
                    similarityScore: 0.815,
                    detailScores: otherDetails,
                },
            ]);

            const result = await target.getSearch('search-session', {
                page: 1,
                pageSize: 20,
            });

            expect(result.total).toBe(1);
            expect(products.getStorefrontProductsByIds).toHaveBeenCalledWith(
                ['image-first'],
                true,
            );
        },
    );

    // Khi hai vùng trái chiều, chỉ loại ứng viên nếu mốc thắng rõ ở vùng chi tiết và cả toàn ảnh.
    it.each([
        { candidateScore: 0.82259, total: 1, ids: ['image-first'] },
        {
            candidateScore: 0.836,
            total: 2,
            ids: ['image-first', 'both-sources'],
        },
    ])(
        'should use the full-image margin to resolve conflicting details with score $candidateScore',
        async ({ candidateScore, total, ids }) => {
            // Arrange
            recommendation.getSession.mockResolvedValue([
                {
                    ...imageCandidates[0]!,
                    similarityScore: 0.84679,
                    detailScores: [0.85029, 0.76683],
                },
                {
                    ...imageCandidates[1]!,
                    similarityScore: candidateScore,
                    detailScores: [0.79997, 0.79696],
                },
            ]);

            // Act
            const result = await target.getSearch('search-session', {
                page: 1,
                pageSize: 2,
            });

            // Assert
            expect(result.total).toBe(total);
            expect(products.getStorefrontProductsByIds).toHaveBeenCalledWith(
                ids,
                true,
            );
        },
    );

    // Hai vùng mâu thuẫn gần ngang nhau thì giữ cả hai; khi lọc mất mốc cũ, ứng viên hợp catalog vẫn được trả.
    it('should preserve conflicting detail matches and use the current catalog filters', async () => {
        recommendation.getSession.mockResolvedValue([
            {
                ...imageCandidates[0]!,
                similarityScore: 0.87,
                detailScores: [0.83, 0.75],
            },
            {
                ...imageCandidates[1]!,
                similarityScore: 0.84,
                detailScores: [0.78, 0.79],
            },
        ]);
        const result = await target.getSearch('search-session', {
            page: 1,
            pageSize: 20,
        });
        expect(result.total).toBe(2);

        repository.findImageSearchProductIds.mockResolvedValue([
            'both-sources',
        ]);
        const filtered = await target.getSearch('search-session', {
            inStock: true,
            page: 1,
            pageSize: 20,
        });
        expect(filtered.total).toBe(1);
        expect(products.getStorefrontProductsByIds).toHaveBeenLastCalledWith(
            ['both-sources'],
            true,
        );
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
