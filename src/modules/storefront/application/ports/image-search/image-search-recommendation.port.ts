// Port Recommendation candidate/session giữ vector search và Redis ngoài use case storefront.
import type {
    StorefrontImageEmbedding,
    StorefrontImageSearchCandidate,
} from '@/modules/storefront/application/types/image-search/image-search.type';

export const STOREFRONT_IMAGE_RECOMMENDATION = Symbol(
    'STOREFRONT_IMAGE_RECOMMENDATION',
);

export interface StorefrontImageRecommendationPort {
    findCandidates(
        embedding: StorefrontImageEmbedding,
    ): Promise<StorefrontImageSearchCandidate[]>;
    createSession(
        candidates: StorefrontImageSearchCandidate[],
    ): Promise<string>;
    getSession(
        searchId: string,
    ): Promise<StorefrontImageSearchCandidate[] | null>;
}
