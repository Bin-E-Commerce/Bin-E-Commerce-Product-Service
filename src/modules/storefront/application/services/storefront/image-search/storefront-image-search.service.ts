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
            return this.failUnavailable(error, startedAt);
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

    // GET tái dùng session và trả 410 khi phiên hết TTL để khách có thể tải lại ảnh.
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
            return this.failUnavailable(error, startedAt);
        }
        if (imageCandidates === null) {
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

    // Áp bộ lọc catalog và thứ tự của khách trước khi phân trang ứng viên ảnh.
    private async buildResponse(
        searchId: string,
        imageCandidates: StorefrontImageSearchCandidate[],
        filters: StorefrontImageSearchFilters,
        mode: Exclude<StorefrontImageSearchMode, 'TEXT_FALLBACK'>,
    ): Promise<StorefrontImageSearchResponse<StorefrontProduct>> {
        const matchingProductIds =
            await this.searchRepository.findImageSearchProductIds(
                this.toRepositoryFilters(filters),
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

    // Ánh xạ lỗi AI, Qdrant hoặc session store thành 503; chỉ log tên lỗi và độ trễ.
    private failUnavailable(
        error: unknown,
        startedAt: number,
    ): never {
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

    // Mô tả chữ thu hẹp tập ứng viên ảnh trong catalog.
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

    // Xác định chế độ kết hợp bằng mô tả chữ đã loại khoảng trắng.
    private hasText(filters: StorefrontImageSearchFilters): boolean {
        return Boolean(filters.search?.trim());
    }
}
