// Kiểm tra AI validation errors không bị chuyển thành lỗi hạ tầng và fallback sai.
import {
    BadRequestException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorefrontImageEmbeddingClient } from '@/modules/storefront/application/clients/image-search/storefront-image-embedding.client';

describe('StorefrontImageEmbeddingClient', () => {
    let target: StorefrontImageEmbeddingClient;

    // Cấu hình giả giữ test độc lập với environment và không gọi AI Service thật.
    beforeEach(() => {
        const values: Record<string, string> = {
            AI_SERVICE_URL: 'http://ai-service.test',
            INTERNAL_SERVICE_TOKEN: 'internal-test-token',
            IMAGE_SEARCH_MODEL_VERSION: 'pe-core-test-v1',
        };
        const mockConfig = {
            get: jest.fn(
                (key: string, defaultValue?: string) =>
                    values[key] ?? defaultValue,
            ),
        };
        target = new StorefrontImageEmbeddingClient(
            mockConfig as unknown as ConfigService,
        );
    });

    // Khôi phục fetch spy để lỗi hoặc cấu hình của test không rò sang suite khác.
    afterEach(() => {
        jest.restoreAllMocks();
    });

    // Query yêu cầu giữ khung ảnh dài/rộng; ảnh bị AI từ chối vẫn là lỗi client, không kích hoạt fallback chữ.
    it('should map AI 422 validation responses to a bad request', async () => {
        // Arrange
        const mockFetch = jest
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(null, { status: 422 }));

        // Act & Assert
        await expect(
            target.embedImage(Buffer.from('invalid image'), 'image/png'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(mockFetch).toHaveBeenCalledWith(
            'http://ai-service.test/api/v1/search-ranking/image-embedding?framing=preserve_frame',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    // Lỗi 5xx vẫn là dependency outage để image search có thể fallback hoặc trả 503.
    it('should preserve service errors for AI dependency failures', async () => {
        jest.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(null, { status: 503 }),
        );

        await expect(
            target.embedImage(Buffer.from('image'), 'image/png'),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
});
