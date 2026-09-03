// File này gọi internal Order API để xác minh purchase proof; Product Service không truy vấn database của Order Service.

import { BadGatewayException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ReviewItemProof, ReviewOrderContext } from "../types/review-order-context.type";

@Injectable()
export class OrderReviewClient {
  private readonly targetBase: string;
  private readonly internalToken: string;

  // Đọc URL và shared token từ config để local/Docker dùng cùng contract mà không lộ credential ra browser.
  constructor(config: ConfigService) {
    this.targetBase = config.get<string>("ORDER_SERVICE_URL", "http://localhost:3011");
    this.internalToken = config.get<string>("INTERNAL_SERVICE_TOKEN", "");
  }

  // Lấy proof của một item rồi map lỗi upstream thành lỗi nghiệp vụ phù hợp với API review.
  async getItemProof(orderItemId: string): Promise<ReviewItemProof> {
    const response = await this.request(`/api/v1/internal/orders/items/${orderItemId}/review-context`);
    if (response.status === 404) throw new NotFoundException("Không tìm thấy sản phẩm trong đơn hàng.");
    if (!response.ok) throw new BadGatewayException("Không thể xác minh đơn hàng lúc này.");
    return (await response.json()) as ReviewItemProof;
  }

  // Lấy context toàn bộ order theo owner để UI biết item nào đã review và item nào còn đủ điều kiện.
  async getOrderContext(orderId: string, ownerId: string): Promise<ReviewOrderContext> {
    const response = await this.request(`/api/v1/internal/orders/${orderId}/review-context`, { "x-user-id": ownerId });
    if (response.status === 404) throw new NotFoundException("Không tìm thấy đơn hàng.");
    if (response.status === 401 || response.status === 403) throw new ForbiddenException("Bạn không có quyền xem review của đơn hàng này.");
    if (!response.ok) throw new BadGatewayException("Không thể xác minh đơn hàng lúc này.");
    return (await response.json()) as ReviewOrderContext;
  }

  // Gửi request kèm service token; endpoint chỉ nhận dữ liệu tối thiểu cần cho purchase proof.
  private request(path: string, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${this.targetBase}${path}`, {
      headers: {
        accept: "application/json",
        "x-internal-service-token": this.internalToken,
        ...headers,
      },
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {
      throw new BadGatewayException("Không thể kết nối Order Service.");
    });
  }
}
