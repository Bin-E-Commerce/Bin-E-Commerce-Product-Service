//
// Use case tạo product graph cho seller, gồm preflight shop và transaction dữ liệu sản phẩm.
//
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from "typeorm";
import { Brand } from "../../../../../database/catalog/entities/brand.entity";
import { Inventory } from "../../../../../database/inventory/entities/inventory.entity";
import { ProductAttributeValue } from "../../../../../database/catalog/entities/product-attribute-value.entity";
import { ProductImage } from "../../../../../database/catalog/entities/product-image.entity";
import { parseProductMediaReference } from "../../utils/product-media-reference.util";
import { ProductOptionValue } from "../../../../../database/catalog/entities/product-option-value.entity";
import { ProductOption } from "../../../../../database/catalog/entities/product-option.entity";
import { ProductVariantOptionValue } from "../../../../../database/catalog/entities/product-variant-option-value.entity";
import { ProductVariant } from "../../../../../database/catalog/entities/product-variant.entity";
import { Product } from "../../../../../database/catalog/entities/product.entity";
import { CreateSellerProductDto } from "../../../presentation/dto/create-product/create-seller-product.dto";
import { ProductOriginType } from "../../../../../database/catalog/enums/product-origin-type.enum";
import { ProductStatus } from "../../../../../database/catalog/enums/product-status.enum";
import { ProductVariantStatus } from "../../../../../database/catalog/enums/product-variant-status.enum";
import { CatalogClient } from "../../clients/catalog.client";
import { SellerShopClient } from "../../clients/seller-shop.client";
import type { CatalogAttributeReference } from "../../types/catalog-reference.type";
import type { CreateProductResponse } from "../../types/create-product-response.type";
import type { SellerProductUserContext } from "../../types/seller-product-user-context.type";
import { ProductIdentifierService } from "../identity/product-identifier.service";
import { SellerProductValidatorService } from "../validation/seller-product-validator.service";

@Injectable()
export class SellerProductCreationService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Brand)
    private readonly brandRepository: Repository<Brand>,
    private readonly catalogClient: CatalogClient,
    private readonly sellerShopClient: SellerShopClient,
    private readonly identifier: ProductIdentifierService,
    private readonly validator: SellerProductValidatorService,
  ) {}

  // Xác minh dữ liệu cross-service trước, sau đó ghi toàn bộ product graph trong một transaction PostgreSQL.
  async create(
    currentUser: SellerProductUserContext,
    dto: CreateSellerProductDto,
  ): Promise<CreateProductResponse> {
    const [shopProfile, catalogContext, brand] = await Promise.all([
      this.sellerShopClient.getOwnedActiveShop(currentUser),
      this.catalogClient.getProductCategoryContext(dto.categoryId),
      this.findActiveBrand(dto.brandId),
    ]);

    // Chỉ sản phẩm ACTIVE mới cần kho lấy hàng; bản nháp vẫn được lưu để seller hoàn thiện sau.
    if (dto.status === ProductStatus.ACTIVE) {
      await this.sellerShopClient.assertShippingReady(shopProfile.shop.id);
    }

    this.validator.validate(
      dto,
      catalogContext.category,
      catalogContext.attributes,
    );

    try {
      return await this.dataSource.transaction(async (manager) => {
        const product = await manager.save(
          manager.create(Product, {
            originType: ProductOriginType.INTERNAL,
            sellerShopId: shopProfile.shop.id,
            sellerOwnerId: currentUser.userId,
            externalShopId: null,
            categoryId: dto.categoryId,
            brandId: brand?.id ?? null,
            name: dto.name.trim(),
            slug: this.identifier.createSlug(dto.name),
            description: dto.description.trim(),
            shortDescription: dto.shortDescription?.trim() || null,
            gtin: dto.gtin?.trim() || null,
            sellerSku: dto.sellerSku?.trim() || null,
            condition: dto.condition,
            countryOfOrigin: dto.countryOfOrigin?.trim() || null,
            // Video là media tùy chọn; chỉ lưu tham chiếu để sau này Media Service có thể xử lý phát lại riêng.
            videoAssetId: dto.video?.assetId ?? null,
            videoUrl: dto.video?.videoUrl ?? null,
            videoDurationSeconds: dto.video?.durationSeconds ?? null,
            packageWeightGrams: dto.package.weightGrams,
            packageLengthCm: dto.package.lengthCm.toFixed(2),
            packageWidthCm: dto.package.widthCm.toFixed(2),
            packageHeightCm: dto.package.heightCm.toFixed(2),
            status: dto.status,
            minPrice: Math.min(...dto.variants.map((variant) => variant.price)).toFixed(2),
            maxPrice: Math.max(...dto.variants.map((variant) => variant.price)).toFixed(2),
            totalSold: 0,
            ratingAvg: null,
            reviewCount: 0,
            viewCount: 0,
            sourcePlatform: null,
            externalProductId: null,
            sourceUrl: null,
            metadata: {
              categoryName: catalogContext.category.name,
              categoryPath: catalogContext.category.path,
            },
          }),
        );

        await manager.save(
          ProductImage,
          dto.images.map((image) =>
            manager.create(ProductImage, {
              productId: product.id,
              variantId: null,
              imageUrl: image.imageUrl,
              altText: image.altText?.trim() || dto.name.trim(),
              sortOrder: image.sortOrder,
              isThumbnail: image.isThumbnail,
              externalImageId: parseProductMediaReference(image.imageUrl, "product_image")?.assetId ?? null,
              sourceAssetId: parseProductMediaReference(image.imageUrl, "product_image")?.assetId ?? null,
              aiAssetId: null,
            }),
          ),
        );

        const optionValueByClientId = await this.saveOptions(
          manager,
          product.id,
          dto,
        );
        await this.saveVariants(
          manager,
          product,
          shopProfile.shop.id,
          dto,
          optionValueByClientId,
        );
        await this.saveAttributes(
          manager,
          product.id,
          dto,
          catalogContext.attributes,
        );

        return {
          id: product.id,
          slug: product.slug,
          status: product.status,
          createdAt: product.createdAt,
        };
      });
    } catch (error) {
      if (this.isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          "SKU, ảnh hoặc dữ liệu sản phẩm đang trùng với bản ghi đã có.",
        );
      }
      throw error;
    }
  }

  // Xác minh brand vẫn hoạt động; brandId là khóa nội bộ nên không chấp nhận ID không tồn tại.
  private async findActiveBrand(brandId?: string): Promise<Brand | null> {
    if (!brandId) return null;

    const brand = await this.brandRepository.findOne({
      where: { id: brandId, isActive: true },
    });
    if (!brand) {
      throw new BadRequestException("Thương hiệu đã chọn không còn hợp lệ.");
    }
    return brand;
  }

  // Lưu option trước option value để tạo map từ clientId tạm của form sang UUID thật trong database.
  private async saveOptions(
    manager: EntityManager,
    productId: string,
    dto: CreateSellerProductDto,
  ): Promise<Map<string, ProductOptionValue>> {
    if (dto.options.length === 0) return new Map();

    const savedOptions = await manager.save(
      ProductOption,
      dto.options.map((option) =>
        manager.create(ProductOption, {
          productId,
          name: option.name.trim(),
          position: option.position,
        }),
      ),
    );
    const savedOptionByClientId = new Map(
      dto.options.map((option, index) => [option.clientId, savedOptions[index]]),
    );

    const valueInputs = dto.options.flatMap((option) =>
      option.values.map((value) => ({
        dto: value,
        optionId: savedOptionByClientId.get(option.clientId)!.id,
      })),
    );
    const savedValues = await manager.save(
      ProductOptionValue,
      valueInputs.map(({ dto: value, optionId }) =>
        manager.create(ProductOptionValue, {
          optionId,
          value: value.value.trim(),
          position: value.position,
        }),
      ),
    );

    return new Map(
      valueInputs.map(({ dto: value }, index) => [
        value.clientId,
        savedValues[index]!,
      ]),
    );
  }

  // Lưu variant, inventory và bảng nối option value theo cùng thứ tự DTO đã được validator xác minh.
  private async saveVariants(
    manager: EntityManager,
    product: Product,
    shopId: string,
    dto: CreateSellerProductDto,
    optionValueByClientId: Map<string, ProductOptionValue>,
  ): Promise<void> {
    const savedVariants = await manager.save(
      ProductVariant,
      dto.variants.map((variant) => {
        const selectedNames = variant.optionValueClientIds.map(
          (clientId) => optionValueByClientId.get(clientId)!.value,
        );
        return manager.create(ProductVariant, {
          productId: product.id,
          sku: this.identifier.createSystemSku(shopId),
          sellerSku: variant.sku?.trim() || null,
          name: selectedNames.length > 0 ? selectedNames.join(" / ") : product.name,
          price: variant.price.toFixed(2),
          originalPrice: variant.originalPrice?.toFixed(2) ?? null,
          gtin: variant.gtin?.trim() || product.gtin,
          // Khi variant kế thừa GTIN cấp product, không được đồng thời đánh dấu là "không có GTIN".
          withoutGtin: !variant.gtin && !product.gtin && variant.withoutGtin,
          stockQuantity: variant.stockQuantity,
          weight: (dto.package.weightGrams / 1_000).toFixed(3),
          status: ProductVariantStatus.ACTIVE,
          imageUrl: variant.imageUrl?.trim() || null,
          externalVariantId: null,
        });
      }),
    );

    await manager.save(
      Inventory,
      savedVariants.map((variant, index) =>
        manager.create(Inventory, {
          variantId: variant.id,
          quantityAvailable: dto.variants[index]!.stockQuantity,
          quantityReserved: 0,
          quantitySold: 0,
          lowStockThreshold: 5,
        }),
      ),
    );

    const choices = savedVariants.flatMap((variant, variantIndex) =>
      dto.variants[variantIndex]!.optionValueClientIds.map((clientId) =>
        manager.create(ProductVariantOptionValue, {
          variantId: variant.id,
          optionValueId: optionValueByClientId.get(clientId)!.id,
        }),
      ),
    );
    if (choices.length > 0) {
      await manager.save(ProductVariantOptionValue, choices);
    }
  }

  // Chuẩn hóa select thành tên hiển thị để đọc nhanh, đồng thời giữ option ID trong metadata cho bộ lọc chính xác.
  private async saveAttributes(
    manager: EntityManager,
    productId: string,
    dto: CreateSellerProductDto,
    catalogAttributes: CatalogAttributeReference[],
  ): Promise<void> {
    if (dto.attributes.length === 0) return;

    const catalogById = new Map(
      catalogAttributes.map((attribute) => [attribute.id, attribute]),
    );
    await manager.save(
      ProductAttributeValue,
      dto.attributes.map((attribute) => {
        const catalogAttribute = catalogById.get(attribute.categoryAttributeId);
        if (!catalogAttribute) {
          throw new NotFoundException("Không tìm thấy thuộc tính ngành hàng.");
        }

        const selectedOptionIds = attribute.selectedOptionIds ?? [];
        const selectedLabels = selectedOptionIds.map(
          (optionId) =>
            catalogAttribute.options?.find((option) => option.id === optionId)
              ?.displayValue ?? "",
        );
        return manager.create(ProductAttributeValue, {
          productId,
          categoryAttributeId: attribute.categoryAttributeId,
          valueText:
            selectedLabels.length > 0
              ? selectedLabels.join(", ")
              : attribute.valueText?.trim() || null,
          valueNumber:
            attribute.valueNumber !== undefined
              ? attribute.valueNumber.toFixed(4)
              : null,
          valueBoolean: attribute.valueBoolean ?? null,
          metadata: { selectedOptionIds },
        });
      }),
    );
  }

  // PostgreSQL dùng mã 23505 cho unique violation; chuyển sang HTTP 409 thay vì rò lỗi database.
  private isUniqueConstraintViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as { code?: string };
    return driverError.code === "23505";
  }
}
