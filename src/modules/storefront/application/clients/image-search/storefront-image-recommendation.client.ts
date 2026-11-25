// Client Recommendation chỉ truyền embedding PE-Core hoặc candidate metadata, không gọi Product qua mạng.
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StorefrontImageRecommendationPort } from '@/modules/storefront/application/ports/image-search/image-search-recommendation.port';
import type {
    StorefrontImageEmbedding,
    StorefrontImageSearchCandidate,
} from '@/modules/storefront/application/types/image-search/image-search.type';

const MAX_IMAGE_CANDIDATES = 500;
const RECOMMENDATION_TIMEOUT_MS = 3_000;
const RECOMMENDATION_AUXILIARY_SEARCH_TIMEOUT_MS = 4_500;
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class StorefrontImageRecommendationClient
    implements StorefrontImageRecommendationPort
{
    private readonly baseUrl: string;
    private readonly token: string;

    // Dùng service URL/token hiện tại; timeout ngắn để image search có thể fallback sớm sang search chữ.
    constructor(config: ConfigService) {
        this.baseUrl = config
            .get<string>('RECOMMENDATION_SERVICE_URL', 'http://localhost:3006')
            .replace(/\/$/, '');
        this.token = config.get<string>('INTERNAL_SERVICE_TOKEN', '');
    }

    // Nhận thứ hạng và cosine đã kiểm tra, dùng rank đơn thuần nếu Recommendation cũ chưa trả điểm.
    async findCandidates(
        embedding: StorefrontImageEmbedding,
    ): Promise<StorefrontImageSearchCandidate[]> {
        // Nhánh có hai vùng hoặc hai góc xoay dùng thêm thời gian cho batch Qdrant; session giữ timeout cũ.
        const response = await this.request(
            '/api/v1/recommendation/catalog/image-search/candidates',
            'POST',
            {
                modelVersion: embedding.modelVersion,
                preprocessVersion: embedding.preprocessVersion,
                vector: embedding.vector,
                detailVectors: embedding.detailVectors,
                rotationVectors: embedding.rotationVectors,
                strongMatchRequired: embedding.strongMatchRequired,
                limit: MAX_IMAGE_CANDIDATES,
            },
            embedding.detailVectors || embedding.rotationVectors
                ? RECOMMENDATION_AUXILIARY_SEARCH_TIMEOUT_MS
                : RECOMMENDATION_TIMEOUT_MS,
        );
        if (!response.ok) {
            throw new ServiceUnavailableException(
                `IMAGE_CANDIDATE_SEARCH_FAILED_${response.status}`,
            );
        }
        let rows: unknown;
        try {
            rows = await response.json();
        } catch {
            throw new ServiceUnavailableException(
                'IMAGE_CANDIDATE_RESPONSE_INVALID',
            );
        }
        if (!Array.isArray(rows) || rows.length > MAX_IMAGE_CANDIDATES) {
            throw new ServiceUnavailableException(
                'IMAGE_CANDIDATE_RESPONSE_INVALID',
            );
        }
        const seen = new Set<string>();
        return rows.map((row, index) => {
            if (!row || typeof row !== 'object') {
                throw new ServiceUnavailableException(
                    'IMAGE_CANDIDATE_RESPONSE_INVALID',
                );
            }
            const candidate = row as Record<string, unknown>;
            if (
                typeof candidate.productId !== 'string' ||
                !UUID_PATTERN.test(candidate.productId) ||
                seen.has(candidate.productId) ||
                typeof candidate.catalogRevision !== 'string' ||
                !/^\d{1,19}$/.test(candidate.catalogRevision) ||
                typeof candidate.imageFingerprint !== 'string' ||
                !/^[0-9a-f]{64}$/i.test(candidate.imageFingerprint) ||
                !this.isValidSimilarityScore(candidate.similarityScore) ||
                !this.isValidDetailScores(candidate.detailScores) ||
                candidate.rank !== index + 1
            ) {
                throw new ServiceUnavailableException(
                    'IMAGE_CANDIDATE_RESPONSE_INVALID',
                );
            }
            seen.add(candidate.productId);
            return candidate as unknown as StorefrontImageSearchCandidate;
        });
    }

    // Redis session lưu metadata ứng viên và cosine để thay trang/bộ lọc không gửi lại ảnh.
    async createSession(
        candidates: StorefrontImageSearchCandidate[],
    ): Promise<string> {
        const response = await this.request(
            '/api/v1/recommendation/catalog/image-search/sessions',
            'POST',
            { candidates },
        );
        if (!response.ok) {
            throw new ServiceUnavailableException(
                `IMAGE_SEARCH_SESSION_CREATE_FAILED_${response.status}`,
            );
        }
        let value: Record<string, unknown>;
        try {
            value = (await response.json()) as Record<string, unknown>;
        } catch {
            throw new ServiceUnavailableException(
                'IMAGE_SEARCH_SESSION_RESPONSE_INVALID',
            );
        }
        if (
            typeof value.searchId !== 'string' ||
            !UUID_PATTERN.test(value.searchId)
        ) {
            throw new ServiceUnavailableException(
                'IMAGE_SEARCH_SESSION_RESPONSE_INVALID',
            );
        }
        return value.searchId;
    }

    // 404 là TTL miss; điểm hỏng hoặc lỗi dependency không được coi là một session hợp lệ.
    async getSession(
        searchId: string,
    ): Promise<StorefrontImageSearchCandidate[] | null> {
        const response = await this.request(
            `/api/v1/recommendation/catalog/image-search/sessions/${encodeURIComponent(searchId)}`,
            'GET',
        );
        if (response.status === 404) return null;
        if (!response.ok) {
            throw new ServiceUnavailableException(
                `IMAGE_SEARCH_SESSION_READ_FAILED_${response.status}`,
            );
        }
        let value: Record<string, unknown>;
        try {
            value = (await response.json()) as Record<string, unknown>;
        } catch {
            throw new ServiceUnavailableException(
                'IMAGE_SEARCH_SESSION_RESPONSE_INVALID',
            );
        }
        if (
            !Array.isArray(value.candidates) ||
            value.candidates.length > MAX_IMAGE_CANDIDATES
        ) {
            throw new ServiceUnavailableException(
                'IMAGE_SEARCH_SESSION_RESPONSE_INVALID',
            );
        }
        const seen = new Set<string>();
        let previousRank = 0;
        return value.candidates.map((row) => {
            if (!row || typeof row !== 'object') {
                throw new ServiceUnavailableException(
                    'IMAGE_SEARCH_SESSION_RESPONSE_INVALID',
                );
            }
            const candidate = row as Record<string, unknown>;
            if (
                typeof candidate.productId !== 'string' ||
                !UUID_PATTERN.test(candidate.productId) ||
                seen.has(candidate.productId) ||
                typeof candidate.catalogRevision !== 'string' ||
                !/^\d{1,19}$/.test(candidate.catalogRevision) ||
                typeof candidate.imageFingerprint !== 'string' ||
                !/^[0-9a-f]{64}$/i.test(candidate.imageFingerprint) ||
                !this.isValidSimilarityScore(candidate.similarityScore) ||
                !this.isValidDetailScores(candidate.detailScores) ||
                !Number.isInteger(candidate.rank) ||
                Number(candidate.rank) <= previousRank ||
                Number(candidate.rank) > MAX_IMAGE_CANDIDATES
            ) {
                throw new ServiceUnavailableException(
                    'IMAGE_SEARCH_SESSION_RESPONSE_INVALID',
                );
            }
            seen.add(candidate.productId);
            previousRank = Number(candidate.rank);
            return candidate as unknown as StorefrontImageSearchCandidate;
        });
    }

    // Chấp nhận session/response cũ thiếu điểm; điểm hiện diện phải đúng biên cosine đã chuẩn hóa.
    private isValidSimilarityScore(value: unknown): boolean {
        return (
            value === undefined ||
            (typeof value === 'number' &&
                Number.isFinite(value) &&
                value >= 0 &&
                value <= 1)
        );
    }

    // Chấp nhận session cũ; nhánh mới chỉ nhận đúng hai cosine hữu hạn kể cả điểm âm.
    private isValidDetailScores(value: unknown): boolean {
        return (
            value === undefined ||
            (Array.isArray(value) &&
                value.length === 2 &&
                value.every(
                    (score) =>
                        typeof score === 'number' &&
                        Number.isFinite(score) &&
                        Math.abs(score) <= 1,
                ))
        );
    }

    // Header service token chỉ được gắn cho request nội bộ; lỗi mạng không đưa URL/body vào message.
    private async request(
        path: string,
        method: 'GET' | 'POST',
        body?: unknown,
        timeoutMs = RECOMMENDATION_TIMEOUT_MS,
    ): Promise<Response> {
        if (!this.token) {
            throw new ServiceUnavailableException(
                'INTERNAL_SERVICE_TOKEN_MISSING',
            );
        }
        try {
            return await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: {
                    accept: 'application/json',
                    'x-internal-service-token': this.token,
                    ...(body ? { 'content-type': 'application/json' } : {}),
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch {
            throw new ServiceUnavailableException(
                'IMAGE_RECOMMENDATION_UNAVAILABLE',
            );
        }
    }
}
