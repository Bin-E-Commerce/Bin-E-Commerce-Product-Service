// Service này phát catalog snapshot sau commit Product để Recommendation cập nhật read model, không sở hữu catalog transaction.

import { Injectable, Logger } from "@nestjs/common";
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

@Injectable()
export class CatalogEventPublisherService {
  private readonly logger = new Logger(CatalogEventPublisherService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(ProductVariant)
    private readonly variantRepository: Repository<ProductVariant>,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

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
    const product = await this.productRepository.findOne({
      where: { id: productId },
      relations: { images: true, variants: { inventory: true } },
    });
    if (!product) return;
    const image =
      [...(product.images ?? [])].sort(
        (left, right) => left.sortOrder - right.sortOrder,
      )[0]?.imageUrl ?? null;
    const isInStock = (product.variants ?? []).some(
      (variant) =>
        variant.status === ProductVariantStatus.ACTIVE &&
        (variant.inventory?.quantityAvailable ?? variant.stockQuantity) > 0,
    );
    const occurredAt =
      product.updatedAt?.toISOString() ?? new Date().toISOString();
    const event: RecommendationCatalogEvent = {
      eventId: `${eventName}:${product.id}:${occurredAt}`,
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
        catalogVersion: Math.floor(new Date(occurredAt).getTime() / 1000),
      },
    };
    await this.kafkaProducer.publish(eventName, event, product.id);
    this.logger.debug(`Published catalog event ${eventName} for ${product.id}`);
  }

  // Chuyển status lifecycle sang event name nhất quán để Recommendation không cần hiểu use case của Product.
  static readonly topics = {
    upserted: RecommendationCatalogEvents.UPSERTED,
    statusChanged: RecommendationCatalogEvents.STATUS_CHANGED,
    deleted: RecommendationCatalogEvents.DELETED,
  } as const;
}
