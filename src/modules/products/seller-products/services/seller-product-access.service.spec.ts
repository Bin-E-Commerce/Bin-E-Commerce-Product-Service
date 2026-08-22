import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Permission } from "@common/auth";
import type { SellerProductUserContext } from "../types/seller-product-user-context.type";
import { SellerProductAccessService } from "./seller-product-access.service";

describe("SellerProductAccessService", () => {
  let target: SellerProductAccessService;

  beforeEach(() => {
    target = new SellerProductAccessService();
  });

  it("builds a seller context from gateway headers", () => {
    // Arrange: API Gateway truyền permission dạng chuỗi phân tách bằng dấu phẩy.
    const headers = {
      "x-user-id": "seller-user-id",
      "x-user-email": "seller@bin.local",
      "x-user-permissions": `seller.access, ${Permission.SELLER_PRODUCT_READ}, ,`,
    };

    // Act: chuyển các header tin cậy thành context dùng trong Product Service.
    const result = target.buildCurrentUserFromHeaders(headers);

    // Assert: khoảng trắng và phần tử rỗng không được lọt vào danh sách quyền.
    expect(result).toEqual({
      userId: "seller-user-id",
      email: "seller@bin.local",
      permissions: ["seller.access", Permission.SELLER_PRODUCT_READ],
    });
  });

  it("uses the first value when a proxy header is repeated", () => {
    // Arrange: Node có thể biểu diễn header lặp dưới dạng mảng giá trị.
    const headers = {
      "x-user-id": ["seller-user-id", "forged-user-id"],
      "x-user-email": ["seller@bin.local", "forged@bin.local"],
      "x-user-permissions": [Permission.SELLER_PRODUCT_READ, "admin.access"],
    };

    // Act: đọc context từ header đã được API Gateway chuyển tiếp.
    const result = target.buildCurrentUserFromHeaders(headers);

    // Assert: service chỉ sử dụng giá trị đầu tiên của mỗi header lặp.
    expect(result).toEqual({
      userId: "seller-user-id",
      email: "seller@bin.local",
      permissions: [Permission.SELLER_PRODUCT_READ],
    });
  });

  it("rejects product reads without an authenticated user", () => {
    // Arrange: request không có user id nhưng vẫn có permission.
    const currentUser: SellerProductUserContext = {
      userId: "",
      email: "seller@bin.local",
      permissions: [Permission.SELLER_PRODUCT_READ],
    };

    // Act/Assert: thiếu danh tính phải trả 401 trước khi kiểm tra permission.
    expect(() => target.ensureCanReadProducts(currentUser)).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects product reads when the permission is missing", () => {
    // Arrange: user đã đăng nhập nhưng chỉ có quyền truy cập seller chung.
    const currentUser: SellerProductUserContext = {
      userId: "seller-user-id",
      email: "seller@bin.local",
      permissions: ["seller.access"],
    };

    // Act/Assert: quyền cấp rộng không tự động thay thế quyền đọc sản phẩm.
    expect(() => target.ensureCanReadProducts(currentUser)).toThrow(
      ForbiddenException,
    );
  });

  it("returns the authenticated context when product read is allowed", () => {
    // Arrange: user có đầy đủ danh tính và permission đọc sản phẩm.
    const currentUser: SellerProductUserContext = {
      userId: "seller-user-id",
      email: "seller@bin.local",
      permissions: [Permission.SELLER_PRODUCT_READ],
    };

    // Act: kiểm tra quyền đọc danh sách sản phẩm.
    const result = target.ensureCanReadProducts(currentUser);

    // Assert: giữ nguyên context để lớp gọi tiếp tục lọc theo seller.
    expect(result).toBe(currentUser);
  });

  it("rejects product creation when the create permission is missing", () => {
    // Arrange: user chỉ được đọc sản phẩm, không được tạo sản phẩm.
    const currentUser: SellerProductUserContext = {
      userId: "seller-user-id",
      email: "seller@bin.local",
      permissions: [Permission.SELLER_PRODUCT_READ],
    };

    // Act/Assert: read và create là hai capability độc lập.
    expect(() => target.ensureCanCreateProduct(currentUser)).toThrow(
      ForbiddenException,
    );
  });

  it("returns the authenticated context when product creation is allowed", () => {
    // Arrange: user có permission tạo sản phẩm.
    const currentUser: SellerProductUserContext = {
      userId: "seller-user-id",
      email: "seller@bin.local",
      permissions: [Permission.SELLER_PRODUCT_CREATE],
    };

    // Act: kiểm tra capability tạo sản phẩm.
    const result = target.ensureCanCreateProduct(currentUser);

    // Assert: context hợp lệ được trả lại cho service tạo sản phẩm.
    expect(result).toBe(currentUser);
  });
});
