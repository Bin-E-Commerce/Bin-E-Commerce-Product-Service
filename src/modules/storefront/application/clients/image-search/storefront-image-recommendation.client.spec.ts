import { ConfigService } from '@nestjs/config';
import { StorefrontImageRecommendationClient } from '@/modules/storefront/application/clients/image-search/storefront-image-recommendation.client';

describe('StorefrontImageRecommendationClient image request contract', () => {
    const createClient = () =>
        new StorefrontImageRecommendationClient({
            get: (key: string, fallback?: string) =>
                ({
                    RECOMMENDATION_SERVICE_URL: 'http://recommendation.test',
                    INTERNAL_SERVICE_TOKEN: 'test-token',
                })[key] ?? fallback,
        } as ConfigService);

    // Khôi phục fetch mock để request giả không ảnh hưởng suite khác.
    afterEach(() => {
        jest.restoreAllMocks();
    });

    // dimensions được kiểm tra ở AI/Product boundary nhưng không thuộc DTO candidate của Recommendation.
    it('should send only fields accepted by the Recommendation DTO', async () => {
        const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('[]', {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );

        await expect(
            createClient().findCandidates({
                modelVersion: 'pe-core-test-v1',
                dimensions: 512,
                preprocessVersion: 'pe-core-image-transform-v1',
                vector: [1, ...Array<number>(511).fill(0)],
            }),
        ).resolves.toEqual([]);

        const request = fetchSpy.mock.calls[0];
        if (!request) throw new Error('Recommendation request was not sent');
        expect(request[0]).toBe(
            'http://recommendation.test/api/v1/recommendation/catalog/image-search/candidates',
        );
        const options = request[1] as RequestInit;
        expect(JSON.parse(String(options.body))).toEqual({
            modelVersion: 'pe-core-test-v1',
            preprocessVersion: 'pe-core-image-transform-v1',
            vector: [1, ...Array<number>(511).fill(0)],
            limit: 500,
        });
        expect(JSON.parse(String(options.body))).not.toHaveProperty(
            'dimensions',
        );
    });
});
