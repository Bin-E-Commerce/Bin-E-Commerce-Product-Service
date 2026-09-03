//
// Client nội bộ xác minh shop và điều kiện giao nhận trước các nghiệp vụ sản phẩm.
//
import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { SellerProductUserContext } from "../types/seller-product-user-context.type";
import type { SellerShopProfileReference } from "../types/seller-shop-reference.type";

export interface SellerShippingReadiness {
  ready: boolean;
  reason:
    | "READY"
    | "NO_PICKUP_ADDRESS"
    | "NO_DEFAULT_PICKUP_ADDRESS"
    | "INCOMPLETE_PICKUP_ADDRESS"
    | "SHIPPING_DISABLED";
}

@Injectable()
export class SellerShopClient {
  private readonly sellerServiceUrl: string;
  private readonly internalServiceToken: string;

  // Đọc URL một lần khi khởi tạo để mọi request nội bộ dùng cùng cấu hình triển khai.
  constructor(config: ConfigService) {
    this.sellerServiceUrl = config.get<string>(
      "SELLER_SERVICE_URL",
      "http://localhost:3007",
    );
    this.internalServiceToken = config.get<string>(
      "INTERNAL_SERVICE_TOKEN",
      "dev-media-auth-internal-secret",
    );
  }

  // Lấy shop từ chính user đã được Gateway xác thực, không nhận shopId do trình duyệt truyền lên.
  async getOwnedActiveShop(
    currentUser: SellerProductUserContext,
  ): Promise<SellerShopProfileReference> {
    const response = await fetch(
      `${this.sellerServiceUrl}/api/v1/seller/shop/profile`,
      {
        headers: {
          "x-user-id": currentUser.userId,
          "x-user-email": currentUser.email,
          "x-user-permissions": currentUser.permissions.join(","),
        },
        signal: AbortSignal.timeout(5_000),
      },
    ).catch(() => {
      throw new BadGatewayException(
        "Không thể xác minh shop lúc này. Vui lòng thử lại sau.",
      );
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw new ForbiddenException(
          "Tài khoản chưa có shop hợp lệ để đăng sản phẩm.",
        );
      }

      throw new BadGatewayException(
        "Seller Service chưa thể xác minh shop lúc này.",
      );
    }

    const profile = (await response.json()) as SellerShopProfileReference;
    if (profile.shop.status !== "active") {
      throw new ForbiddenException(
        "Shop phải ở trạng thái hoạt động trước khi thêm sản phẩm.",
      );
    }

    return profile;
  }

  // Gọi endpoint nội bộ sau khi đã resolve shop theo user để không cho trình duyệt tự truyền shopId giả.
  async assertShippingReady(shopId: string): Promise<void> {
    const response = await fetch(
      `${this.sellerServiceUrl}/api/v1/internal/seller/shops/${shopId}/shipping-readiness`,
      {
        headers: { "x-internal-service-token": this.internalServiceToken },
        signal: AbortSignal.timeout(5_000),
      },
    ).catch(() => {
      throw new BadGatewayException(
        "Không thể xác minh cấu hình giao nhận lúc này. Vui lòng thử lại sau.",
      );
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw new ForbiddenException(
          "Không thể xác minh cấu hình giao nhận của shop.",
        );
      }

      throw new BadGatewayException(
        "Seller Service chưa thể xác minh cấu hình giao nhận lúc này.",
      );
    }

    const readiness = (await response.json()) as SellerShippingReadiness;
    if (!readiness.ready) {
      throw new ConflictException({
        code: "SHIPPING_SETUP_REQUIRED",
        message: "Shop cần hoàn tất Thiết lập giao nhận trước khi đăng bán sản phẩm.",
        redirectTo: "/seller/shipping/settings",
        reason: readiness.reason,
      });
    }
  }
}
