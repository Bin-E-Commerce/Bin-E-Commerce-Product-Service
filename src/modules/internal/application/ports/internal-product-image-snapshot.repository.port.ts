// Port snapshot ảnh để application chỉ phụ thuộc contract đọc, còn TypeORM nằm trong infrastructure.

import type { InternalProductImageSnapshot } from '@/modules/internal/application/types/internal-product-image-snapshot.type';

export const INTERNAL_PRODUCT_IMAGE_SNAPSHOT_REPOSITORY = Symbol(
    'INTERNAL_PRODUCT_IMAGE_SNAPSHOT_REPOSITORY',
);

export interface InternalProductImageSnapshotRepositoryPort {
    findPage(
        afterProductId: string | undefined,
        limit: number,
    ): Promise<InternalProductImageSnapshot[]>;
    findOne(productId: string): Promise<InternalProductImageSnapshot | null>;
}
