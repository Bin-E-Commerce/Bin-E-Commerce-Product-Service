// Adapter PostgreSQL sở hữu lọc, fuzzy match và xếp hạng search; không làm enrichment qua service khác.
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import { Product } from '@/database/catalog/entities/product.entity';
import { ProductImage } from '@/database/catalog/entities/product-image.entity';
import { ProductVariant } from '@/database/catalog/entities/product-variant.entity';
import { ProductStatus } from '@/database/catalog/enums/product-status.enum';
import { ProductVariantStatus } from '@/database/catalog/enums/product-variant-status.enum';
import { isUUID } from 'class-validator';
import { IMAGE_SEARCH_MAX_PRODUCT_IMAGES } from '@common/kafka/events/recommendation.events';
import type {
    EligibleSemanticSearchCandidates,
    StorefrontSearchFilters,
    StorefrontSearchPage,
    StorefrontSearchRepositoryPort,
    StorefrontSearchSort,
} from '@/modules/storefront/application/ports/storefront-search.repository.port';
import type { ProductSearchSuggestion } from '@/modules/storefront/application/types/text-search/product-search-suggestion.type';
import type { StorefrontSearchRerankProduct } from '@/modules/storefront/application/types/text-search/storefront-search-rerank-product.type';
import type { StorefrontImageSearchCandidate } from '@/modules/storefront/application/types/image-search/image-search.type';
import { normalizeStorefrontSearchTerm } from '@/modules/storefront/application/utils/storefront-search.utils';

// Adapter chỉ truy vấn sản phẩm ACTIVE; mọi match đầu vào được bind làm parameter.
@Injectable()
export class TypeOrmStorefrontSearchRepository
    implements StorefrontSearchRepositoryPort
{
    constructor(
        @InjectRepository(Product)
        private readonly productRepository: Repository<Product>,
    ) {}

    // Lọc catalog, đếm tổng trước phân trang và trả IDs theo relevance hoặc sort người dùng chọn.
    async findStorefrontProductPage(
        filters: StorefrontSearchFilters,
    ): Promise<StorefrontSearchPage> {
        const hasSearchQuery = Boolean(filters.query?.trim());
        const searchTerm = filters.query
            ? normalizeStorefrontSearchTerm(filters.query)
            : null;
        if (hasSearchQuery && !searchTerm) return { ids: [], total: 0 };

        const query = this.createFilteredProductQuery(filters);

        if (searchTerm) this.applySearchConditions(query, searchTerm);
        if (filters.excludeProductIds?.length) {
            query.andWhere('product.id NOT IN (:...excludedProductIds)', {
                excludedProductIds: filters.excludeProductIds,
            });
        }

        const idQuery = query.clone().select('product.id', 'id');
        if (searchTerm && (!filters.sort || filters.sort === 'relevance')) {
            this.addSearchRank(idQuery, searchTerm);
            idQuery
                .orderBy('search_rank', 'DESC')
                .addOrderBy('product.totalSold', 'DESC')
                .addOrderBy('product.createdAt', 'DESC');
        } else if (!filters.sort || filters.sort === 'relevance') {
            idQuery.orderBy('product.createdAt', 'DESC');
        } else {
            this.applyExplicitSort(idQuery, filters.sort);
        }

        const [total, idRows] = await Promise.all([
            query.clone().getCount(),
            idQuery
                .addOrderBy('product.id', 'ASC')
                .offset((filters.page - 1) * filters.pageSize)
                .limit(filters.pageSize)
                .getRawMany<{ id: string }>(),
        ]);

        return { ids: idRows.map((row) => row.id), total };
    }

    // Xác minh Qdrant IDs theo DB thật, tránh stale/deleted item hoặc semantic source vượt bộ lọc storefront.
    async findEligibleSemanticCandidates(
        filters: StorefrontSearchFilters,
        candidateIds: string[],
    ): Promise<EligibleSemanticSearchCandidates> {
        const uniqueIds = Array.from(
            new Set(candidateIds.filter((candidateId) => isUUID(candidateId))),
        ).slice(0, 60);
        if (!uniqueIds.length) return { ids: [], lexicalMatchCount: 0 };

        const eligibleQuery = this.createFilteredProductQuery(filters).andWhere(
            'product.id IN (:...semanticCandidateIds)',
            { semanticCandidateIds: uniqueIds },
        );
        const rows = await eligibleQuery
            .clone()
            .select('product.id', 'id')
            .getRawMany<{ id: string }>();
        const eligibleSet = new Set(rows.map((row) => row.id));
        const searchTerm = filters.query
            ? normalizeStorefrontSearchTerm(filters.query)
            : null;
        let lexicalMatchCount = 0;
        if (searchTerm) {
            const lexicalOverlapQuery = eligibleQuery.clone();
            this.applySearchConditions(lexicalOverlapQuery, searchTerm);
            lexicalMatchCount = await lexicalOverlapQuery.getCount();
        }

        // Giữ thứ tự Qdrant ổn định; cross-encoder nhận vị trí semantic gốc làm tie-break retrieval phía application.
        return {
            ids: uniqueIds.filter((id) => eligibleSet.has(id)),
            lexicalMatchCount,
        };
    }

    // Chỉ đọc các trường rerank cần thiết; IDs được validate và giới hạn để không hydrate cả catalog.
    async findSearchRerankingCandidates(
        candidateIds: string[],
        activeOnly: boolean,
        searchText: string,
    ): Promise<StorefrontSearchRerankProduct[]> {
        const uniqueIds = Array.from(
            new Set(candidateIds.filter((candidateId) => isUUID(candidateId))),
        ).slice(0, 100);
        if (uniqueIds.length === 0) return [];

        const products = await this.productRepository.find({
            where: {
                id: In(uniqueIds),
                ...(activeOnly ? { status: ProductStatus.ACTIVE } : {}),
            },
            select: {
                id: true,
                name: true,
                slug: true,
                sellerSku: true,
                gtin: true,
                metadata: true,
                shortDescription: true,
                description: true,
                brand: {
                    name: true,
                    normalizedName: true,
                },
            },
            relations: { brand: true },
        });
        // Giữ match chính xác của tên/mã variant khỏi bị model đẩy xuống vì variant không nằm trong văn bản title gửi sang AI.
        // Chỉ xét variant ACTIVE thuộc candidate pool đã giới hạn để không đưa SKU ngừng bán vào ưu tiên.
        const variantMatches = await this.productRepository.manager
            .createQueryBuilder(ProductVariant, 'variant')
            .select('variant.productId', 'productId')
            .addSelect(
                'BOOL_OR(LOWER(variant.name) = LOWER(:searchExact))',
                'exactVariantNameMatch',
            )
            .addSelect(
                `BOOL_OR(
                    LOWER(variant.sku) = LOWER(:searchExact)
                    OR LOWER(variant.sellerSku) = LOWER(:searchExact)
                    OR LOWER(variant.gtin) = LOWER(:searchExact)
                )`,
                'exactVariantCodeMatch',
            )
            .where('variant.productId IN (:...candidateIds)', {
                candidateIds: uniqueIds,
            })
            .andWhere('variant.status = :activeVariantStatus', {
                activeVariantStatus: ProductVariantStatus.ACTIVE,
            })
            .andWhere(
                new Brackets((builder) => {
                    builder
                        .where('LOWER(variant.name) = LOWER(:searchExact)')
                        .orWhere('LOWER(variant.sku) = LOWER(:searchExact)')
                        .orWhere(
                            'LOWER(variant.sellerSku) = LOWER(:searchExact)',
                        )
                        .orWhere('LOWER(variant.gtin) = LOWER(:searchExact)');
                }),
                { searchExact: searchText },
            )
            .groupBy('variant.productId')
            .getRawMany<{
                productId: string;
                exactVariantNameMatch: boolean;
                exactVariantCodeMatch: boolean;
            }>();
        const variantMatchByProductId = new Map(
            variantMatches.map((match) => [match.productId, match]),
        );

        return products.map((product) => ({
            id: product.id,
            name: product.name,
            slug: product.slug,
            sellerSku: product.sellerSku,
            gtin: product.gtin,
            brand: product.brand
                ? {
                      name: product.brand.name,
                      normalizedName: product.brand.normalizedName,
                  }
                : null,
            metadata: product.metadata,
            shortDescription: product.shortDescription,
            description: product.description,
            exactVariantNameMatch:
                variantMatchByProductId.get(product.id)
                    ?.exactVariantNameMatch ?? false,
            exactVariantCodeMatch:
                variantMatchByProductId.get(product.id)
                    ?.exactVariantCodeMatch ?? false,
        }));
    }

    // Chỉ xét ID do tìm ảnh trả về. Mô tả chữ là điều kiện thu hẹp trên cùng sản phẩm.
    // Dùng bộ lọc storefront từ PostgreSQL rồi xác minh fingerprint gallery trước khi xếp hạng.
    async findImageSearchProductIds(
        filters: StorefrontSearchFilters,
        imageCandidates: StorefrontImageSearchCandidate[],
    ): Promise<string[]> {
        const candidateById = new Map(
            imageCandidates
                .filter((candidate) => isUUID(candidate.productId))
                .slice(0, 500)
                .map((candidate) => [candidate.productId, candidate]),
        );
        if (candidateById.size === 0) return [];

        const rawQuery = filters.query?.trim();
        const searchTerm = rawQuery
            ? normalizeStorefrontSearchTerm(rawQuery)
            : null;
        // Chuỗi không có từ hợp lệ không được âm thầm biến thành tìm ảnh không điều kiện chữ.
        if (rawQuery && !searchTerm) return [];

        const query = this.createFilteredProductQuery(filters)
            .leftJoinAndSelect('product.images', 'image')
            .select([
                'product.id',
                'product.sellerOwnerId',
                'image.id',
                'image.sortOrder',
                'image.aiAssetId',
                'image.sourceAssetId',
            ])
            .andWhere('product.id IN (:...imageSearchProductIds)', {
                imageSearchProductIds: [...candidateById.keys()],
            });
        // Dùng bằng chứng chữ trong tên, danh mục và các trường catalog; fuzzy có thể đưa nhầm loại vào bộ ảnh.
        if (searchTerm) this.applySearchConditions(query, searchTerm, false);
        this.applyImageSearchSort(query, filters.sort);

        const products = await query.getMany();
        const currentIds = products
            .filter((product) =>
                this.matchesCurrentImageGallery(
                    product,
                    candidateById.get(product.id),
                ),
            )
            .map((product) => product.id);
        if (filters.sort && filters.sort !== 'relevance') return currentIds;

        // Query DB có thể trả ID theo thứ tự khác; relevance luôn theo rank ảnh đã lưu trong session.
        const currentIdSet = new Set(currentIds);
        return [...candidateById.keys()].filter((id) => currentIdSet.has(id));
    }

    // Lấy autocomplete nhẹ với thumbnail duy nhất; không hydrate reviews hoặc truy vấn Order Service.
    async getProductSearchSuggestions(
        rawQuery: string,
    ): Promise<ProductSearchSuggestion[]> {
        const searchTerm = normalizeStorefrontSearchTerm(rawQuery);
        if (!searchTerm) return [];

        const query = this.productRepository
            .createQueryBuilder('product')
            .leftJoin('product.brand', 'brand')
            .where('product.status = :activeStatus', {
                activeStatus: ProductStatus.ACTIVE,
            });
        this.applySearchConditions(query, searchTerm);

        // Thumbnail lấy bằng scalar subquery để ảnh 1-n không nhân bản suggestion hay phá giới hạn sáu kết quả.
        query
            .select('product.id', 'id')
            .addSelect('product.name', 'name')
            .addSelect('product.slug', 'slug')
            .addSelect('product.minPrice', 'minPrice')
            .addSelect('product.maxPrice', 'maxPrice')
            .addSelect('brand.name', 'brandName')
            .addSelect(
                (subQuery) =>
                    subQuery
                        .select('searchImage.imageUrl')
                        .from(ProductImage, 'searchImage')
                        .where('searchImage.productId = product.id')
                        .andWhere('searchImage.isThumbnail = TRUE')
                        .orderBy('searchImage.sortOrder', 'ASC')
                        .addOrderBy('searchImage.id', 'ASC')
                        .limit(1),
                'imageUrl',
            );
        this.addSearchRank(query, searchTerm);

        const rows = await query
            .orderBy('search_rank', 'DESC')
            .addOrderBy('product.totalSold', 'DESC')
            .addOrderBy('product.id', 'ASC')
            .limit(6)
            .getRawMany<
                ProductSearchSuggestion & { search_rank: number | string }
            >();

        // Không lộ điểm xếp hạng nội bộ trong response công khai của autocomplete.
        return rows.map(
            ({ id, name, slug, minPrice, maxPrice, brandName, imageUrl }) => ({
                id,
                name,
                slug,
                minPrice,
                maxPrice,
                brandName,
                imageUrl,
            }),
        );
    }

    // Tìm theo tên/mô tả/brand/variant/mã chính xác và thêm match slug chuẩn hóa cho truy vấn tiếng Việt không dấu.
    // Query luôn là parameter; pattern LIKE escape wildcard nhưng mã SKU/GTIN vẫn giữ nguyên ký tự gốc để exact match.
    // Fuzzy trigram chỉ chạy từ bốn ký tự, tránh các từ ngắn tạo nhiều ứng viên không liên quan.
    private applySearchConditions(
        query: SelectQueryBuilder<Product>,
        searchTerm: NonNullable<
            ReturnType<typeof normalizeStorefrontSearchTerm>
        >,
        allowFuzzy = true,
    ): void {
        const normalizedValue = searchTerm.normalizedTerm || 'emptysearchterm';
        const normalizedLikeValue =
            searchTerm.normalizedLikeTerm || 'emptysearchterm';
        const slugValue = searchTerm.slugTerm || 'emptysearchslug';
        const tokenMatchSql = this.buildTokenSearchPredicate(
            query,
            searchTerm,
            'all',
        );

        query.setParameters({
            searchRawTerm: searchTerm.rawTerm,
            searchNormalizedTerm: normalizedValue,
            searchSlugTerm: slugValue,
            searchNamePattern: `%${searchTerm.likeTerm}%`,
            searchNormalizedPattern: `%${normalizedLikeValue}%`,
            searchSlugPattern: `%${slugValue}%`,
            searchNamePrefix: `${searchTerm.likeTerm}%`,
            searchSlugPrefix: `${slugValue}%`,
            searchNormalizedPrefix: `${normalizedLikeValue}%`,
            searchLowerNamePrefix: `${searchTerm.likeTerm.toLowerCase()}%`,
            searchLowerSlugPrefix: `${slugValue.toLowerCase()}%`,
            searchLowerNormalizedPrefix: `${normalizedLikeValue.toLowerCase()}%`,
        });
        query.andWhere(
            new Brackets((builder) => {
                // Từ khóa dưới ba ký tự không tạo trigram hữu ích; chỉ dò tiền tố và mã chính xác để tránh quét rộng.
                if (searchTerm.rawTerm.length < 3) {
                    builder
                        .where(
                            'LOWER(product.name) LIKE :searchLowerNamePrefix',
                        )
                        .orWhere(
                            'LOWER(product.slug) LIKE :searchLowerSlugPrefix',
                        )
                        .orWhere(
                            'LOWER(product.sellerSku) = LOWER(:searchRawTerm)',
                        )
                        .orWhere('LOWER(product.gtin) = LOWER(:searchRawTerm)')
                        .orWhere(
                            `LOWER(COALESCE(product.metadata ->> 'categoryName', '')) LIKE :searchLowerNamePrefix`,
                        )
                        .orWhere(
                            `LOWER(COALESCE(product.metadata ->> 'categoryPath', '')) LIKE :searchLowerNamePrefix`,
                        )
                        .orWhere(
                            `EXISTS (
                                SELECT 1 FROM brands short_brand
                                WHERE short_brand.id = product.brand_id
                                  AND (
                                    LOWER(short_brand.name) LIKE :searchLowerNamePrefix
                                    OR LOWER(COALESCE(short_brand.normalized_name, '')) LIKE :searchLowerNormalizedPrefix
                                  )
                            )`,
                        )
                        .orWhere(
                            `EXISTS (
                                SELECT 1 FROM product_variants short_variant
                                WHERE short_variant.product_id = product.id
                                  AND short_variant.status = :activeVariantStatus
                                  AND (
                                    LOWER(short_variant.name) LIKE :searchLowerNamePrefix
                                    OR LOWER(short_variant.sku) = LOWER(:searchRawTerm)
                                    OR LOWER(short_variant.seller_sku) = LOWER(:searchRawTerm)
                                    OR LOWER(short_variant.gtin) = LOWER(:searchRawTerm)
                                  )
                            )`,
                        );
                    return;
                }

                builder
                    .where('product.name ILIKE :searchNamePattern')
                    .orWhere('product.slug ILIKE :searchSlugPattern')
                    .orWhere(
                        'product.shortDescription ILIKE :searchNamePattern',
                    )
                    .orWhere(
                        `COALESCE(product.metadata ->> 'categoryName', '') ILIKE :searchNamePattern`,
                    )
                    .orWhere(
                        `COALESCE(product.metadata ->> 'categoryPath', '') ILIKE :searchNamePattern`,
                    )
                    .orWhere('LOWER(product.sellerSku) = LOWER(:searchRawTerm)')
                    .orWhere('LOWER(product.gtin) = LOWER(:searchRawTerm)')
                    .orWhere(
                        `EXISTS (
                            SELECT 1 FROM brands search_brand
                            WHERE search_brand.id = product.brand_id
                              AND (
                                search_brand.name ILIKE :searchNamePattern
                                OR COALESCE(search_brand.normalized_name, '') ILIKE :searchNormalizedPattern
                                OR search_brand.aliases::text ILIKE :searchNamePattern
                            )
                        )`,
                    )
                    .orWhere(
                        `EXISTS (
                            SELECT 1 FROM product_variants search_variant
                            WHERE search_variant.product_id = product.id
                              AND search_variant.status = :activeVariantStatus
                              AND (
                                search_variant.name ILIKE :searchNamePattern
                                OR LOWER(search_variant.sku) = LOWER(:searchRawTerm)
                                OR LOWER(search_variant.seller_sku) = LOWER(:searchRawTerm)
                                OR LOWER(search_variant.gtin) = LOWER(:searchRawTerm)
                            )
                        )`,
                    );

                if (searchTerm.slugTerm) {
                    // Slug và brand đã chuẩn hóa xử lý truy vấn bỏ dấu khi display name vẫn giữ dấu tiếng Việt.
                    builder.orWhere(
                        `EXISTS (
                            SELECT 1 FROM brands normalized_brand
                            WHERE normalized_brand.id = product.brand_id
                              AND COALESCE(normalized_brand.normalized_name, '') ILIKE :searchNormalizedPattern
                        )`,
                    );
                }

                // AND theo token mở rộng truy vấn nhiều từ nhưng mỗi token vẫn phải khớp một trường cùng sản phẩm.
                if (tokenMatchSql) builder.orWhere(tokenMatchSql);

                // Tìm chữ thường vẫn dùng trigram; mô tả ảnh chỉ thu hẹp bằng match có bằng chứng trực tiếp.
                if (allowFuzzy && searchTerm.normalizedTerm.length >= 4) {
                    builder
                        .orWhere('product.name % :searchRawTerm')
                        .orWhere('product.slug % :searchSlugTerm')
                        .orWhere('product.shortDescription % :searchRawTerm')
                        .orWhere(
                            `COALESCE(product.metadata ->> 'categoryName', '') % :searchRawTerm`,
                        )
                        .orWhere(
                            `COALESCE(product.metadata ->> 'categoryPath', '') % :searchRawTerm`,
                        )
                        .orWhere(
                            `EXISTS (
                                SELECT 1 FROM brands fuzzy_brand
                                WHERE fuzzy_brand.id = product.brand_id
                                  AND (
                                    fuzzy_brand.name % :searchRawTerm
                                    OR COALESCE(fuzzy_brand.normalized_name, '') % :searchNormalizedTerm
                                    OR fuzzy_brand.aliases::text % :searchRawTerm
                                )
                            )`,
                        )
                        .orWhere(
                            `EXISTS (
                                SELECT 1 FROM product_variants fuzzy_variant
                                WHERE fuzzy_variant.product_id = product.id
                                  AND fuzzy_variant.status = :activeVariantStatus
                                  AND fuzzy_variant.name % :searchRawTerm
                            )`,
                        );
                }
            }),
        );
        query.setParameter('activeVariantStatus', ProductVariantStatus.ACTIVE);
    }

    // Dựng điều kiện token có giới hạn để nhận truy vấn đảo thứ tự mà không tạo SQL không bị chặn.
    // Nhánh chỉ chạy từ hai đến tám token và cần ít nhất một token đủ dài để trigram index thu hẹp tập đọc.
    // Mỗi token phải xuất hiện trong title/slug hoặc một trường catalog liên quan; token không được ghép từ sản phẩm khác.
    private buildTokenSearchPredicate(
        query: SelectQueryBuilder<Product>,
        searchTerm: NonNullable<
            ReturnType<typeof normalizeStorefrontSearchTerm>
        >,
        scope: 'title' | 'all',
    ): string | null {
        const tokens = searchTerm.tokens;
        if (
            tokens.length < 2 ||
            tokens.length > 8 ||
            !tokens.some((token) => token.normalizedTerm.length >= 3)
        ) {
            return null;
        }

        const parameters: Record<string, string> = {};
        const tokenPredicates = tokens.map((token, index) => {
            const rawParameter = `searchTokenRaw${index}`;
            const normalizedParameter = `searchTokenNormalized${index}`;
            // Escape wildcard và bind token để người dùng không mở rộng LIKE hoặc làm thay đổi cấu trúc SQL.
            const rawPattern = token.rawTerm.replace(/[\\%_]/g, '\\$&');
            const normalizedPattern = token.normalizedTerm.replace(
                /[\\%_]/g,
                '\\$&',
            );
            parameters[rawParameter] = `%${rawPattern}%`;
            parameters[normalizedParameter] = `%${normalizedPattern}%`;

            const titleAndSlugMatch = `product.name ILIKE :${rawParameter}
                OR product.slug ILIKE :${normalizedParameter}`;
            if (scope === 'title') return `(${titleAndSlugMatch})`;

            return `(
                ${titleAndSlugMatch}
                OR product.shortDescription ILIKE :${rawParameter}
                OR COALESCE(product.metadata ->> 'categoryName', '') ILIKE :${rawParameter}
                OR COALESCE(product.metadata ->> 'categoryPath', '') ILIKE :${rawParameter}
                OR EXISTS (
                    SELECT 1 FROM brands token_brand
                    WHERE token_brand.id = product.brand_id
                      AND (
                        token_brand.name ILIKE :${rawParameter}
                        OR COALESCE(token_brand.normalized_name, '') ILIKE :${normalizedParameter}
                        OR token_brand.aliases::text ILIKE :${rawParameter}
                    )
                )
                OR EXISTS (
                    SELECT 1 FROM product_variants token_variant
                    WHERE token_variant.product_id = product.id
                      AND token_variant.status = '${ProductVariantStatus.ACTIVE}'
                      AND token_variant.name ILIKE :${rawParameter}
                )
            )`;
        });

        // Gộp parameter một lần để không lặp thao tác merge khi truy vấn có nhiều token.
        query.setParameters(parameters);
        return `(${tokenPredicates.join(' AND ')})`;
    }

    // Chung hard filters cho lexical/semantic source để một source không thể lách category, shop, giá hoặc tồn kho.
    private createFilteredProductQuery(
        filters: StorefrontSearchFilters,
    ): SelectQueryBuilder<Product> {
        const query = this.productRepository
            .createQueryBuilder('product')
            .where('product.status = :activeStatus', {
                activeStatus: ProductStatus.ACTIVE,
            });
        if (filters.categoryId) {
            query.andWhere('product.categoryId = :categoryId', {
                categoryId: filters.categoryId,
            });
        }
        if (filters.sellerShopId) {
            query.andWhere('product.sellerShopId = :sellerShopId', {
                sellerShopId: filters.sellerShopId,
            });
        }
        if (filters.minPrice !== undefined) {
            query.andWhere('product.maxPrice >= :minPrice', {
                minPrice: filters.minPrice,
            });
        }
        if (filters.maxPrice !== undefined) {
            query.andWhere('product.minPrice <= :maxPrice', {
                maxPrice: filters.maxPrice,
            });
        }
        if (filters.minRating !== undefined) {
            query.andWhere('COALESCE(product.ratingAvg, 0) >= :minRating', {
                minRating: filters.minRating,
            });
        }
        if (filters.inStock) {
            // Chỉ lượng bán được mới thỏa filter; stock_quantity gồm cả hàng đã reserved.
            query.andWhere(
                `EXISTS (
                    SELECT 1
                    FROM product_variants stock_variant
                    INNER JOIN inventories stock_inventory
                        ON stock_inventory.variant_id = stock_variant.id
                    WHERE stock_variant.product_id = product.id
                      AND stock_variant.status = :activeVariantStatus
                      AND stock_inventory.quantity_available > 0
                )`,
                { activeVariantStatus: ProductVariantStatus.ACTIVE },
            );
        }
        return query;
    }

    // Fingerprint gallery xác nhận vector còn đại diện cho ảnh hiện tại.
    // Revision catalog cũng đổi khi giá hoặc tồn kho cập nhật, nên phiên cũ vẫn dùng được nếu gallery khớp.
    // Trạng thái ACTIVE, giá và số lượng bán được đã được truy vấn lại từ PostgreSQL trước bước này.
    private matchesCurrentImageGallery(
        product: Product,
        candidate: StorefrontImageSearchCandidate | undefined,
    ): boolean {
        if (!candidate || !product.sellerOwnerId) {
            return false;
        }
        const orderedImages = [...(product.images ?? [])].sort(
            (left, right) =>
                left.sortOrder - right.sortOrder ||
                left.id.localeCompare(right.id),
        );
        const seenAssetIds = new Set<string>();
        const references: string[] = [];
        for (const image of orderedImages) {
            // Dùng cùng quy tắc với snapshot index: AI asset ưu tiên, loại trùng rồi mới áp giới hạn năm ảnh.
            const assetId =
                image.aiAssetId?.trim() || image.sourceAssetId?.trim();
            if (!assetId || seenAssetIds.has(assetId)) continue;
            seenAssetIds.add(assetId);
            references.push(`${product.sellerOwnerId}:${assetId}`);
            if (references.length >= IMAGE_SEARCH_MAX_PRODUCT_IMAGES) break;
        }
        if (references.length === 0) return false;
        const fingerprint = createHash('sha256')
            .update(JSON.stringify(references))
            .digest('hex');
        return fingerprint === candidate.imageFingerprint;
    }

    // Sort chỉ dùng cột cố định từ enum storefront; relevance giữ thứ tự ảnh do Recommendation đưa vào.
    private applyImageSearchSort(
        query: SelectQueryBuilder<Product>,
        sort?: StorefrontSearchSort,
    ): void {
        switch (sort) {
            case 'price_asc':
                query.orderBy('product.minPrice', 'ASC');
                break;
            case 'price_desc':
                query.orderBy('product.minPrice', 'DESC');
                break;
            case 'rating_desc':
                query.orderBy('COALESCE(product.ratingAvg, 0)', 'DESC');
                break;
            case 'sold_desc':
                query.orderBy('product.totalSold', 'DESC');
                break;
            case 'newest':
                query.orderBy('product.createdAt', 'DESC');
                break;
            default:
                return;
        }
        query.addOrderBy('product.id', 'ASC');
    }

    // Ưu tiên mã/tên khớp chính xác, tiền tố, brand, variant rồi mới đến mô tả và fuzzy match.
    // Lượt bán chỉ phá hòa sau relevance để không đẩy sản phẩm bán chạy nhưng không liên quan lên đầu.
    private addSearchRank(
        query: SelectQueryBuilder<Product>,
        searchTerm: NonNullable<
            ReturnType<typeof normalizeStorefrontSearchTerm>
        >,
    ): void {
        const normalizedValue = searchTerm.normalizedTerm || 'emptysearchterm';
        const normalizedLikeValue =
            searchTerm.normalizedLikeTerm || 'emptysearchterm';
        const slugValue = searchTerm.slugTerm || 'emptysearchslug';
        const titleTokenMatchSql = this.buildTokenSearchPredicate(
            query,
            searchTerm,
            'title',
        );
        const tokenMatchSql = this.buildTokenSearchPredicate(
            query,
            searchTerm,
            'all',
        );

        query.setParameters({
            searchRawTerm: searchTerm.rawTerm,
            searchNormalizedTerm: normalizedValue,
            searchSlugTerm: slugValue,
            searchNamePattern: `%${searchTerm.likeTerm}%`,
            searchNormalizedPattern: `%${normalizedLikeValue}%`,
            searchSlugPattern: `%${slugValue}%`,
            searchNamePrefix: `${searchTerm.likeTerm}%`,
            searchSlugPrefix: `${slugValue}%`,
            searchNormalizedPrefix: `${normalizedLikeValue}%`,
        });
        // 740 nằm ngay dưới match cụm tên 750; match đủ token rải giữa các trường nhận 560, dưới match cụm riêng.
        // Alias snake_case để tên dùng trong SELECT và ORDER BY không bị PostgreSQL gập chữ hoa.
        query.addSelect(
            `CASE
                WHEN LOWER(product.name) = LOWER(:searchRawTerm) THEN 1000
                WHEN LOWER(product.sellerSku) = LOWER(:searchRawTerm)
                  OR LOWER(product.gtin) = LOWER(:searchRawTerm)
                  OR EXISTS (
                    SELECT 1 FROM product_variants ranked_variant
                    WHERE ranked_variant.product_id = product.id
                      AND ranked_variant.status = '${ProductVariantStatus.ACTIVE}'
                      AND (
                        LOWER(ranked_variant.sku) = LOWER(:searchRawTerm)
                        OR LOWER(ranked_variant.seller_sku) = LOWER(:searchRawTerm)
                        OR LOWER(ranked_variant.gtin) = LOWER(:searchRawTerm)
                      )
                  ) THEN 950
                WHEN product.name ILIKE :searchNamePrefix THEN 900
                WHEN EXISTS (
                    SELECT 1 FROM brands ranked_brand
                    WHERE ranked_brand.id = product.brand_id
                      AND (
                        LOWER(ranked_brand.name) = LOWER(:searchRawTerm)
                        OR LOWER(COALESCE(ranked_brand.normalized_name, '')) = LOWER(:searchNormalizedTerm)
                      )
                ) THEN 850
                WHEN product.slug ILIKE :searchSlugPrefix THEN 800
                WHEN product.name ILIKE :searchNamePattern THEN 750
                ${titleTokenMatchSql ? `WHEN ${titleTokenMatchSql} THEN 740` : ''}
                WHEN EXISTS (
                    SELECT 1 FROM brands ranked_brand
                    WHERE ranked_brand.id = product.brand_id
                      AND (
                        ranked_brand.name ILIKE :searchNamePattern
                        OR COALESCE(ranked_brand.normalized_name, '') ILIKE :searchNormalizedPattern
                        OR ranked_brand.aliases::text ILIKE :searchNamePattern
                      )
                ) THEN 700
                WHEN EXISTS (
                    SELECT 1 FROM product_variants ranked_variant
                    WHERE ranked_variant.product_id = product.id
                      AND ranked_variant.status = '${ProductVariantStatus.ACTIVE}'
                      AND ranked_variant.name ILIKE :searchNamePattern
                ) THEN 650
                WHEN COALESCE(product.metadata ->> 'categoryName', '') ILIKE :searchNamePattern THEN 625
                WHEN product.shortDescription ILIKE :searchNamePattern THEN 600
                WHEN COALESCE(product.metadata ->> 'categoryPath', '') ILIKE :searchNamePattern THEN 575
                ${tokenMatchSql ? `WHEN ${tokenMatchSql} THEN 560` : ''}
                ELSE GREATEST(
                    similarity(product.name, :searchRawTerm),
                    similarity(product.slug, :searchSlugTerm),
                    COALESCE(similarity(product.short_description, :searchRawTerm), 0),
                    COALESCE(similarity(product.metadata ->> 'categoryName', :searchRawTerm), 0),
                    COALESCE(similarity(product.metadata ->> 'categoryPath', :searchRawTerm), 0),
                    COALESCE((
                        SELECT MAX(GREATEST(
                            similarity(rank_brand.name, :searchRawTerm),
                            similarity(COALESCE(rank_brand.normalized_name, ''), :searchNormalizedTerm),
                            similarity(rank_brand.aliases::text, :searchRawTerm)
                        ))
                        FROM brands rank_brand
                        WHERE rank_brand.id = product.brand_id
                    ), 0),
                    COALESCE((
                        SELECT MAX(similarity(rank_variant.name, :searchRawTerm))
                        FROM product_variants rank_variant
                        WHERE rank_variant.product_id = product.id
                          AND rank_variant.status = '${ProductVariantStatus.ACTIVE}'
                    ), 0)
                ) * 100
            END`,
            'search_rank',
        );
    }

    // Ánh xạ sort từ enum transport sang cột cố định; không ghép tên cột do request gửi vào SQL.
    private applyExplicitSort(
        query: SelectQueryBuilder<Product>,
        sort: Exclude<StorefrontSearchSort, 'relevance'>,
    ): void {
        switch (sort) {
            case 'price_asc':
                query.orderBy('product.minPrice', 'ASC');
                return;
            case 'price_desc':
                query.orderBy('product.minPrice', 'DESC');
                return;
            case 'rating_desc':
                query.orderBy('COALESCE(product.ratingAvg, 0)', 'DESC');
                return;
            case 'sold_desc':
                query.orderBy('product.totalSold', 'DESC');
                return;
            default:
                query.orderBy('product.createdAt', 'DESC');
        }
    }
}
