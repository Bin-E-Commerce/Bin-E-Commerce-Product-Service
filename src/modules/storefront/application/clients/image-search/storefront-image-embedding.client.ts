// Client chỉ chuyển raw bytes nội bộ tới AI Service; không lưu hoặc log ảnh/vector truy vấn.
import {
    BadRequestException,
    Injectable,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StorefrontImageEmbeddingPort } from '@/modules/storefront/application/ports/image-search/image-search-embedding.port';
import type { StorefrontImageEmbedding } from '@/modules/storefront/application/types/image-search/image-search.type';

const IMAGE_DIMENSIONS = 512;
const IMAGE_PREPROCESS_VERSION = 'pe-core-image-transform-v1';

@Injectable()
export class StorefrontImageEmbeddingClient
    implements StorefrontImageEmbeddingPort
{
    private readonly baseUrl: string;
    private readonly token: string;
    private readonly modelVersion: string;

    // Pin model contract ở Product boundary để từ chối embedding khác vector space.
    constructor(config: ConfigService) {
        this.baseUrl = config
            .get<string>('AI_SERVICE_URL', 'http://localhost:3009')
            .replace(/\/$/, '');
        this.token = config.get<string>('INTERNAL_SERVICE_TOKEN', '');
        this.modelVersion = config.get<string>(
            'IMAGE_SEARCH_MODEL_VERSION',
            'pe-core-s16-384-r255fa76e',
        );
    }

    // Yêu cầu AI giữ khung ảnh truy vấn dài hoặc rộng để hình dáng không bị mất khi cắt giữa.
    // Body đã giới hạn ở HTTP boundary; lỗi ảnh 4xx được tách khỏi lỗi hạ tầng để giữ fallback hiện có.
    async embedImage(
        body: Buffer,
        contentType: string,
    ): Promise<StorefrontImageEmbedding> {
        if (!this.token) {
            throw new ServiceUnavailableException(
                'INTERNAL_SERVICE_TOKEN_MISSING',
            );
        }
        let response: Response;
        try {
            response = await fetch(
                `${this.baseUrl}/api/v1/search-ranking/image-embedding?framing=preserve_frame`,
                {
                    method: 'POST',
                    headers: {
                        accept: 'application/json',
                        'content-type': contentType,
                        'x-internal-service-token': this.token,
                    },
                    body,
                    signal: AbortSignal.timeout(13_000),
                },
            );
        } catch {
            throw new ServiceUnavailableException(
                'IMAGE_EMBEDDING_SERVICE_UNAVAILABLE',
            );
        }
        // AI Service dùng 422 cho MIME, nội dung ảnh và byte cap; giữ lỗi đầu vào ở 4xx để không fallback sang text.
        if (
            response.status === 400 ||
            response.status === 413 ||
            response.status === 415 ||
            response.status === 422
        ) {
            throw new BadRequestException('IMAGE_INVALID');
        }
        if (!response.ok) {
            throw new ServiceUnavailableException(
                `IMAGE_EMBEDDING_FAILED_${response.status}`,
            );
        }
        let value: Record<string, unknown>;
        try {
            value = (await response.json()) as Record<string, unknown>;
        } catch {
            throw new ServiceUnavailableException(
                'IMAGE_EMBEDDING_RESPONSE_INVALID',
            );
        }
        const vector = value.vector;
        if (
            value.modelVersion !== this.modelVersion ||
            value.dimensions !== IMAGE_DIMENSIONS ||
            value.preprocessVersion !== IMAGE_PREPROCESS_VERSION ||
            !Array.isArray(vector) ||
            vector.length !== IMAGE_DIMENSIONS ||
            vector.some(
                (component) =>
                    typeof component !== 'number' ||
                    !Number.isFinite(component),
            )
        ) {
            throw new ServiceUnavailableException(
                'IMAGE_EMBEDDING_CONTRACT_MISMATCH',
            );
        }
        const normalizedVector = vector as number[];
        const norm = Math.sqrt(
            normalizedVector.reduce(
                (sum, component) => sum + component * component,
                0,
            ),
        );
        if (!Number.isFinite(norm) || Math.abs(norm - 1) > 0.01) {
            throw new ServiceUnavailableException(
                'IMAGE_EMBEDDING_NORMALIZATION_MISMATCH',
            );
        }
        // Điểm toàn ảnh vẫn dùng được với AI cũ hoặc khi nhánh bổ sung không trả đủ hai vector chuẩn hóa.
        const rotationVectors = this.readVectorPair(value.rotationVectors);
        const detailVectors = rotationVectors
            ? undefined
            : this.readVectorPair(value.detailVectors);
        return {
            modelVersion: this.modelVersion,
            dimensions: IMAGE_DIMENSIONS,
            preprocessVersion: IMAGE_PREPROCESS_VERSION,
            vector: normalizedVector,
            ...(detailVectors ? { detailVectors } : {}),
            ...(rotationVectors ? { rotationVectors } : {}),
            ...(value.strongMatchRequired === true
                ? { strongMatchRequired: true }
                : {}),
        };
    }

    // Một query dùng đúng một loại bằng chứng phụ. Thiếu một vector hợp lệ thì bỏ cả cặp.
    private readVectorPair(value: unknown): [number[], number[]] | undefined {
        if (
            Array.isArray(value) &&
            value.length === 2 &&
            this.isNormalizedDetailVector(value[0]) &&
            this.isNormalizedDetailVector(value[1])
        ) {
            return [value[0], value[1]];
        }
        return undefined;
    }

    // Giới hạn cả chiều, giá trị và norm trước khi gửi vector chi tiết vào cùng không gian catalog.
    private isNormalizedDetailVector(value: unknown): value is number[] {
        if (
            !Array.isArray(value) ||
            value.length !== IMAGE_DIMENSIONS ||
            value.some(
                (item) => typeof item !== 'number' || !Number.isFinite(item),
            )
        ) {
            return false;
        }
        const norm = Math.sqrt(
            value.reduce((sum, item) => sum + item * item, 0),
        );
        return Number.isFinite(norm) && Math.abs(norm - 1) <= 0.01;
    }
}
