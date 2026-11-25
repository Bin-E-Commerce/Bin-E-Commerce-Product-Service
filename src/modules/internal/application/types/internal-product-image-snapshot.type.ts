// Contract snapshot ảnh nội bộ chỉ mang trạng thái, revision và Media reference; không lộ owner ra API công khai.

import type { RecommendationPrimaryImageMedia } from '@common/kafka/events/recommendation.events';

export interface InternalProductImageSnapshot {
    productId: string;
    status: 'ACTIVE' | 'INACTIVE' | 'DELETED';
    catalogRevision: string;
    images: RecommendationPrimaryImageMedia[];
    primaryImageMedia: RecommendationPrimaryImageMedia | null;
}

export interface InternalProductImageSnapshotPage {
    items: InternalProductImageSnapshot[];
    nextCursor: string | null;
}
