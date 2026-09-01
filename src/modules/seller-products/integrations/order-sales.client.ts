// Client này đọc thống kê đơn hàng lịch sử từ Order Service để seller không bị mất lượt bán cũ.

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

interface SoldQuantityRow {
  productId: string;
  quantitySold: number;
}

@Injectable()
export class OrderSalesClient {
  private readonly logger = new Logger(OrderSalesClient.name);
  private readonly targetBase: string;
  private readonly internalToken: string;

  // Đọc URL và shared token một lần để mọi môi trường dùng cùng contract nội bộ.
  constructor(config: ConfigService) {
    this.targetBase = config.get<string>("ORDER_SERVICE_URL", "http://localhost:3011");
    this.internalToken = config.get<string>("INTERNAL_SERVICE_TOKEN", "");
  }

  // Trả null khi Order Service tạm thời không sẵn sàng để Product Service vẫn phục vụ bằng counter cục bộ.
  async getSoldQuantities(
    sellerOwnerId: string,
    productIds: string[],
  ): Promise<Map<string, number> | null> {
    if (!sellerOwnerId || productIds.length === 0) return new Map();

    const query = new URLSearchParams({
      sellerOwnerId,
      productIds: productIds.join(","),
    });

    try {
      const response = await fetch(
        `${this.targetBase}/api/v1/internal/orders/sales?${query.toString()}`,
        {
          headers: {
            accept: "application/json",
            "x-internal-service-token": this.internalToken,
          },
          signal: AbortSignal.timeout(5_000),
        },
      );

      if (!response.ok) {
        this.logger.warn(`Order Service sales query failed with status ${response.status}`);
        return null;
      }

      const rows = (await response.json()) as SoldQuantityRow[];
      return new Map(rows.map((row) => [row.productId, Number(row.quantitySold)]));
    } catch (error) {
      this.logger.warn(`Order Service sales query unavailable: ${String(error)}`);
      return null;
    }
  }
}
