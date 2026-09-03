import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ProductMediaReference } from "../types/product-media-reference.type";

@Injectable()
export class ProductMediaClient {
  private readonly mediaServiceUrl: string;

  // Giữ URL Media Service trong client để luồng cập nhật sản phẩm không phụ thuộc chi tiết discovery/HTTP.
  constructor(config: ConfigService) {
    this.mediaServiceUrl = config.get<string>(
      "MEDIA_SERVICE_URL",
      "http://localhost:3004",
    );
  }

  // Gửi một batch asset đã bị bỏ liên kết sau commit; endpoint idempotent nên retry không làm xóa nhầm dữ liệu mới.
  async cleanupProductAssets(
    userId: string,
    assets: ProductMediaReference[],
  ): Promise<void> {
    if (assets.length === 0) return;

    const response = await fetch(
      `${this.mediaServiceUrl}/api/v1/media/assets/product/cleanup`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": userId,
        },
        body: JSON.stringify({ assets }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new Error(`Media Service cleanup failed with status ${response.status}`);
    }
  }
}
