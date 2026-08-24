import { BadRequestException, Injectable } from "@nestjs/common";
import { CreateSellerProductDto } from "../../dto/create-product/create-seller-product.dto";
import type {
  CatalogAttributeReference,
  CatalogCategoryReference,
} from "../../types/catalog-reference.type";

const SELECT_INPUT_TYPES = new Set(["SINGLE_SELECT", "MULTI_SELECT"]);
const NUMBER_INPUT_TYPES = new Set(["INTEGER", "DECIMAL"]);
const TEXT_INPUT_TYPES = new Set(["TEXT", "TEXTAREA", "DATE", "DATETIME"]);
const GTIN_PATTERN = /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/;

@Injectable()
export class SellerProductValidatorService {
  // Kiểm tra toàn bộ quy tắc liên bảng trước khi mở transaction ghi product graph.
  validate(
    dto: CreateSellerProductDto,
    category: CatalogCategoryReference,
    catalogAttributes: CatalogAttributeReference[],
  ): void {
    this.validateCategory(category);
    this.validateImages(dto);
    this.validateVideo(dto);
    this.validateAttributes(dto, catalogAttributes);
    this.validateOptionsAndVariants(dto);
    this.validateCommercialCodes(dto);
  }

  // Chỉ category lá đang hoạt động mới được gắn trực tiếp vào sản phẩm bán hàng.
  private validateCategory(category: CatalogCategoryReference): void {
    if (!category.isActive || !category.isLeaf) {
      throw new BadRequestException(
        "Vui lòng chọn ngành hàng cấp cuối đang hoạt động.",
      );
    }
  }

  // Gallery phải có đúng một ảnh đại diện và không được lặp URL hoặc vị trí hiển thị.
  private validateImages(dto: CreateSellerProductDto): void {
    if (dto.images.length < 2) {
      throw new BadRequestException(
        "Sản phẩm cần có ít nhất 2 hình ảnh trước khi đăng bán.",
      );
    }
    const thumbnailCount = dto.images.filter((image) => image.isThumbnail).length;
    const imageUrls = dto.images.map((image) => image.imageUrl);
    const positions = dto.images.map((image) => image.sortOrder);

    if (thumbnailCount !== 1) {
      throw new BadRequestException(
        "Sản phẩm phải có đúng một ảnh đại diện.",
      );
    }

    this.assertUnique(imageUrls, "Ảnh sản phẩm không được trùng nhau.");
    this.assertUnique(
      positions,
      "Thứ tự hiển thị ảnh sản phẩm không được trùng nhau.",
    );
  }

  // Video chỉ là tiêu chí chất lượng bổ sung, nhưng khi có phải nằm trong giới hạn để trang chi tiết hiển thị ổn định.
  private validateVideo(dto: CreateSellerProductDto): void {
    if (!dto.video) return;

    if (dto.video.durationSeconds < 10 || dto.video.durationSeconds > 60) {
      throw new BadRequestException(
        "Video sản phẩm phải có thời lượng từ 10 đến 60 giây.",
      );
    }
  }

  // Đối chiếu thuộc tính seller gửi với schema động do Catalog Service quản lý.
  private validateAttributes(
    dto: CreateSellerProductDto,
    catalogAttributes: CatalogAttributeReference[],
  ): void {
    const catalogById = new Map(
      catalogAttributes.map((attribute) => [attribute.id, attribute]),
    );
    const submittedById = new Map(
      dto.attributes.map((attribute) => [attribute.categoryAttributeId, attribute]),
    );

    this.assertUnique(
      dto.attributes.map((attribute) => attribute.categoryAttributeId),
      "Mỗi thuộc tính ngành hàng chỉ được gửi một lần.",
    );

    // Tập option đã chọn giúp xác định thuộc tính điều kiện nào thực sự được kích hoạt.
    const selectedOptionIds = new Set(
      dto.attributes.flatMap((attribute) => attribute.selectedOptionIds ?? []),
    );

    for (const submitted of dto.attributes) {
      const catalogAttribute = catalogById.get(submitted.categoryAttributeId);
      if (!catalogAttribute) {
        throw new BadRequestException(
          "Có thuộc tính không thuộc ngành hàng đã chọn.",
        );
      }

      if (
        catalogAttribute.triggerOptionId &&
        !selectedOptionIds.has(catalogAttribute.triggerOptionId)
      ) {
        throw new BadRequestException(
          `Thuộc tính "${catalogAttribute.displayName}" chưa được kích hoạt bởi lựa chọn cha.`,
        );
      }

      this.validateAttributeValue(submitted, catalogAttribute);
    }

    for (const catalogAttribute of catalogAttributes) {
      const isApplicable =
        !catalogAttribute.triggerOptionId ||
        selectedOptionIds.has(catalogAttribute.triggerOptionId);
      if (
        catalogAttribute.isRequired &&
        isApplicable &&
        !submittedById.has(catalogAttribute.id)
      ) {
        throw new BadRequestException(
          `Vui lòng nhập thuộc tính bắt buộc "${catalogAttribute.displayName}".`,
        );
      }
    }
  }

  // Bắt đúng kênh dữ liệu theo inputType và xác minh option vẫn thuộc attribute hiện tại.
  private validateAttributeValue(
    submitted: CreateSellerProductDto["attributes"][number],
    catalogAttribute: CatalogAttributeReference,
  ): void {
    const selectedIds = submitted.selectedOptionIds ?? [];
    const hasText = Boolean(submitted.valueText?.trim());
    const hasNumber = submitted.valueNumber !== undefined;
    const hasBoolean = submitted.valueBoolean !== undefined;

    if (SELECT_INPUT_TYPES.has(catalogAttribute.inputType)) {
      const activeOptions = new Set(
        (catalogAttribute.options ?? [])
          .filter((option) => option.isActive)
          .map((option) => option.id),
      );

      if (selectedIds.length === 0) {
        throw new BadRequestException(
          `Vui lòng chọn giá trị cho "${catalogAttribute.displayName}".`,
        );
      }

      this.assertUnique(
        selectedIds,
        `Thuộc tính "${catalogAttribute.displayName}" có lựa chọn bị trùng.`,
      );

      if (selectedIds.some((optionId) => !activeOptions.has(optionId))) {
        throw new BadRequestException(
          `Lựa chọn của "${catalogAttribute.displayName}" không còn hợp lệ.`,
        );
      }

      const limit =
        catalogAttribute.inputType === "SINGLE_SELECT"
          ? 1
          : catalogAttribute.maxSelections;
      if (limit && selectedIds.length > limit) {
        throw new BadRequestException(
          `Thuộc tính "${catalogAttribute.displayName}" chỉ cho phép chọn tối đa ${limit} giá trị.`,
        );
      }

      if (hasText || hasNumber || hasBoolean) {
        throw new BadRequestException(
          `Thuộc tính "${catalogAttribute.displayName}" phải gửi bằng option ID.`,
        );
      }
      return;
    }

    if (NUMBER_INPUT_TYPES.has(catalogAttribute.inputType) && !hasNumber) {
      throw new BadRequestException(
        `Thuộc tính "${catalogAttribute.displayName}" phải là số.`,
      );
    }

    if (catalogAttribute.inputType === "BOOLEAN" && !hasBoolean) {
      throw new BadRequestException(
        `Vui lòng chọn đúng hoặc sai cho "${catalogAttribute.displayName}".`,
      );
    }

    if (TEXT_INPUT_TYPES.has(catalogAttribute.inputType) && !hasText) {
      throw new BadRequestException(
        `Vui lòng nhập giá trị cho "${catalogAttribute.displayName}".`,
      );
    }

    const channelCount = [hasText, hasNumber, hasBoolean].filter(Boolean).length;
    if (selectedIds.length > 0 || channelCount !== 1) {
      throw new BadRequestException(
        `Giá trị của "${catalogAttribute.displayName}" không đúng định dạng.`,
      );
    }
  }

  // Bảo đảm các variant phủ đúng tích Descartes của tối đa hai nhóm phân loại.
  private validateOptionsAndVariants(dto: CreateSellerProductDto): void {
    const optionNames = dto.options.map((option) => option.name.trim().toLowerCase());
    const optionClientIds = dto.options.map((option) => option.clientId);
    this.assertUnique(optionNames, "Tên nhóm phân loại không được trùng nhau.");
    this.assertUnique(optionClientIds, "Mã tạm của nhóm phân loại bị trùng.");

    const valueToOption = new Map<string, string>();
    for (const option of dto.options) {
      this.assertUnique(
        option.values.map((value) => value.value.trim().toLowerCase()),
        `Giá trị trong nhóm "${option.name}" không được trùng nhau.`,
      );
      this.assertUnique(
        option.values.map((value) => value.clientId),
        `Mã tạm trong nhóm "${option.name}" bị trùng.`,
      );

      for (const value of option.values) {
        if (valueToOption.has(value.clientId)) {
          throw new BadRequestException(
            "Mã tạm của giá trị phân loại phải duy nhất trong toàn sản phẩm.",
          );
        }
        valueToOption.set(value.clientId, option.clientId);
      }
    }

    if (dto.options.length === 0) {
      if (
        dto.variants.length !== 1 ||
        dto.variants[0]!.optionValueClientIds.length !== 0
      ) {
        throw new BadRequestException(
          "Sản phẩm không có phân loại phải có đúng một variant mặc định.",
        );
      }
      return;
    }

    const expectedVariantCount = dto.options.reduce(
      (total, option) => total * option.values.length,
      1,
    );
    if (dto.variants.length !== expectedVariantCount) {
      throw new BadRequestException(
        `Danh sách variant phải có đủ ${expectedVariantCount} tổ hợp phân loại.`,
      );
    }

    const combinations = dto.variants.map((variant) => {
      if (variant.optionValueClientIds.length !== dto.options.length) {
        throw new BadRequestException(
          "Mỗi variant phải chọn đúng một giá trị ở từng nhóm phân loại.",
        );
      }

      const optionIds = variant.optionValueClientIds.map((valueId) => {
        const optionId = valueToOption.get(valueId);
        if (!optionId) {
          throw new BadRequestException(
            "Variant đang tham chiếu giá trị phân loại không tồn tại.",
          );
        }
        return optionId;
      });
      this.assertUnique(
        optionIds,
        "Một variant không thể chọn hai giá trị trong cùng nhóm phân loại.",
      );

      // Sắp theo thứ tự nhóm để hai tổ hợp giống nhau luôn sinh cùng một khóa so sánh.
      return dto.options
        .map((option) =>
          variant.optionValueClientIds.find(
            (valueId) => valueToOption.get(valueId) === option.clientId,
          ),
        )
        .join("|");
    });
    this.assertUnique(combinations, "Tổ hợp variant không được trùng nhau.");
  }

  // Kiểm tra GTIN, SKU và giá để lỗi nghiệp vụ được trả trước khi database báo constraint khó hiểu.
  private validateCommercialCodes(dto: CreateSellerProductDto): void {
    const gtins = [dto.gtin, ...dto.variants.map((variant) => variant.gtin)].filter(
      (value): value is string => Boolean(value),
    );
    if (gtins.some((gtin) => !GTIN_PATTERN.test(gtin))) {
      throw new BadRequestException("GTIN phải gồm 8, 12, 13 hoặc 14 chữ số.");
    }

    this.assertUnique(
      dto.variants
        .map((variant) => variant.sku?.trim().toLowerCase())
        .filter((sku): sku is string => Boolean(sku)),
      "SKU phân loại không được trùng trong cùng sản phẩm.",
    );

    for (const variant of dto.variants) {
      if (!variant.gtin && !variant.withoutGtin && !dto.gtin) {
        throw new BadRequestException(
          "Mỗi variant phải có GTIN hoặc được đánh dấu là không có GTIN.",
        );
      }
      if (variant.gtin && variant.withoutGtin) {
        throw new BadRequestException(
          "Variant đã có GTIN không thể đồng thời đánh dấu không có GTIN.",
        );
      }
      if (variant.originalPrice && variant.originalPrice < variant.price) {
        throw new BadRequestException(
          "Giá gốc của variant không được thấp hơn giá bán.",
        );
      }
    }
  }

  // Ném lỗi nghiệp vụ thống nhất khi một danh sách đáng lẽ là tập hợp lại chứa giá trị lặp.
  private assertUnique<T>(values: T[], message: string): void {
    if (new Set(values).size !== values.length) {
      throw new BadRequestException(message);
    }
  }
}
