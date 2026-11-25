// Application service giới hạn page và điều phối snapshot; cursor luôn là product cuối đã trả thay vì offset dễ trượt.

import { Inject, Injectable } from '@nestjs/common';
import { INTERNAL_PRODUCT_IMAGE_SNAPSHOT_REPOSITORY } from '@/modules/internal/application/ports/internal-product-image-snapshot.repository.port';
import type { InternalProductImageSnapshotRepositoryPort } from '@/modules/internal/application/ports/internal-product-image-snapshot.repository.port';
import type { InternalProductImageSnapshotPage } from '@/modules/internal/application/types/internal-product-image-snapshot.type';
import type { InternalProductImageSnapshot } from '@/modules/internal/application/types/internal-product-image-snapshot.type';

const MAX_IMAGE_SNAPSHOT_PAGE_SIZE = 25;

@Injectable()
export class InternalProductImageSnapshotService {
    // Service chỉ điều phối snapshot; mọi where/order/take/join do repository adapter sở hữu.
    constructor(
        @Inject(INTERNAL_PRODUCT_IMAGE_SNAPSHOT_REPOSITORY)
        private readonly repository: InternalProductImageSnapshotRepositoryPort,
    ) {}

    // Đọc một trang nhỏ và chỉ phát nextCursor khi repository chứng minh còn item phía sau.
    async list(
        afterProductId: string | undefined,
        limit: number,
    ): Promise<InternalProductImageSnapshotPage> {
        const pageSize = Math.min(
            Math.max(Math.trunc(limit), 1),
            MAX_IMAGE_SNAPSHOT_PAGE_SIZE,
        );
        const fetched = await this.repository.findPage(
            afterProductId,
            pageSize,
        );
        const hasMore = fetched.length > pageSize;
        const items = fetched.slice(0, pageSize);
        return {
            items,
            nextCursor: hasMore ? (items.at(-1)?.productId ?? null) : null,
        };
    }

    // Trả snapshot mới nhất để consumer chỉ dùng event làm tín hiệu, không dùng revision cũ để ghi vector.
    findOne(productId: string): Promise<InternalProductImageSnapshot | null> {
        return this.repository.findOne(productId);
    }
}
