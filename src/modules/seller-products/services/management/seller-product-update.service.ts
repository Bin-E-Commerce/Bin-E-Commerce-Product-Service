// Service này cập nhật product graph của seller trong transaction và giữ nguyên các snapshot cần cho catalog.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  DataSource,
  EntityManager,
  In,
  Not,
  QueryFailedError,
  Repository,
} from "typeorm";
import { Brand } from "../../../../database/catalog/entities/brand.entity";
import { Inventory } from "../../../../database/inventory/entities/inventory.entity";
import { ProductAttributeValue } from "../../../../database/catalog/entities/product-attribute-value.entity";
import { ProductImage } from "../../../../database/catalog/entities/product-image.entity";
import { ProductOptionValue } from "../../../../database/catalog/entities/product-option-value.entity";
import { ProductOption } from "../../../../database/catalog/entities/product-option.entity";
import { ProductVariantOptionValue } from "../../../../database/catalog/entities/product-variant-option-value.entity";
import { ProductVariant } from "../../../../database/catalog/entities/product-variant.entity";
import { Product } from "../../../../database/catalog/entities/product.entity";
import { ProductOriginType } from "../../../../database/catalog/enums/product-origin-type.enum";
import { ProductStatus } from "../../../../database/catalog/enums/product-status.enum";
import { ProductVariantStatus } from "../../../../database/catalog/enums/product-variant-status.enum";
import { UpdateProductOptionDto } from "../../dto/update-product/update-seller-product.dto";
import { UpdateProductVariantDto } from "../../dto/update-product/update-seller-product.dto";
import { UpdateSellerProductDto } from "../../dto/update-product/update-seller-product.dto";
import { CreateSellerProductDto } from "../../dto/create-product/create-seller-product.dto";
import { CatalogClient } from "../../integrations/catalog.client";
import { ProductMediaClient } from "../../integrations/product-media.client";
import { SellerShopClient } from "../../integrations/seller-shop.client";
import type { ProductMediaReference } from "../../types/product-media-reference.type";
import type { CatalogAttributeReference } from "../../types/catalog-reference.type";
import type { SellerProductUserContext } from "../../types/seller-product-user-context.type";
import type { UpdateProductResponse } from "../../types/update-product-response.type";
import { ProductIdentifierService } from "../identity/product-identifier.service";
import { SellerProductValidatorService } from "../validation/seller-product-validator.service";
import {
  parseProductMediaReference,
  uniqueProductMediaReferences,
} from "../../utils/product-media-reference.util";

@Injectable()
export class SellerProductUpdateService {
  private readonly logger = new Logger(SellerProductUpdateService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Brand)
    private readonly brandRepository: Repository<Brand>,
    private readonly catalogClient: CatalogClient,
    private readonly productMediaClient: ProductMediaClient,
    private readonly sellerShopClient: SellerShopClient,
    private readonly identifier: ProductIdentifierService,
    private readonly validator: SellerProductValidatorService,
  ) {}

  // Kiểm tra tham chiếu bên ngoài trước rồi thay thế toàn bộ product graph trong một transaction để không lưu dữ liệu dở dang.
  async update(
    currentUser: SellerProductUserContext,
    productId: string,
    dto: UpdateSellerProductDto,
  ): Promise<UpdateProductResponse> {
    const existing = await this.productRepository.findOne({
      where: {
        id: productId,
        sellerOwnerId: currentUser.userId,
        originType: ProductOriginType.INTERNAL,
      },
    });
    if (!existing || existing.status === ProductStatus.DELETED) {
      throw new NotFoundException("Không tìm thấy sản phẩm trong shop của bạn.");
    }

    const [shopProfile, catalogContext, brand] = await Promise.all([
      this.sellerShopClient.getOwnedActiveShop(currentUser),
      this.catalogClient.getProductCategoryContext(dto.categoryId),
      this.findActiveBrand(dto.brandId),
    ]);
    this.validator.validate(
      dto as unknown as CreateSellerProductDto,
      catalogContext.category,
      catalogContext.attributes,
    );

    try {
      const transactionResult = await this.dataSource.transaction(async (manager) => {
        const product = await this.loadProductForUpdate(manager, productId, currentUser.userId);
        const oldVariants = [...(product.variants ?? [])];
        const oldVideoAssetId = product.videoAssetId;
        const oldVideoReference = oldVideoAssetId
          ? { assetId: oldVideoAssetId, purpose: "product_video" as const }
          : parseProductMediaReference(product.videoUrl, "product_video");
        const oldImages = await manager.find(ProductImage, {
          where: { productId: product.id },
        });
        const staleMediaCandidates = this.collectRemovedMedia(
          oldImages,
          oldVideoReference,
          dto,
        );

        product.categoryId = dto.categoryId;
        product.brandId = brand?.id ?? null;
        product.name = dto.name.trim();
        product.description = dto.description.trim();
        product.shortDescription = dto.shortDescription?.trim() || null;
        product.gtin = dto.gtin?.trim() || null;
        product.sellerSku = dto.sellerSku?.trim() || null;
        product.condition = dto.condition;
        product.countryOfOrigin = dto.countryOfOrigin?.trim() || null;
        product.videoAssetId = dto.video?.assetId ?? null;
        product.videoUrl = dto.video?.videoUrl ?? null;
        product.videoDurationSeconds = dto.video?.durationSeconds ?? null;
        product.packageWeightGrams = dto.package.weightGrams;
        product.packageLengthCm = dto.package.lengthCm.toFixed(2);
        product.packageWidthCm = dto.package.widthCm.toFixed(2);
        product.packageHeightCm = dto.package.heightCm.toFixed(2);
        // Status không lấy từ body để seller không vô tình publish hoặc ẩn sản phẩm khi chỉ sửa nội dung.
        product.status = existing.status;
        product.minPrice = Math.min(...dto.variants.map((variant) => variant.price)).toFixed(2);
        product.maxPrice = Math.max(...dto.variants.map((variant) => variant.price)).toFixed(2);
        product.metadata = {
          ...(product.metadata ?? {}),
          categoryName: catalogContext.category.name,
          categoryPath: catalogContext.category.path,
        };
        await manager.save(Product, product);

        await this.replaceImages(manager, product, dto, oldImages);
        const optionValueByClientId = await this.replaceOptions(
          manager,
          product.id,
          oldVariants,
          dto.options,
        );
        await this.reconcileVariants(
          manager,
          product,
          shopProfile.shop.id,
          oldVariants,
          dto.variants,
          optionValueByClientId,
        );
        await this.replaceAttributes(
          manager,
          product.id,
          dto,
          catalogContext.attributes,
        );
        const staleMedia = await this.filterSharedMedia(
          manager,
          product.id,
          oldImages,
          oldVideoReference,
          staleMediaCandidates,
        );

        return {
          response: {
            id: product.id,
            slug: product.slug,
            status: product.status,
            updatedAt: product.updatedAt,
          },
          staleMedia,
        };
      });

      await this.cleanupRemovedMedia(currentUser.userId, transactionResult.staleMedia);
      return transactionResult.response;
    } catch (error) {
      if (this.isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          "SKU, ảnh hoặc dữ liệu sản phẩm đang trùng với bản ghi đã có.",
        );
      }
      throw error;
    }
  }

  // Tìm lại aggregate trong transaction và khóa phạm vi theo owner để chống cập nhật nhầm khi dữ liệu thay đổi đồng thời.
  private async loadProductForUpdate(
    manager: EntityManager,
    productId: string,
    ownerId: string,
  ): Promise<Product> {
    const product = await manager.findOne(Product, {
      where: {
        id: productId,
        sellerOwnerId: ownerId,
        originType: ProductOriginType.INTERNAL,
      },
      lock: { mode: "pessimistic_write" },
    });
    if (!product || product.status === ProductStatus.DELETED) {
      throw new NotFoundException("Không tìm thấy sản phẩm trong shop của bạn.");
    }
    // Inventory là quan hệ nullable nên không đưa vào truy vấn SELECT đang khóa; product row đã đủ để serialize update.
    product.variants = await manager.find(ProductVariant, {
      where: { productId: product.id },
      relations: { inventory: true },
    });

    return product;
  }

  // Thay ảnh theo payload đầy đủ; việc xóa object S3 được thực hiện sau commit bởi cleanupRemovedMedia.
  private async replaceImages(
    manager: EntityManager,
    product: Product,
    dto: UpdateSellerProductDto,
    oldImages: ProductImage[],
  ): Promise<void> {
    const oldByUrl = new Map(oldImages.map((image) => [image.imageUrl.trim(), image]));
    await manager.delete(ProductImage, { productId: product.id });
    await manager.save(
      ProductImage,
      dto.images.map((image) => {
        const imageUrl = image.imageUrl.trim();
        const previous = oldByUrl.get(imageUrl);
        const parsedSourceAssetId = parseProductMediaReference(imageUrl, "product_image")?.assetId ?? null;
        const sourceAssetId = previous?.sourceAssetId ?? parsedSourceAssetId;
        return manager.create(ProductImage, {
          productId: product.id,
          variantId: null,
          imageUrl,
          altText: image.altText?.trim() || product.name,
          sortOrder: image.sortOrder,
          isThumbnail: image.isThumbnail,
          // Giữ lineage nếu seller không thay URL; output AI không bị biến thành source mới ngoài ý muốn.
          externalImageId: previous?.externalImageId ?? parsedSourceAssetId,
          sourceAssetId,
          aiAssetId: previous?.aiAssetId ?? null,
        });
      }),
    );
  }

  // Xác định chính xác asset cũ không còn xuất hiện trong payload mới trước khi xóa liên kết database.
  private collectRemovedMedia(
    oldImages: ProductImage[],
    oldVideoReference: ProductMediaReference | null,
    dto: UpdateSellerProductDto,
  ): ProductMediaReference[] {
    const oldMedia = oldImages.map((image) =>
      parseProductMediaReference(image.imageUrl, "product_image"),
    );
    oldMedia.push(oldVideoReference);

    const newMedia = [
      ...dto.images.map((image) =>
        parseProductMediaReference(image.imageUrl, "product_image"),
      ),
      dto.video?.assetId
        ? ({ assetId: dto.video.assetId, purpose: "product_video" } satisfies ProductMediaReference)
        : null,
    ];
    const newKeys = new Set(
      uniqueProductMediaReferences(newMedia).map(
        (media) => `${media.purpose}:${media.assetId}`,
      ),
    );

    return uniqueProductMediaReferences(oldMedia).filter(
      (media) => !newKeys.has(`${media.purpose}:${media.assetId}`),
    );
  }

  // Không xóa asset nếu URL hoặc video ID vẫn được product khác tham chiếu; điều này bảo vệ trường hợp seller tái sử dụng media.
  private async filterSharedMedia(
    manager: EntityManager,
    productId: string,
    oldImages: ProductImage[],
    oldVideoReference: ProductMediaReference | null,
    staleMedia: ProductMediaReference[],
  ): Promise<ProductMediaReference[]> {
    if (staleMedia.length === 0) return [];

    const oldImageUrls = oldImages
      .filter((image) =>
        staleMedia.some(
          (media) =>
            media.purpose === "product_image" &&
            parseProductMediaReference(image.imageUrl, "product_image")?.assetId === media.assetId,
        ),
      )
      .map((image) => image.imageUrl);
    const sharedImages = oldImageUrls.length
      ? await manager.find(ProductImage, {
          where: oldImageUrls.map((imageUrl) => ({
            imageUrl,
            productId: Not(productId),
          })),
        })
      : [];
    const sharedImageKeys = new Set(
      sharedImages
        .map((image) => parseProductMediaReference(image.imageUrl, "product_image"))
        .filter((media): media is ProductMediaReference => media !== null)
        .map((media) => `${media.purpose}:${media.assetId}`),
    );

    const sharedVideoIds = oldVideoReference
      ? await manager.count(Product, {
          where: { videoAssetId: In([oldVideoReference.assetId]) },
        })
      : 0;
    return staleMedia.filter((media) => {
      if (sharedImageKeys.has(`${media.purpose}:${media.assetId}`)) return false;
      if (
        media.purpose === "product_video" &&
        oldVideoReference?.assetId === media.assetId &&
        sharedVideoIds > 0
      ) return false;
      return true;
    });
  }

  // Cleanup storage sau commit là best-effort để lỗi S3 không làm rollback thay đổi sản phẩm đã hợp lệ.
  private async cleanupRemovedMedia(
    userId: string,
    staleMedia: ProductMediaReference[],
  ): Promise<void> {
    if (staleMedia.length === 0) return;

    try {
      await this.productMediaClient.cleanupProductAssets(userId, staleMedia);
    } catch (error) {
      this.logger.warn(
        `Product media cleanup deferred for ${staleMedia.length} assets: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  // Tái tạo option/value để client ID của form luôn ánh xạ rõ ràng; các variant cũ vẫn được giữ dưới dạng bản ghi riêng.
  private async replaceOptions(
    manager: EntityManager,
    productId: string,
    oldVariants: ProductVariant[],
    options: UpdateProductOptionDto[],
  ): Promise<Map<string, ProductOptionValue>> {
    for (const variant of oldVariants) {
      await manager.delete(ProductVariantOptionValue, { variantId: variant.id });
    }
    await manager.delete(ProductOption, { productId });
    if (options.length === 0) return new Map();

    const savedOptions = await manager.save(
      ProductOption,
      options.map((option) =>
        manager.create(ProductOption, {
          productId,
          name: option.name.trim(),
          position: option.position,
        }),
      ),
    );
    const optionByClientId = new Map(
      options.map((option, index) => [option.clientId, savedOptions[index]!]),
    );
    const valueInputs = options.flatMap((option) =>
      option.values.map((value) => ({ value, optionId: optionByClientId.get(option.clientId)!.id })),
    );
    const savedValues = await manager.save(
      ProductOptionValue,
      valueInputs.map(({ value, optionId }) =>
        manager.create(ProductOptionValue, {
          optionId,
          value: value.value.trim(),
          position: value.position,
        }),
      ),
    );
    return new Map(
      valueInputs.map(({ value }, index) => [value.clientId, savedValues[index]!]),
    );
  }

  // Cập nhật variant hiện hữu theo ID, tạo SKU mới khi cần và chuyển các variant bị loại khỏi form sang INACTIVE.
  private async reconcileVariants(
    manager: EntityManager,
    product: Product,
    shopId: string,
    oldVariants: ProductVariant[],
    variants: UpdateProductVariantDto[],
    optionValueByClientId: Map<string, ProductOptionValue>,
  ): Promise<void> {
    const oldById = new Map(oldVariants.map((variant) => [variant.id, variant]));
    const submittedIds = new Set<string>();

    for (const input of variants) {
      if (input.id && submittedIds.has(input.id)) {
        throw new BadRequestException("Variant bị lặp trong payload chỉnh sửa.");
      }
      const variant = input.id ? oldById.get(input.id) : undefined;
      if (input.id && !variant) {
        throw new BadRequestException("Variant không thuộc sản phẩm đang chỉnh sửa.");
      }
      if (input.id) submittedIds.add(input.id);

      const entity = variant ?? manager.create(ProductVariant);
      const selectedValues = input.optionValueClientIds.map((clientId) => {
        const value = optionValueByClientId.get(clientId);
        if (!value) throw new BadRequestException("Variant tham chiếu option không hợp lệ.");
        return value;
      });
      const reserved = variant?.inventory?.quantityReserved ?? 0;
      if (input.stockQuantity < reserved) {
        throw new BadRequestException("Tồn kho mới không được thấp hơn số lượng đang được giữ.");
      }

      entity.productId = product.id;
      entity.sku = variant?.sku ?? this.identifier.createSystemSku(shopId);
      entity.sellerSku = input.sku?.trim() || null;
      entity.name = selectedValues.length > 0
        ? selectedValues.map((value) => value.value).join(" / ")
        : product.name;
      entity.price = input.price.toFixed(2);
      entity.originalPrice = input.originalPrice?.toFixed(2) ?? null;
      entity.gtin = input.gtin?.trim() || product.gtin;
      entity.withoutGtin = !input.gtin && !product.gtin && input.withoutGtin;
      entity.stockQuantity = input.stockQuantity;
      entity.weight = (Number(product.packageWeightGrams) / 1_000).toFixed(3);
      entity.status = ProductVariantStatus.ACTIVE;
      entity.imageUrl = input.imageUrl?.trim() || null;
      entity.externalVariantId = variant?.externalVariantId ?? null;
      const savedVariant = await manager.save(ProductVariant, entity);

      const inventory = variant?.inventory ?? manager.create(Inventory, { variantId: savedVariant.id });
      inventory.variantId = savedVariant.id;
      inventory.quantityReserved = reserved;
      inventory.quantityAvailable = input.stockQuantity - reserved;
      inventory.quantitySold = variant?.inventory?.quantitySold ?? 0;
      inventory.lowStockThreshold = variant?.inventory?.lowStockThreshold ?? 5;
      await manager.save(Inventory, inventory);

      await manager.save(
        ProductVariantOptionValue,
        selectedValues.map((value) =>
          manager.create(ProductVariantOptionValue, {
            variantId: savedVariant.id,
            optionValueId: value.id,
          }),
        ),
      );
    }

    for (const variant of oldVariants) {
      if (submittedIds.has(variant.id)) continue;
      const reserved = variant.inventory?.quantityReserved ?? 0;
      variant.status = ProductVariantStatus.INACTIVE;
      variant.stockQuantity = reserved;
      await manager.save(ProductVariant, variant);
      if (variant.inventory) {
        variant.inventory.quantityAvailable = 0;
        await manager.save(Inventory, variant.inventory);
      }
    }
  }

  // Attribute là dữ liệu snapshot theo category nên được thay thế đồng bộ với payload đầy đủ.
  private async replaceAttributes(
    manager: EntityManager,
    productId: string,
    dto: UpdateSellerProductDto,
    catalogAttributes: CatalogAttributeReference[],
  ): Promise<void> {
    await manager.delete(ProductAttributeValue, { productId });
    const catalogById = new Map(catalogAttributes.map((attribute) => [attribute.id, attribute]));
    await manager.save(
      ProductAttributeValue,
      dto.attributes.map((attribute) => {
        const catalogAttribute = catalogById.get(attribute.categoryAttributeId);
        if (!catalogAttribute) throw new NotFoundException("Không tìm thấy thuộc tính ngành hàng.");
        const selectedOptionIds = attribute.selectedOptionIds ?? [];
        const selectedLabels = selectedOptionIds.map(
          (optionId) => catalogAttribute.options?.find((option) => option.id === optionId)?.displayValue ?? "",
        );
        return manager.create(ProductAttributeValue, {
          productId,
          categoryAttributeId: attribute.categoryAttributeId,
          valueText: selectedLabels.length > 0 ? selectedLabels.join(", ") : attribute.valueText?.trim() || null,
          valueNumber: attribute.valueNumber !== undefined ? attribute.valueNumber.toFixed(4) : null,
          valueBoolean: attribute.valueBoolean ?? null,
          metadata: { selectedOptionIds },
        });
      }),
    );
  }

  // Chỉ cho phép brand đang hoạt động để product không giữ tham chiếu tới dữ liệu danh mục đã ngưng sử dụng.
  private async findActiveBrand(brandId?: string): Promise<Brand | null> {
    if (!brandId) return null;
    const brand = await this.brandRepository.findOne({ where: { id: brandId, isActive: true } });
    if (!brand) throw new BadRequestException("Thương hiệu đã chọn không còn hợp lệ.");
    return brand;
  }

  // Chuyển unique violation từ PostgreSQL thành lỗi 409 dễ xử lý ở frontend.
  private isUniqueConstraintViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as { code?: string };
    return driverError.code === "23505";
  }
}
