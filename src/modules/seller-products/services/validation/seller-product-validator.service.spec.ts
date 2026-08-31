// File này kiểm thử các business rule dùng chung khi validate product payload của seller.
import { BadRequestException } from "@nestjs/common";
import { CreateSellerProductDto } from "../../dto/create-product/create-seller-product.dto";
import { ProductCondition } from "../../../../database/catalog/enums/product-condition.enum";
import { ProductStatus } from "../../../../database/catalog/enums/product-status.enum";
import type {
  CatalogAttributeReference,
  CatalogCategoryReference,
} from "../../types/catalog-reference.type";
import { SellerProductValidatorService } from "./seller-product-validator.service";

const CATEGORY_ID = "2db6903a-9488-4df0-b54c-b38329d5fb87";
const ATTRIBUTE_ID = "a13082f8-10bc-46ca-b064-a45260cfccf3";
const OPTION_ID = "b24093a9-21cd-57db-b175-b56371d0ab84";

// Tạo payload hợp lệ tối thiểu để mỗi test chỉ cần thay đổi đúng rule đang kiểm tra.
function createValidPayload(): CreateSellerProductDto {
  return {
    name: "Sản phẩm kiểm thử hợp lệ chính hãng",
    categoryId: CATEGORY_ID,
    description:
      "Mô tả sản phẩm đủ dài để vượt qua kiểm tra dữ liệu đầu vào.",
    condition: ProductCondition.NEW,
    status: ProductStatus.DRAFT,
    images: [
      {
        imageUrl: "https://cdn.example.com/product.webp",
        sortOrder: 0,
        isThumbnail: true,
      },
      {
        imageUrl: "https://cdn.example.com/product-detail.webp",
        sortOrder: 1,
        isThumbnail: false,
      },
    ],
    attributes: [],
    options: [],
    variants: [
      {
        optionValueClientIds: [],
        withoutGtin: true,
        price: 150_000,
        stockQuantity: 10,
      },
    ],
    package: {
      weightGrams: 500,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
    },
  };
}

// Mô phỏng category cuối đang hoạt động do Catalog Service trả về.
function createValidCategory(): CatalogCategoryReference {
  return {
    id: CATEGORY_ID,
    name: "Danh mục kiểm thử",
    path: "Danh mục gốc > Danh mục kiểm thử",
    isLeaf: true,
    isActive: true,
  };
}

describe("SellerProductValidatorService", () => {
  let target: SellerProductValidatorService;

  beforeEach(() => {
    target = new SellerProductValidatorService();
  });

  it("accepts a valid product with one default variant", () => {
    // Arrange: sản phẩm không có nhóm phân loại và có một SKU mặc định.
    const payload = createValidPayload();

    // Act/Assert: payload hợp lệ phải đi qua toàn bộ business validator.
    expect(() => target.validate(payload, createValidCategory(), [])).not.toThrow();
  });

  it("rejects an inactive or non-leaf category", () => {
    // Arrange: category cha không thể được gắn trực tiếp cho sản phẩm.
    const payload = createValidPayload();
    const category = { ...createValidCategory(), isLeaf: false };

    // Act/Assert: chỉ category lá đang hoạt động mới hợp lệ.
    expect(() => target.validate(payload, category, [])).toThrow(
      BadRequestException,
    );
  });

  it("requires at least two images and exactly one thumbnail", () => {
    // Arrange: bỏ ảnh phụ để vi phạm mức tối thiểu của gallery.
    const payload = createValidPayload();
    payload.images = [payload.images[0]!];

    // Act/Assert: không đủ ảnh phải bị chặn trước khi lưu product.
    expect(() => target.validate(payload, createValidCategory(), [])).toThrow(
      BadRequestException,
    );

    // Arrange lại: có đủ ảnh nhưng cả hai đều bị đánh dấu thumbnail.
    payload.images = payload.images.concat({
      imageUrl: "https://cdn.example.com/another.webp",
      sortOrder: 1,
      isThumbnail: true,
    });

    // Act/Assert: gallery chỉ được có đúng một ảnh đại diện.
    expect(() => target.validate(payload, createValidCategory(), [])).toThrow(
      BadRequestException,
    );
  });

  it("rejects a video outside the supported duration", () => {
    // Arrange: video dài hơn giới hạn 60 giây.
    const payload = createValidPayload();
    payload.video = {
      assetId: OPTION_ID,
      videoUrl: "https://cdn.example.com/product.mp4",
      durationSeconds: 61,
    };

    // Act/Assert: video không hợp lệ không được đi vào product graph.
    expect(() => target.validate(payload, createValidCategory(), [])).toThrow(
      BadRequestException,
    );
  });

  it("rejects a missing required catalog attribute", () => {
    // Arrange: Catalog Service khai báo thuộc tính bắt buộc nhưng seller chưa nhập.
    const payload = createValidPayload();
    const attributes: CatalogAttributeReference[] = [
      {
        id: ATTRIBUTE_ID,
        displayName: "Xuất xứ",
        inputType: "TEXT",
        isRequired: true,
        maxSelections: null,
        parentAttributeId: null,
        triggerOptionId: null,
      },
    ];

    // Act/Assert: validator phải chặn dữ liệu thiếu trước khi gọi repository.
    expect(() => target.validate(payload, createValidCategory(), attributes)).toThrow(
      BadRequestException,
    );
  });

  it("accepts an active option id for a select catalog attribute", () => {
    // Arrange: option id phải là UUID đang tồn tại và còn hoạt động trong catalog.
    const payload = createValidPayload();
    payload.attributes = [
      {
        categoryAttributeId: ATTRIBUTE_ID,
        selectedOptionIds: [OPTION_ID],
      },
    ];
    const attributes: CatalogAttributeReference[] = [
      {
        id: ATTRIBUTE_ID,
        displayName: "Màu sắc",
        inputType: "SINGLE_SELECT",
        isRequired: true,
        maxSelections: 1,
        parentAttributeId: null,
        triggerOptionId: null,
        options: [
          {
            id: OPTION_ID,
            value: "Đen",
            displayValue: "Đen",
            isActive: true,
          },
        ],
      },
    ];

    // Act/Assert: option UUID hợp lệ phải được chấp nhận.
    expect(() => target.validate(payload, createValidCategory(), attributes)).not.toThrow();
  });

  it("rejects an incomplete option combination matrix", () => {
    // Arrange: hai nhóm có 2 giá trị tạo thành 4 tổ hợp, nhưng payload chỉ có 1 variant.
    const payload = createValidPayload();
    payload.options = [
      {
        clientId: "color",
        name: "Màu sắc",
        position: 0,
        values: [
          { clientId: "black", value: "Đen", position: 0 },
          { clientId: "white", value: "Trắng", position: 1 },
        ],
      },
      {
        clientId: "size",
        name: "Kích cỡ",
        position: 1,
        values: [
          { clientId: "small", value: "S", position: 0 },
          { clientId: "large", value: "L", position: 1 },
        ],
      },
    ];
    payload.variants = [
      {
        optionValueClientIds: ["black", "small"],
        withoutGtin: true,
        price: 150_000,
        stockQuantity: 10,
      },
    ];

    // Act/Assert: thiếu tổ hợp SKU sẽ làm dữ liệu hiển thị và tồn kho không nhất quán.
    expect(() => target.validate(payload, createValidCategory(), [])).toThrow(
      BadRequestException,
    );
  });

  it("rejects an invalid GTIN and an original price below the sale price", () => {
    // Arrange: GTIN phải có đúng độ dài thương mại được hỗ trợ.
    const invalidGtinPayload = createValidPayload();
    invalidGtinPayload.gtin = "12345";

    // Act/Assert: mã định danh không hợp lệ bị chặn ngay ở tầng nghiệp vụ.
    expect(() =>
      target.validate(invalidGtinPayload, createValidCategory(), []),
    ).toThrow(BadRequestException);

    // Arrange: giá gốc thấp hơn giá bán tạo ra dữ liệu hiển thị sai.
    const invalidPricePayload = createValidPayload();
    invalidPricePayload.variants[0]!.originalPrice = 100_000;

    // Act/Assert: giá gốc phải lớn hơn hoặc bằng giá bán.
    expect(() =>
      target.validate(invalidPricePayload, createValidCategory(), []),
    ).toThrow(BadRequestException);
  });
});
