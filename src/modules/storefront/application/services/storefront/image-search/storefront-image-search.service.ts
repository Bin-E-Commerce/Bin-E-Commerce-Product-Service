// Use case tìm ảnh: lấy ứng viên, giữ phiên và lọc độ tương đồng trên catalog hiện hành.
import {
    BadRequestException,
    GoneException,
    Inject,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import {
    STOREFRONT_IMAGE_EMBEDDING,
    type StorefrontImageEmbeddingPort,
} from '@/modules/storefront/application/ports/image-search/image-search-embedding.port';
import {
    STOREFRONT_IMAGE_RECOMMENDATION,
    type StorefrontImageRecommendationPort,
} from '@/modules/storefront/application/ports/image-search/image-search-recommendation.port';
import {
    STOREFRONT_SEARCH_REPOSITORY,
    type StorefrontSearchFilters,
    type StorefrontSearchRepositoryPort,
} from '@/modules/storefront/application/ports/storefront-search.repository.port';
import type {
    StorefrontImageSearchCandidate,
    StorefrontImageSearchFilters,
    StorefrontImageSearchMode,
    StorefrontImageSearchResponse,
} from '@/modules/storefront/application/types/image-search/image-search.type';
import { StorefrontProductsService } from '@/modules/storefront/application/services/storefront/products/storefront-products.service';
import type { StorefrontProduct } from '@/modules/storefront/application/types/products/storefront-product.type';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_CANDIDATES = 500;
const MAX_SIMILARITY_GAP = 0.05;
const SIMILARITY_COMPARISON_TOLERANCE = 1e-9;
const MIN_DETAIL_REFERENCE_SIMILARITY = 0.8;
const MIN_DETAIL_VIEW_SIMILARITY = 0.75;
const MIN_DETAIL_SEPARATION = 0.04;
const MIN_DETAIL_COUNTER_EVIDENCE = 0.025;
const MIN_WHOLE_IMAGE_CONFLICT_MARGIN = 0.02;
const MIN_DETAIL_CONFLICT_MARGIN = 0.015;
const SUPPORTED_IMAGE_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
]);

@Injectable()
export class StorefrontImageSearchService {
    private readonly logger = new Logger(StorefrontImageSearchService.name);

    // Kết nối application ports và read model card; ảnh và vector chỉ tồn tại trong lời gọi hiện tại.
    constructor(
        @Inject(STOREFRONT_IMAGE_EMBEDDING)
        private readonly embedding: StorefrontImageEmbeddingPort,
        @Inject(STOREFRONT_IMAGE_RECOMMENDATION)
        private readonly recommendation: StorefrontImageRecommendationPort,
        @Inject(STOREFRONT_SEARCH_REPOSITORY)
        private readonly searchRepository: StorefrontSearchRepositoryPort,
        private readonly products: StorefrontProductsService,
    ) {}

    // POST validate boundary trước, sau đó embed và lưu candidate IDs để request sau không phải gửi ảnh lại.
    async createSearch(
        rawBody: unknown,
        rawContentType: string | undefined,
        filters: StorefrontImageSearchFilters,
    ): Promise<StorefrontImageSearchResponse<StorefrontProduct>> {
        const startedAt = Date.now();
        const image = this.validateImageUpload(rawBody, rawContentType);
        this.validatePriceRange(filters);
        let searchId: string;
        let imageCandidates: StorefrontImageSearchCandidate[];
        try {
            const embedding = await this.embedding.embedImage(
                image.body,
                image.contentType,
            );
            imageCandidates =
                await this.recommendation.findCandidates(embedding);
            searchId = await this.recommendation.createSession(imageCandidates);
        } catch (error) {
            if (error instanceof BadRequestException) throw error;
            return this.fallbackOrReject(filters, error, startedAt);
        }
        const response = await this.buildResponse(
            searchId,
            imageCandidates,
            filters,
            this.hasText(filters) ? 'IMAGE_AND_TEXT' : 'IMAGE',
        );
        this.logCompletion(response, imageCandidates.length, startedAt);
        return response;
    }

    // GET tái dùng session; hết TTL trả 410 cho image-only hoặc text fallback khi người dùng còn query chữ.
    async getSearch(
        searchId: string,
        filters: StorefrontImageSearchFilters,
    ): Promise<StorefrontImageSearchResponse<StorefrontProduct>> {
        const startedAt = Date.now();
        this.validatePriceRange(filters);
        let imageCandidates: StorefrontImageSearchCandidate[] | null;
        try {
            imageCandidates = await this.recommendation.getSession(searchId);
        } catch (error) {
            return this.fallbackOrReject(filters, error, startedAt);
        }
        if (imageCandidates === null) {
            if (this.hasText(filters)) {
                return this.textFallback(filters, 'session_expired', startedAt);
            }
            throw new GoneException('IMAGE_SEARCH_SESSION_EXPIRED');
        }
        const response = await this.buildResponse(
            searchId,
            imageCandidates,
            filters,
            this.hasText(filters) ? 'IMAGE_AND_TEXT' : 'IMAGE',
        );
        this.logCompletion(response, imageCandidates.length, startedAt);
        return response;
    }

    // Trả raw bytes trong RAM và để AI Service kiểm tra magic bytes, decode, pixel cap và ảnh động.
    private validateImageUpload(
        rawBody: unknown,
        rawContentType: string | undefined,
    ): { body: Buffer; contentType: string } {
        const contentType = (rawContentType ?? '')
            .split(';', 1)[0]
            ?.trim()
            .toLowerCase();
        if (!contentType || !SUPPORTED_IMAGE_TYPES.has(contentType)) {
            throw new BadRequestException('IMAGE_TYPE_UNSUPPORTED');
        }
        if (
            !Buffer.isBuffer(rawBody) ||
            rawBody.length < 1 ||
            rawBody.length > MAX_IMAGE_BYTES
        ) {
            throw new BadRequestException('IMAGE_SIZE_INVALID');
        }
        return { body: rawBody, contentType };
    }

    // Giữ quy tắc storefront và từ chối khoảng giá mâu thuẫn trước khi gọi database hoặc AI.
    private validatePriceRange(filters: StorefrontImageSearchFilters): void {
        if (
            filters.minPrice !== undefined &&
            filters.maxPrice !== undefined &&
            filters.minPrice > filters.maxPrice
        ) {
            throw new BadRequestException('MIN_PRICE_EXCEEDS_MAX_PRICE');
        }
    }

    // Catalog lọc giá, tồn kho, mô tả chữ và ảnh stale trước khi chọn kết quả đủ gần ảnh nhất.
    // Áp ngưỡng tương đối trước phân trang và giữ sort mà người dùng đã chọn.
    private async buildResponse(
        searchId: string,
        imageCandidates: StorefrontImageSearchCandidate[],
        filters: StorefrontImageSearchFilters,
        mode: Exclude<StorefrontImageSearchMode, 'TEXT_FALLBACK'>,
    ): Promise<StorefrontImageSearchResponse<StorefrontProduct>> {
        const eligibleProductIds =
            await this.searchRepository.findImageSearchProductIds(
                this.toRepositoryFilters(filters),
                imageCandidates,
            );
        const matchingProductIds = this.keepSimilarProducts(
            eligibleProductIds,
            imageCandidates,
        );
        const total = matchingProductIds.length;
        const offset = (filters.page - 1) * filters.pageSize;
        const pageIds = matchingProductIds.slice(
            offset,
            offset + filters.pageSize,
        );
        const items = await this.products.getStorefrontProductsByIds(
            pageIds,
            true,
        );
        return {
            searchId,
            mode,
            items,
            total,
            page: filters.page,
            pageSize: filters.pageSize,
            totalPages: Math.ceil(total / filters.pageSize),
        };
    }

    // Chọn mốc từ sản phẩm còn thỏa catalog bằng cosine toàn ảnh, độc lập với thứ tự giá/ngày.
    // Giữ luật cũ nếu session thiếu điểm. Chỉ đối chiếu vùng chi tiết sau khi đã áp ngưỡng toàn ảnh.
    private keepSimilarProducts(
        eligibleProductIds: string[],
        imageCandidates: StorefrontImageSearchCandidate[],
    ): string[] {
        const candidateById = new Map(
            imageCandidates.map((candidate) => [
                candidate.productId,
                candidate,
            ]),
        );
        let reference: StorefrontImageSearchCandidate | undefined;
        for (const id of eligibleProductIds) {
            const candidate = candidateById.get(id);
            if (candidate?.similarityScore === undefined)
                return eligibleProductIds;
            const referenceScore = reference?.similarityScore ?? -1;
            // Hòa điểm lấy rank gốc làm mốc cố định để đổi sort không đổi tập kết quả.
            if (
                candidate.similarityScore > referenceScore ||
                (reference &&
                    candidate.similarityScore === referenceScore &&
                    candidate.rank < reference.rank)
            ) {
                reference = candidate;
            }
        }
        const bestScore = reference?.similarityScore ?? 0;
        const referenceDetails = reference?.detailScores;
        // Giữ cả ứng viên đúng biên 0,05 khi biểu diễn số thực có sai số.
        const minimumScore =
            bestScore - MAX_SIMILARITY_GAP - SIMILARITY_COMPARISON_TOLERANCE;
        return eligibleProductIds.filter((id) => {
            const candidate = candidateById.get(id);
            const candidateScore = candidate?.similarityScore ?? 0;
            if (candidateScore < minimumScore) return false;
            // Mốc chưa đủ tin cậy hoặc thiếu điểm cả hai vùng thì giữ kết quả toàn ảnh.
            if (
                bestScore < MIN_DETAIL_REFERENCE_SIMILARITY ||
                !referenceDetails ||
                !candidate?.detailScores
            ) {
                return true;
            }
            return this.matchesImageDetails(
                referenceDetails,
                candidate.detailScores,
                bestScore - candidateScore,
            );
        });
    }

    // So lực tách của mỗi vùng khi điểm khớp đạt mức đáng tin cậy.
    // Khi hai vùng trái chiều, chỉ loại ứng viên nếu vùng ủng hộ mốc thắng rõ
    // và điểm toàn ảnh cũng xác nhận lợi thế đó sau khi áp bộ lọc catalog.
    private matchesImageDetails(
        reference: [number, number],
        scores: [number, number],
        wholeImageAdvantage: number,
    ): boolean {
        let supportingGap = 0;
        let opposingGap = 0;
        for (const index of [0, 1] as const) {
            const difference = reference[index] - scores[index];
            if (reference[index] >= MIN_DETAIL_VIEW_SIMILARITY) {
                supportingGap = Math.max(supportingGap, difference);
            }
            if (scores[index] >= MIN_DETAIL_VIEW_SIMILARITY) {
                opposingGap = Math.max(opposingGap, -difference);
            }
        }
        // Giữ quy tắc cũ khi không có cặp tín hiệu trái chiều đủ mạnh.
        if (
            supportingGap + SIMILARITY_COMPARISON_TOLERANCE <
            MIN_DETAIL_SEPARATION
        ) {
            return true;
        }
        if (
            opposingGap + SIMILARITY_COMPARISON_TOLERANCE <
            MIN_DETAIL_COUNTER_EVIDENCE
        ) {
            return false;
        }
        // Nếu còn sát nhau ở một trong hai phép so, tránh loại một kết quả có thể phù hợp.
        return (
            wholeImageAdvantage + SIMILARITY_COMPARISON_TOLERANCE <
                MIN_WHOLE_IMAGE_CONFLICT_MARGIN ||
            supportingGap - opposingGap + SIMILARITY_COMPARISON_TOLERANCE <
                MIN_DETAIL_CONFLICT_MARGIN
        );
    }

    // Nếu AI, Qdrant hoặc session store lỗi, chỉ query chữ mới có fallback minh bạch.
    private async fallbackOrReject(
        filters: StorefrontImageSearchFilters,
        error: unknown,
        startedAt: number,
    ): Promise<StorefrontImageSearchResponse<StorefrontProduct>> {
        if (this.hasText(filters)) {
            const errorType =
                error instanceof Error ? error.constructor.name : 'unknown';
            return this.textFallback(filters, errorType, startedAt);
        }
        const errorType =
            error instanceof Error ? error.constructor.name : 'unknown';
        this.logger.warn(
            JSON.stringify({
                event: 'storefront_image_search_unavailable',
                errorType,
                durationMs: Date.now() - startedAt,
            }),
        );
        throw new ServiceUnavailableException(
            'IMAGE_SEARCH_TEMPORARILY_UNAVAILABLE',
        );
    }

    // Dùng endpoint/listing logic hiện hữu và đánh dấu rõ mode để client không coi đây là image match.
    private async textFallback(
        filters: StorefrontImageSearchFilters,
        reason: string,
        startedAt: number,
    ): Promise<StorefrontImageSearchResponse<StorefrontProduct>> {
        this.logger.warn(
            JSON.stringify({
                event: 'storefront_image_search_text_fallback',
                reason,
                durationMs: Date.now() - startedAt,
            }),
        );
        const result = await this.products.listStorefrontProducts({
            search: filters.search,
            categoryId: filters.categoryId,
            sellerShopId: filters.sellerShopId,
            minPrice: filters.minPrice,
            maxPrice: filters.maxPrice,
            minRating: filters.minRating,
            inStock: filters.inStock,
            sort: filters.sort,
            page: filters.page,
            pageSize: filters.pageSize,
        });
        return {
            searchId: null,
            mode: 'TEXT_FALLBACK',
            ...result,
        };
    }

    // Chỉ log mode, số candidate và độ trễ; không log query, ảnh, hash, product ID hoặc session token.
    private logCompletion(
        response: StorefrontImageSearchResponse<StorefrontProduct>,
        candidateCount: number,
        startedAt: number,
    ): void {
        this.logger.log(
            JSON.stringify({
                event: 'storefront_image_search_completed',
                mode: response.mode,
                candidateCount,
                resultCount: response.items.length,
                durationMs: Date.now() - startedAt,
            }),
        );
    }

    // Mô tả chữ thu hẹp ứng viên ảnh trong catalog; nhà cung cấp tìm chữ chỉ được dùng cho fallback.
    private toRepositoryFilters(
        filters: StorefrontImageSearchFilters,
    ): StorefrontSearchFilters {
        return {
            query: filters.search?.trim() || undefined,
            categoryId: filters.categoryId,
            sellerShopId: filters.sellerShopId,
            minPrice: filters.minPrice,
            maxPrice: filters.maxPrice,
            minRating: filters.minRating,
            inStock: filters.inStock,
            sort: filters.sort,
            page: 1,
            pageSize: MAX_IMAGE_CANDIDATES,
        };
    }

    // Trimming xác định query thật sự; chuỗi whitespace không vô tình kích hoạt text fallback.
    private hasText(filters: StorefrontImageSearchFilters): boolean {
        return Boolean(filters.search?.trim());
    }
}
