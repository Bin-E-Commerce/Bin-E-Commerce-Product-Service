// Controller này cung cấp các thông tin sản phẩm tối thiểu cho service nội bộ.
// Controller chỉ phục vụ các business guard liên service và không chứa nghiệp vụ quản lý sản phẩm.

import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { createHash } from "node:crypto";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Product } from "../../../../database/catalog/entities/product.entity";
import { ProductOriginType } from "../../../../database/catalog/enums/product-origin-type.enum";
import { ProductStatus } from "../../../../database/catalog/enums/product-status.enum";
import { ProductVariantStatus } from "../../../../database/catalog/enums/product-variant-status.enum";
import { InternalServiceGuard } from "../../../checkout-inventory/presentation/guards/internal-service.guard";

// Internal endpoint chỉ trả số liệu tối thiểu, không trả dữ liệu sản phẩm hoặc thông tin của shop khác.
@Controller("internal/products")
@UseGuards(InternalServiceGuard)
export class InternalProductController {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  // Seller Service dùng số lượng này để bảo vệ địa chỉ mặc định đang phục vụ sản phẩm ACTIVE.
  @Get("shops/:shopId/active-count")
  async getActiveProductCount(
    @Param("shopId", new ParseUUIDPipe()) shopId: string,
  ): Promise<{ shopId: string; activeProductCount: number }> {
    const activeProductCount = await this.productRepository.count({
      where: {
        sellerShopId: shopId,
        originType: ProductOriginType.INTERNAL,
        status: ProductStatus.ACTIVE,
      },
    });

    return { shopId, activeProductCount };
  }

  // Snapshot phân trang cho Recommendation backfill; chỉ trả semantic/card fields cần thiết, không expose owner/payment data.
  @Get("catalog-snapshot")
  async getCatalogSnapshot(
    @Query("page") pageParam = "1",
    @Query("pageSize") pageSizeParam = "100",
  ) {
    const page = Math.max(1, Number.parseInt(pageParam, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(pageSizeParam, 10) || 100));
    const [items, total] = await this.productRepository.findAndCount({
      where: [{ status: ProductStatus.ACTIVE }, { status: ProductStatus.INACTIVE }, { status: ProductStatus.DELETED }],
      relations: { images: true, variants: { inventory: true }, brand: true, attributeValues: true },
      order: { id: "ASC" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: items.map((product) => this.toCatalogSnapshot(product)),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // Chuẩn hóa semantic snapshot giống catalog event để backfill tạo cùng contentHash với realtime path.
  private toCatalogSnapshot(product: Product) {
    const normalize = (value: string | null | undefined, max: number) => (value ?? "").replace(/<[^>]*>/g, " ").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, max);
    const semanticBase = {
      title: normalize(product.name, 255),
      shortDescription: product.shortDescription ? normalize(product.shortDescription, 1000) : null,
      description: product.description ? normalize(product.description, 4000) : null,
      brandName: product.brand?.name ? normalize(product.brand.name, 255) : null,
      categoryPath: typeof product.metadata?.categoryPath === "string" ? normalize(product.metadata.categoryPath, 1000) : null,
      attributes: (product.attributeValues ?? []).map((item) => ({ key: normalize(item.categoryAttributeId, 128), value: normalize(item.valueText ?? item.valueNumber ?? (item.valueBoolean === null ? "" : String(item.valueBoolean)), 500) })).filter((item) => item.key && item.value).sort((left, right) => `${left.key}:${left.value}`.localeCompare(`${right.key}:${right.value}`)).slice(0, 50),
    };
    const isInStock = (product.variants ?? []).some((variant) => variant.status === ProductVariantStatus.ACTIVE && (variant.inventory?.quantityAvailable ?? variant.stockQuantity) > 0);
    const imageUrl = [...(product.images ?? [])].sort((left, right) => left.sortOrder - right.sortOrder)[0]?.imageUrl ?? null;
    return {
      id: product.id,
      originType: product.originType,
      name: product.name,
      slug: product.slug,
      imageUrl,
      categoryId: product.categoryId,
      brandId: product.brandId,
      sellerShopId: product.sellerShopId,
      externalShopId: product.externalShopId,
      minPrice: product.minPrice,
      maxPrice: product.maxPrice,
      ratingAvg: product.ratingAvg,
      reviewCount: product.reviewCount,
      totalSold: product.totalSold,
      status: product.status === ProductStatus.ACTIVE ? "ACTIVE" : product.status === ProductStatus.DELETED ? "DELETED" : "INACTIVE",
      isInStock: product.status === ProductStatus.ACTIVE && isInStock,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      catalogVersion: product.catalogRevision,
      ...semanticBase,
      contentHash: createHash("sha256").update(JSON.stringify(semanticBase)).digest("hex"),
    };
  }
}
