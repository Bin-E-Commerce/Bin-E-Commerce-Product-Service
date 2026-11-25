// Adapter gọi AI Service nội bộ; lỗi model được ném về application để fallback thứ tự PostgreSQL.
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type {
    SearchRerankCandidate,
    SearchRerankPrediction,
    SearchRerankerPort,
} from '@/modules/storefront/application/ports/text-search/search-reranker.port';

interface SearchRerankResponse {
    requestId: string;
    modelVersion: string;
    predictions: SearchRerankPrediction[];
}

interface SearchRerankerStatusResponse {
    ready: boolean;
    modelVersion: string | null;
    schemaVersion: string;
}

@Injectable()
export class AiSearchRerankerClient implements SearchRerankerPort {
    private readonly targetBase: string;
    private readonly internalToken: string;
    private readonly expectedModelVersion: string;
    private unavailableUntil = 0;
    private readinessCheckedAt = 0;
    private modelReady = false;

    // Đọc URL/token một lần; credential nội bộ không bao giờ đi qua response storefront.
    constructor(config: ConfigService) {
        this.targetBase = config
            .get<string>('AI_SERVICE_URL', 'http://localhost:3009')
            .replace(/\/$/, '');
        this.internalToken = config.get<string>('INTERNAL_SERVICE_TOKEN', '');
        this.expectedModelVersion = config.get<string>(
            'SEARCH_RERANKER_MODEL_VERSION',
            'search-reranker-v1',
        );
    }

    // Cache readiness trong 30 giây để tránh gọi OpenAI/Qdrant khi ONNX artifact chưa được mount.
    async isReady(): Promise<boolean> {
        const now = Date.now();
        if (!this.internalToken || now < this.unavailableUntil) return false;
        if (now - this.readinessCheckedAt < 30_000) return this.modelReady;

        try {
            const response = await fetch(
                `${this.targetBase}/api/v1/search-ranking/status`,
                {
                    headers: {
                        accept: 'application/json',
                        'x-internal-service-token': this.internalToken,
                    },
                    signal: AbortSignal.timeout(1_000),
                },
            );
            if (!response.ok) {
                this.modelReady = false;
                this.unavailableUntil = now + 30_000;
                this.readinessCheckedAt = now;
                return false;
            }
            const status =
                (await response.json()) as SearchRerankerStatusResponse;
            this.modelReady =
                status.ready === true &&
                status.modelVersion === this.expectedModelVersion &&
                status.schemaVersion === 'search-reranker-v1';
            this.readinessCheckedAt = now;
            if (!this.modelReady) this.unavailableUntil = now + 30_000;
            return this.modelReady;
        } catch {
            this.modelReady = false;
            this.unavailableUntil = now + 30_000;
            this.readinessCheckedAt = now;
            return false;
        }
    }

    // Gửi tối đa 100 candidate và xác thực response trước khi cho phép application đổi thứ tự sản phẩm.
    async rerank(
        query: string,
        candidates: SearchRerankCandidate[],
    ): Promise<SearchRerankPrediction[]> {
        if (!this.internalToken) {
            throw new Error('SEARCH_RERANKER_INTERNAL_TOKEN_MISSING');
        }
        if (candidates.length < 1 || candidates.length > 100) {
            throw new Error('SEARCH_RERANKER_CANDIDATE_COUNT_INVALID');
        }
        // Khi model chưa deploy hoặc service rớt mạng, cooldown giảm request thừa nhưng tự thử lại sau 30 giây.
        if (Date.now() < this.unavailableUntil) {
            throw new Error('SEARCH_RERANKER_COOLDOWN');
        }

        let response: Response;
        try {
            response = await fetch(
                `${this.targetBase}/api/v1/search-ranking/rerank`,
                {
                    method: 'POST',
                    headers: {
                        accept: 'application/json',
                        'content-type': 'application/json',
                        'x-internal-service-token': this.internalToken,
                    },
                    body: JSON.stringify({
                        requestId: randomUUID(),
                        query,
                        items: candidates,
                    }),
                    signal: AbortSignal.timeout(2_500),
                },
            );
        } catch {
            this.pauseSearchAi();
            throw new Error('SEARCH_RERANKER_UNAVAILABLE');
        }
        if (!response.ok) {
            // Auth/schema lỗi cũng cần cooldown; nếu không mỗi request search sẽ lặp lại cùng một lỗi service-to-service.
            this.pauseSearchAi();
            throw new Error('SEARCH_RERANKER_REJECTED');
        }

        let body: SearchRerankResponse;
        try {
            body = (await response.json()) as SearchRerankResponse;
        } catch {
            this.pauseSearchAi();
            throw new Error('SEARCH_RERANKER_RESPONSE_INVALID');
        }
        const candidateIds = new Set(
            candidates.map((candidate) => candidate.itemId),
        );
        if (
            typeof body.modelVersion !== 'string' ||
            body.modelVersion !== this.expectedModelVersion ||
            !Array.isArray(body.predictions) ||
            body.predictions.length !== candidates.length
        ) {
            this.pauseSearchAi();
            throw new Error('SEARCH_RERANKER_RESPONSE_COUNT_MISMATCH');
        }
        const seenIds = new Set<string>();
        for (const prediction of body.predictions) {
            if (
                !candidateIds.has(prediction.itemId) ||
                seenIds.has(prediction.itemId) ||
                !Number.isFinite(prediction.score)
            ) {
                this.pauseSearchAi();
                throw new Error('SEARCH_RERANKER_RESPONSE_INVALID');
            }
            seenIds.add(prediction.itemId);
        }
        return body.predictions;
    }

    // Dừng request lặp và buộc kiểm tra readiness lại sau lỗi mạng, auth hoặc sai contract.
    private pauseSearchAi(): void {
        this.unavailableUntil = Date.now() + 30_000;
        this.modelReady = false;
        this.readinessCheckedAt = 0;
    }
}
