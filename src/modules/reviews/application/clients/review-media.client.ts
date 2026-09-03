import { BadGatewayException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ReviewMediaReference } from "../types/review-media-reference.type";

@Injectable()
export class ReviewMediaClient {
  private readonly mediaServiceUrl: string;
  private readonly internalToken: string;

  // Đọc endpoint và service token từ config để cleanup review chỉ chạy giữa các service nội bộ.
  constructor(config: ConfigService) {
    this.mediaServiceUrl = config.get<string>(
      "MEDIA_SERVICE_URL",
      "http://localhost:3004",
    );
    this.internalToken = config.get<string>("INTERNAL_SERVICE_TOKEN", "");
  }

  // Gửi batch asset đã bị loại khỏi review; Media Service xử lý idempotent và giới hạn trong owner scope.
  async cleanupReviewAssets(
    userId: string,
    assets: ReviewMediaReference[],
  ): Promise<void> {
    if (assets.length === 0) return;

    const response = await fetch(
      `${this.mediaServiceUrl}/api/v1/media/assets/review/cleanup`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-internal-service-token": this.internalToken,
          "x-user-id": userId,
        },
        body: JSON.stringify({
          assets: assets.map(({ assetId, purpose }) => ({ assetId, purpose })),
        }),
        signal: AbortSignal.timeout(10_000),
      },
    ).catch(() => {
      throw new BadGatewayException("Không thể kết nối Media Service để dọn media review.");
    });

    if (!response.ok) {
      throw new BadGatewayException(
        `Media Service cleanup failed with status ${response.status}`,
      );
    }
  }
}
