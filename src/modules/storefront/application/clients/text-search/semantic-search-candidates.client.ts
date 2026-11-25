// Adapter query embedding + Qdrant candidate source; mọi request dùng shared service token.
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
    SemanticSearchCandidate,
    SemanticSearchCandidatesPort,
} from '@/modules/storefront/application/ports/text-search/semantic-search-candidates.port';

interface QueryEmbeddingResponse {
    modelVersion: string;
    dimensions: number;
    vector: number[];
}

@Injectable()
export class SemanticSearchCandidatesClient
    implements SemanticSearchCandidatesPort
{
    private readonly aiServiceUrl: string;
    private readonly recommendationServiceUrl: string;
    private readonly internalToken: string;
    private readonly expectedEmbeddingVersion: string;
    private readonly expectedDimensions: number;
    private unavailableUntil = 0;

    // Đọc endpoints và model contract một lần để tránh service URL hoặc vector schema bị hard-code ở use case.
    constructor(config: ConfigService) {
        this.aiServiceUrl = config
            .get<string>('AI_SERVICE_URL', 'http://localhost:3009')
            .replace(/\/$/, '');
        this.recommendationServiceUrl = config
            .get<string>('RECOMMENDATION_SERVICE_URL', 'http://localhost:3006')
            .replace(/\/$/, '');
        this.internalToken = config.get<string>('INTERNAL_SERVICE_TOKEN', '');
        this.expectedEmbeddingVersion = config.get<string>(
            'EMBEDDING_MODEL_VERSION',
            'text-embedding-3-small',
        );
        this.expectedDimensions = Number(
            config.get<string>('EMBEDDING_DIMENSIONS', '1536'),
        );
    }

    // Tạo vector nếu cache miss rồi tìm top semantic IDs; mọi lỗi được trả về caller để dùng SQL-only fallback.
    async findCandidates(
        query: string,
        options: { limit: number; inStockOnly: boolean },
    ): Promise<SemanticSearchCandidate[]> {
        if (!this.internalToken || Date.now() < this.unavailableUntil) {
            throw new Error('SEMANTIC_SEARCH_UNAVAILABLE');
        }
        const embedding = await this.createQueryEmbedding(query);
        return this.findProductsByVector(embedding, options);
    }

    // Gọi AI Service nội bộ; timeout đủ cho cache miss nhưng bị chặn để search không treo vô hạn.
    private async createQueryEmbedding(
        query: string,
    ): Promise<QueryEmbeddingResponse> {
        let response: Response;
        try {
            response = await fetch(
                `${this.aiServiceUrl}/api/v1/search-ranking/query-embedding`,
                {
                    method: 'POST',
                    headers: this.internalHeaders(),
                    body: JSON.stringify({ query }),
                    signal: AbortSignal.timeout(5_000),
                },
            );
        } catch {
            this.pauseSemanticSearch();
            throw new Error('SEARCH_QUERY_EMBEDDING_UNAVAILABLE');
        }
        if (!response.ok) {
            this.pauseSemanticSearch();
            throw new Error('SEARCH_QUERY_EMBEDDING_REJECTED');
        }

        let embedding: QueryEmbeddingResponse;
        try {
            embedding = (await response.json()) as QueryEmbeddingResponse;
        } catch {
            this.pauseSemanticSearch();
            throw new Error('SEARCH_QUERY_EMBEDDING_SCHEMA_MISMATCH');
        }
        if (
            embedding.modelVersion !== this.expectedEmbeddingVersion ||
            embedding.dimensions !== this.expectedDimensions ||
            !Array.isArray(embedding.vector) ||
            embedding.vector.length !== this.expectedDimensions ||
            !embedding.vector.every(Number.isFinite)
        ) {
            this.pauseSemanticSearch();
            throw new Error('SEARCH_QUERY_EMBEDDING_SCHEMA_MISMATCH');
        }
        return embedding;
    }

    // Chỉ gửi vector có contract đã kiểm tra sang Qdrant adapter; inStockOnly tôn trọng bộ lọc search hiện hành.
    private async findProductsByVector(
        embedding: QueryEmbeddingResponse,
        options: { limit: number; inStockOnly: boolean },
    ): Promise<SemanticSearchCandidate[]> {
        let response: Response;
        try {
            response = await fetch(
                `${this.recommendationServiceUrl}/api/v1/recommendation/catalog/search-candidates`,
                {
                    method: 'POST',
                    headers: this.internalHeaders(),
                    body: JSON.stringify({
                        vector: embedding.vector,
                        limit: Math.min(Math.max(options.limit, 1), 60),
                        inStockOnly: options.inStockOnly,
                    }),
                    signal: AbortSignal.timeout(2_500),
                },
            );
        } catch {
            this.pauseSemanticSearch();
            throw new Error('SEMANTIC_CANDIDATE_SERVICE_UNAVAILABLE');
        }
        if (!response.ok) {
            this.pauseSemanticSearch();
            throw new Error('SEMANTIC_CANDIDATE_SERVICE_REJECTED');
        }

        let rows: SemanticSearchCandidate[];
        try {
            rows = (await response.json()) as SemanticSearchCandidate[];
        } catch {
            this.pauseSemanticSearch();
            throw new Error('SEMANTIC_CANDIDATE_RESPONSE_INVALID');
        }
        if (!Array.isArray(rows)) {
            this.pauseSemanticSearch();
            throw new Error('SEMANTIC_CANDIDATE_RESPONSE_INVALID');
        }
        const seenIds = new Set<string>();
        for (const row of rows) {
            if (
                typeof row.productId !== 'string' ||
                !row.productId ||
                seenIds.has(row.productId) ||
                !Number.isFinite(row.similarityScore)
            ) {
                this.pauseSemanticSearch();
                throw new Error('SEMANTIC_CANDIDATE_RESPONSE_INVALID');
            }
            seenIds.add(row.productId);
        }
        return rows.slice(0, Math.min(Math.max(options.limit, 1), 60));
    }

    // Cùng header helper để secret chỉ có trên service-to-service request, không đi qua client browser.
    private internalHeaders(): Record<string, string> {
        return {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-internal-service-token': this.internalToken,
        };
    }

    // Mất semantic dependency hoặc sai response contract thì không lặp request trên từng lượt tìm kiếm.
    private pauseSemanticSearch(): void {
        this.unavailableUntil = Date.now() + 30_000;
    }
}
