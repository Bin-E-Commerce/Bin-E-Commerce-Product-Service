// Use case phối hợp lexical/semantic retrieval, rerank có giới hạn và fallback về PostgreSQL.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
    SEARCH_RERANKER,
    type SearchRerankCandidate,
    type SearchRerankerPort,
} from '@/modules/storefront/application/ports/text-search/search-reranker.port';
import {
    SEMANTIC_SEARCH_CANDIDATES,
    type SemanticSearchCandidatesPort,
} from '@/modules/storefront/application/ports/text-search/semantic-search-candidates.port';
import {
    STOREFRONT_SEARCH_REPOSITORY,
    type StorefrontSearchFilters,
    type StorefrontSearchPage,
    type StorefrontSearchRepositoryPort,
} from '@/modules/storefront/application/ports/storefront-search.repository.port';
import type { StorefrontSearchRerankProduct } from '@/modules/storefront/application/types/text-search/storefront-search-rerank-product.type';
import type { ProductSearchSuggestion } from '@/modules/storefront/application/types/text-search/product-search-suggestion.type';
import {
    getStorefrontSearchMatchPriority,
    isProductIdentifierQuery,
    toPlainSearchText,
} from '@/modules/storefront/application/utils/storefront-search.utils';

@Injectable()
export class StorefrontSearchRankingService {
    private readonly logger = new Logger(StorefrontSearchRankingService.name);
    private lastFallbackWarningAt = 0;

    constructor(
        @Inject(STOREFRONT_SEARCH_REPOSITORY)
        private readonly searchRepository: StorefrontSearchRepositoryPort,
        @Optional()
        @Inject(SEARCH_RERANKER)
        private readonly searchReranker?: SearchRerankerPort,
        @Optional()
        @Inject(SEMANTIC_SEARCH_CANDIDATES)
        private readonly semanticCandidates?: SemanticSearchCandidatesPort,
    ) {}

    // Dùng chung cổng search cho autocomplete để facade storefront không cần biết chi tiết adapter.
    getProductSearchSuggestions(
        query: string,
    ): Promise<ProductSearchSuggestion[]> {
        return this.searchRepository.getProductSearchSuggestions(query);
    }

    // Xếp tối đa 100 candidate trước khi phân trang; thiếu model/provider luôn giữ kết quả SQL chính xác.
    async search(
        filters: StorefrontSearchFilters,
        isPublicQuery: boolean,
    ): Promise<StorefrontSearchPage> {
        let result: StorefrontSearchPage = { ids: [], total: 0 };
        let shouldRerank = false;
        const searchText = filters.query?.trim();
        const canUseHybridRanking =
            isPublicQuery &&
            Boolean(searchText) &&
            (!filters.sort || filters.sort === 'relevance') &&
            !isProductIdentifierQuery(searchText ?? '') &&
            Boolean(this.searchReranker && this.semanticCandidates);

        if (
            canUseHybridRanking &&
            searchText &&
            this.searchReranker &&
            this.semanticCandidates
        ) {
            try {
                if (await this.searchReranker.isReady()) {
                    const semanticPromise = this.semanticCandidates
                        .findCandidates(searchText, {
                            limit: 40,
                            inStockOnly: filters.inStock === true,
                        })
                        .catch((error: unknown) => {
                            // Semantic source là bổ trợ; lỗi của nó vẫn cho Cross-Encoder xếp lexical pool.
                            this.logFallback(error);
                            return [];
                        });
                    const [lexicalPage, semanticPage] = await Promise.all([
                        this.searchRepository.findStorefrontProductPage({
                            ...filters,
                            page: 1,
                            pageSize: 100,
                        }),
                        semanticPromise,
                    ]);
                    const eligibleSemantic =
                        await this.searchRepository.findEligibleSemanticCandidates(
                            filters,
                            semanticPage.map(
                                (candidate) => candidate.productId,
                            ),
                        );
                    const semanticIds = new Set(eligibleSemantic.ids);
                    const lexicalIds = new Set(lexicalPage.ids);
                    const lexicalCapacity = Math.max(
                        0,
                        100 - eligibleSemantic.ids.length,
                    );
                    // Semantic/lexical overlap chiếm chung slot; phần còn lại lấp bằng lexical theo thứ tự retrieval.
                    const lexicalOnlyIds = new Set(
                        lexicalPage.ids
                            .filter((id) => !semanticIds.has(id))
                            .slice(0, lexicalCapacity),
                    );
                    const selectedIds = new Set([
                        ...eligibleSemantic.ids,
                        ...lexicalOnlyIds,
                    ]);
                    const candidateIds = Array.from(
                        new Set([
                            ...lexicalPage.ids.filter((id) =>
                                selectedIds.has(id),
                            ),
                            ...eligibleSemantic.ids.filter(
                                (id) => !lexicalIds.has(id),
                            ),
                        ]),
                    );
                    const semanticOnlyCount =
                        eligibleSemantic.ids.length -
                        eligibleSemantic.lexicalMatchCount;
                    const hybridTotal = Math.max(
                        0,
                        lexicalPage.total + semanticOnlyCount,
                    );

                    if (candidateIds.length > 0) {
                        const rerankedPageCount = Math.ceil(
                            candidateIds.length / filters.pageSize,
                        );
                        if (filters.page <= rerankedPageCount) {
                            result = { ids: candidateIds, total: hybridTotal };
                            shouldRerank = true;
                        } else {
                            // Trang sau pool AI tiếp tục từ SQL, loại candidate đã xuất hiện để không lặp sản phẩm.
                            const tail =
                                await this.searchRepository.findStorefrontProductPage(
                                    {
                                        ...filters,
                                        page: filters.page - rerankedPageCount,
                                        pageSize: filters.pageSize,
                                        excludeProductIds: candidateIds,
                                    },
                                );
                            result = { ids: tail.ids, total: hybridTotal };
                        }
                    }
                }
            } catch (error) {
                // AI/Qdrant là nguồn tăng chất lượng; lỗi không được làm mất khả năng tìm bằng SQL.
                this.logFallback(error);
            }
        }

        if (isPublicQuery && result.ids.length === 0 && result.total === 0) {
            result =
                await this.searchRepository.findStorefrontProductPage(filters);
        }

        if (!shouldRerank || !searchText || result.ids.length === 0) {
            return result;
        }

        try {
            const products =
                await this.searchRepository.findSearchRerankingCandidates(
                    result.ids,
                    isPublicQuery,
                    searchText,
                );
            // Status có thể đổi giữa retrieval và hydrate; không rerank pool thiếu vì offset sẽ tạo trang khuyết.
            if (products.length !== result.ids.length) {
                throw new Error('SEARCH_MODEL_CANDIDATES_CHANGED');
            }
            const retrievalPosition = new Map(
                result.ids.map((productId, index) => [productId, index]),
            );
            products.sort(
                (left, right) =>
                    (retrievalPosition.get(left.id) ?? 0) -
                    (retrievalPosition.get(right.id) ?? 0),
            );
            const rankedProducts = await this.rerankCandidates(
                searchText,
                products,
            );
            const pageOffset = (filters.page - 1) * filters.pageSize;
            return {
                ids: rankedProducts
                    .slice(pageOffset, pageOffset + filters.pageSize)
                    .map((product) => product.id),
                total: result.total,
            };
        } catch (error) {
            // Lỗi hydrate/inference phải quay lại page SQL đầy đủ, không trả nửa candidate pool.
            this.logFallback(error);
            return this.searchRepository.findStorefrontProductPage(filters);
        }
    }

    // Gửi văn bản catalog đã giới hạn sang model, rồi dùng exact match và retrieval order để phá hòa ổn định.
    private async rerankCandidates(
        searchText: string,
        products: StorefrontSearchRerankProduct[],
    ): Promise<StorefrontSearchRerankProduct[]> {
        if (!this.searchReranker || products.length < 2) return products;

        const candidates = products.map((product): SearchRerankCandidate => {
            const categoryName = product.metadata?.categoryName;
            const categoryPath = product.metadata?.categoryPath;
            const category = [categoryName, categoryPath]
                .filter((value): value is string => typeof value === 'string')
                .join(' ')
                .slice(0, 300);
            const description = toPlainSearchText(
                [product.shortDescription, product.description]
                    .filter((value): value is string => Boolean(value))
                    .join(' '),
            ).slice(0, 2_000);

            return {
                itemId: product.id,
                title: product.name,
                brand: product.brand?.name ?? null,
                category: category || null,
                sku:
                    [product.sellerSku, product.gtin]
                        .filter((value): value is string => Boolean(value))
                        .join(' ')
                        .slice(0, 64) || null,
                description: description || null,
            };
        });
        const predictions = await this.searchReranker.rerank(
            searchText,
            candidates,
        );
        const scoreById = new Map(
            predictions.map((prediction) => [
                prediction.itemId,
                prediction.score,
            ]),
        );
        const retrievalPosition = new Map(
            products.map((product, index) => [product.id, index]),
        );
        const matchPriorityById = new Map(
            products.map((product) => [
                product.id,
                Math.max(
                    getStorefrontSearchMatchPriority(searchText, product),
                    product.exactVariantCodeMatch ? 2 : 0,
                    product.exactVariantNameMatch ? 1 : 0,
                ),
            ]),
        );

        // Exact tên/mã sản phẩm, brand và variant giữ ưu tiên trên model; AI xếp trong cùng nhóm, retrieval rank phá hòa cuối.
        return [...products].sort((left, right) => {
            const priorityDifference =
                (matchPriorityById.get(right.id) ?? 0) -
                (matchPriorityById.get(left.id) ?? 0);
            if (priorityDifference !== 0) return priorityDifference;

            const scoreDifference =
                (scoreById.get(right.id) ?? Number.NEGATIVE_INFINITY) -
                (scoreById.get(left.id) ?? Number.NEGATIVE_INFINITY);
            if (Number.isFinite(scoreDifference) && scoreDifference !== 0) {
                return scoreDifference;
            }

            return (
                (retrievalPosition.get(left.id) ?? 0) -
                (retrievalPosition.get(right.id) ?? 0)
            );
        });
    }

    // Giới hạn log fallback để lỗi upstream không làm lộ query hoặc tạo log lặp theo từng người dùng.
    private logFallback(error: unknown): void {
        if (Date.now() - this.lastFallbackWarningAt < 60_000) return;
        this.logger.warn(
            `Search AI fallback (${error instanceof Error ? error.name : 'UnknownError'}); keeping search available`,
        );
        this.lastFallbackWarningAt = Date.now();
    }
}
