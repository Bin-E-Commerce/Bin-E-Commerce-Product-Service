import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { SellerProductUserContext } from "../types/seller-product-user-context.type";
import type { SellerShopProfileReference } from "../types/seller-shop-reference.type";

@Injectable()
export class SellerShopClient {
  private readonly sellerServiceUrl: string;

  // Đọc URL một lần khi khởi tạo để mọi request nội bộ dùng cùng cấu hình triển khai.
  constructor(config: ConfigService) {
    this.sellerServiceUrl = config.get<string>(
      "SELLER_SERVICE_URL",
      "http://localhost:3007",
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
}
