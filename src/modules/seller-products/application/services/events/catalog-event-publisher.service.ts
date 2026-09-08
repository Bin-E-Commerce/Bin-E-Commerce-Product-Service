// Service này phát catalog snapshot sau commit Product để Recommendation cập nhật read model, không sở hữu catalog transaction.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createHash } from "node:crypto";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { RecommendationCatalogEvents } from "@common/kafka/events/recommendation.events";
import type {
  RecommendationCatalogEvent,
  RecommendationCatalogEventType,
} from "@common/kafka/events/recommendation.events";
import { Product } from "../../../../../database/catalog/entities/product.entity";
import { ProductVariant } from "../../../../../database/catalog/entities/product-variant.entity";
import { ProductVariantStatus } from "../../../../../database/catalog/enums/product-variant-status.enum";
import { ProductStatus } from "../../../../../database/catalog/enums/product-status.enum";
import { KafkaProducerService } from "../../../../../kafka/kafka-producer.service";
import { CatalogEventOutboxEntity } from "../../../../../database/integration/entities/catalog-event-outbox.entity";

@Injectable()
export class CatalogEventPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CatalogEventPublisherService.name);
  private retryTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(ProductVariant)
    private readonly variantRepository: Repository<ProductVariant>,
    @InjectRepository(CatalogEventOutboxEntity)
    private readonly outboxRepository: Repository<CatalogEventOutboxEntity>,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  // Khởi động dispatcher nhẹ để event tồn đọng được gửi lại sau khi broker phục hồi.
  onModuleInit(): void {
    this.retryTimer = setInterval(() => void this.dispatchPendingSafe(), 5000);
    void this.dispatchPendingSafe();
  }

  // Dừng timer khi shutdown để test/watch mode không giữ process sống.
  onModuleDestroy(): void {
    if (this.retryTimer) clearInterval(this.retryTimer);
  }

  // Phát lại snapshot theo variant vừa đổi tồn kho để Recommendation cập nhật availability sau commit inventory.
  async publishForVariants(variantIds: string[]): Promise<void> {
    if (variantIds.length === 0) return;
    const variants = await this.variantRepository.find({
      where: { id: In([...new Set(variantIds)]) },
      select: { id: true, productId: true },
    });
    for (const productId of [
      ...new Set(variants.map((variant) => variant.productId)),
    ]) {
      await this.publish(
        productId,
        RecommendationCatalogEvents.AVAILABILITY_CHANGED,
      );
    }
  }

  // Đọc snapshot public sau commit rồi phát event versioned; Kafka lỗi chỉ được log vì Product DB vẫn là nguồn sự thật.
  async publish(
    productId: string,
    eventName: RecommendationCatalogEventType,
  ): Promise<void> {
    // Availability cũng phải có revision riêng; increment trước snapshot giúp eventId không phụ thuộc timestamp.
    const event = await this.productRepository.manager.transaction(async (manager) => {
      const rows = await manager.query(
        `UPDATE products SET catalog_revision = catalog_revision + 1 WHERE id = $1 RETURNING catalog_revision`,
        [productId],
      ) as Array<{ catalog_revision: string | number }>;
      if (rows.length === 0) return null;
      const product = await manager.getRepository(Product).findOne({
        where: { id: productId },
        relations: { images: true, variants: { inventory: true }, brand: true, attributeValues: true },
      });
      if (!product) return null;
      const event = this.toEvent(product, eventName);
      await manager.getRepository(CatalogEventOutboxEntity).upsert({
        eventId: event.eventId,
        topic: event.eventName,
        aggregateId: event.aggregateId,
        payload: event,
        status: "PENDING",
        availableAt: new Date(),
        updatedAt: new Date(),
      }, ["eventId"]);
      return event;
    });
    if (!event) return;
    await this.outboxRepository.update({ eventId: event.eventId, status: "PENDING" }, { status: "PROCESSING", updatedAt: new Date() });
    await this.dispatchEvent(event);
  }

  // Build event ngoài persistence adapter để snapshot và eventId luôn dùng cùng một revision.
  private toEvent(product: Product, eventName: RecommendationCatalogEventType): RecommendationCatalogEvent {
    const image =
      [...(product.images ?? [])].sort(
        (left, right) => left.sortOrder - right.sortOrder,
      )[0]?.imageUrl ?? null;
    const isInStock = product.status === ProductStatus.ACTIVE && (product.variants ?? []).some(
      (variant) =>
        variant.status === ProductVariantStatus.ACTIVE &&
        (variant.inventory?.quantityAvailable ?? variant.stockQuantity) > 0,
    );
    const occurredAt =
      product.updatedAt?.toISOString() ?? new Date().toISOString();
    const semanticContent = this.buildSemanticContent(product);
    return {
      eventId: `${product.id}:${product.catalogRevision}:${eventName}`,
      eventName,
      eventVersion: 1,
      source: "product-service",
      occurredAt,
      aggregateId: product.id,
      data: {
        productId: product.id,
        originType: product.originType,
        name: product.name,
        slug: product.slug,
        imageUrl: image,
        categoryId: product.categoryId,
        brandId: product.brandId,
        sellerShopId: product.sellerShopId,
        externalShopId: product.externalShopId,
        minPrice: product.minPrice,
        maxPrice: product.maxPrice,
        ratingAvg: product.ratingAvg,
        reviewCount: product.reviewCount,
        totalSold: product.totalSold,
        status:
          product.status === ProductStatus.ACTIVE
            ? "ACTIVE"
            : product.status === ProductStatus.DELETED
              ? "DELETED"
              : "INACTIVE",
        isInStock,
        createdAt: product.createdAt.toISOString(),
        updatedAt: occurredAt,
        catalogRevision: product.catalogRevision ?? "1",
        catalogVersion: product.catalogRevision ?? "1",
        semanticContent,
      },
    };
  }

  // Gửi event tức thời; nếu broker lỗi, row vẫn ở PENDING để timer xử lý lại.
  private async dispatchEvent(event: RecommendationCatalogEvent): Promise<void> {
    const published = await this.kafkaProducer.publish(event.eventName, event, event.aggregateId);
    if (published) {
      await this.outboxRepository.update({ eventId: event.eventId }, { status: "PUBLISHED", publishedAt: new Date(), updatedAt: new Date() });
      this.logger.debug(`Published catalog event ${event.eventName} for ${event.aggregateId}`);
      return;
    }
    await this.scheduleRetry(event.eventId);
  }

  // Lease đơn giản theo availableAt; event catalog cùng product vẫn giữ thứ tự nhờ Kafka aggregate key.
  private async dispatchPending(): Promise<void> {
    // Khôi phục row đang PROCESSING nếu process crash sau khi claim nhưng trước khi Kafka ack.
    await this.outboxRepository.query(
      `UPDATE catalog_event_outbox
          SET status = 'PENDING', updated_at = now()
        WHERE status = 'PROCESSING' AND updated_at < now() - INTERVAL '1 minute'`,
    );
    const claimed = await this.outboxRepository.query(
      `WITH claimed AS (
         SELECT event_id FROM catalog_event_outbox
         WHERE status = 'PENDING' AND available_at <= now()
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED LIMIT 20
       )
       UPDATE catalog_event_outbox outbox
          SET status = 'PROCESSING', updated_at = now()
         FROM claimed
        WHERE outbox.event_id = claimed.event_id
      RETURNING outbox.event_id`,
    ) as Array<{ event_id: string }>;
    const pending = claimed.length
      ? await this.outboxRepository.find({ where: { eventId: In(claimed.map((row) => row.event_id)) }, order: { createdAt: "ASC" } })
      : [];
    for (const row of pending) {
      await this.dispatchEvent(row.payload as unknown as RecommendationCatalogEvent);
    }
  }

  // Bọc polling để lỗi database hoặc Kafka không tạo unhandled rejection trong Nest process.
  private async dispatchPendingSafe(): Promise<void> {
    try {
      await this.dispatchPending();
    } catch (error) {
      this.logger.warn(`Catalog outbox dispatch deferred: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  // Backoff bounded để broker lỗi không tạo vòng gửi nóng và không bỏ event.
  private async scheduleRetry(eventId: string): Promise<void> {
    const row = await this.outboxRepository.findOne({ where: { eventId } });
    if (!row || row.status !== "PENDING" && row.status !== "PROCESSING") return;
    const attemptCount = row.attemptCount + 1;
    const delaySeconds = Math.min(3600, 2 ** Math.min(attemptCount, 10));
    await this.outboxRepository.update({ eventId }, {
      status: "PENDING",
      attemptCount,
      availableAt: new Date(Date.now() + delaySeconds * 1000),
      updatedAt: new Date(),
    });
  }

  // Tạo semantic snapshot bounded từ Product aggregate; không đưa giá, stock, status hay owner vào content hash.
  private buildSemanticContent(product: Product): RecommendationCatalogEvent["data"]["semanticContent"] {
    const normalize = (value: string | null | undefined, max: number) =>
      (value ?? "").replace(/<[^>]*>/g, " ").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, max);
    const attributes = (product.attributeValues ?? [])
      .map((attribute) => ({
        key: normalize(attribute.categoryAttributeId, 128),
        value: normalize(attribute.valueText ?? attribute.valueNumber ?? (attribute.valueBoolean === null ? "" : String(attribute.valueBoolean)), 500),
      }))
      .filter((attribute) => attribute.key && attribute.value)
      .sort((left, right) => `${left.key}:${left.value}`.localeCompare(`${right.key}:${right.value}`))
      .slice(0, 50);
    const content = {
      title: normalize(product.name, 255),
      shortDescription: product.shortDescription ? normalize(product.shortDescription, 1000) : null,
      description: product.description ? normalize(product.description, 4000) : null,
      brandName: product.brand?.name ? normalize(product.brand.name, 255) : null,
      categoryPath: typeof product.metadata?.categoryPath === "string" ? normalize(product.metadata.categoryPath, 1000) : null,
      attributes,
    };
    const contentHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
    return { ...content, contentHash };
  }

  // Chuyển status lifecycle sang event name nhất quán để Recommendation không cần hiểu use case của Product.
  static readonly topics = {
    upserted: RecommendationCatalogEvents.UPSERTED,
    statusChanged: RecommendationCatalogEvents.STATUS_CHANGED,
    deleted: RecommendationCatalogEvents.DELETED,
  } as const;
}
