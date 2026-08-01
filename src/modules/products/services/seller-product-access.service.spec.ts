import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Permission } from "@common/auth";
import { SellerProductAccessService } from "./seller-product-access.service";

describe("SellerProductAccessService", () => {
  let service: SellerProductAccessService;

  beforeEach(() => {
    service = new SellerProductAccessService();
  });

  it("should build trusted seller context from gateway headers", () => {
    // Sắp xếp
    const headers = {
      "x-user-id": "seller-user-id",
      "x-user-email": "seller@bin.local",
      "x-user-permissions": `seller.access,${Permission.SELLER_PRODUCT_READ}`,
    };

    // Thực thi
    const result = service.buildCurrentUserFromHeaders(headers);

    // Kiểm tra
    expect(result).toEqual({
      userId: "seller-user-id",
      email: "seller@bin.local",
      permissions: ["seller.access", Permission.SELLER_PRODUCT_READ],
    });
  });

  it("should reject an unauthenticated internal request", () => {
    // Sắp xếp
    const currentUser = {
      userId: "",
      email: "",
      permissions: [Permission.SELLER_PRODUCT_READ],
    };

    // Thực thi và kiểm tra
    expect(() => service.ensureCanReadProducts(currentUser)).toThrow(
      UnauthorizedException,
    );
  });

  it("should reject a seller after product read permission is revoked", () => {
    // Sắp xếp
    const currentUser = {
      userId: "seller-user-id",
      email: "seller@bin.local",
      permissions: ["seller.access"],
    };

    // Thực thi và kiểm tra
    expect(() => service.ensureCanReadProducts(currentUser)).toThrow(
      ForbiddenException,
    );
  });

  it("should return the owner context when product read permission is active", () => {
    // Sắp xếp
    const currentUser = {
      userId: "seller-user-id",
      email: "seller@bin.local",
      permissions: [Permission.SELLER_PRODUCT_READ],
    };

    // Thực thi
    const result = service.ensureCanReadProducts(currentUser);

    // Kiểm tra
    expect(result).toBe(currentUser);
  });
});
