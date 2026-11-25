// Port AI image embedding để use case không phụ thuộc HTTP client hoặc model provider.
import type { StorefrontImageEmbedding } from '@/modules/storefront/application/types/image-search/image-search.type';

export const STOREFRONT_IMAGE_EMBEDDING = Symbol('STOREFRONT_IMAGE_EMBEDDING');

export interface StorefrontImageEmbeddingPort {
    embedImage(
        body: Buffer,
        contentType: string,
    ): Promise<StorefrontImageEmbedding>;
}
