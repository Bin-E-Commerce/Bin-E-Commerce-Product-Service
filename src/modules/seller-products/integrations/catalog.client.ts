import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  CatalogAttributeReference,
  CatalogCategoryReference,
} from "../types/catalog-reference.type";

@Injectable()
export class CatalogClient {
  private readonly catalogServiceUrl: string;

  // Giữ URL Catalog Service tập trung trong client để application service không phụ thuộc chi tiết HTTP.
  constructor(config: ConfigService) {
    this.catalogServiceUrl = config.get<string>(
      "CATALOG_SERVICE_URL",
      "http://localhost:3003",
    );
  }

  // Đọc category và bộ thuộc tính trong hai request song song nhằm giảm thời gian chờ của luồng tạo sản phẩm.
  async getProductCategoryContext(categoryId: string): Promise<{
    category: CatalogCategoryReference;
    attributes: CatalogAttributeReference[];
  }> {
    const [categoryResponse, attributeResponse] = await Promise.all([
      this.request(`/api/v1/categories/${categoryId}`),
      this.request(
        `/api/v1/categories/${categoryId}/attributes?includeOptions=true&includeConditional=true`,
      ),
    ]);

    if (categoryResponse.status === 404 || attributeResponse.status === 404) {
      throw new BadRequestException("Ngành hàng đã chọn không còn hợp lệ.");
    }

    if (!categoryResponse.ok || !attributeResponse.ok) {
      throw new BadGatewayException(
        "Catalog Service chưa thể xác minh ngành hàng lúc này.",
      );
    }

    return {
      category: (await categoryResponse.json()) as CatalogCategoryReference,
      attributes: (await attributeResponse.json()) as CatalogAttributeReference[],
    };
  }

  // Gọi Catalog Service với timeout ngắn để request tạo sản phẩm không treo khi service phụ thuộc gặp sự cố.
  private async request(path: string): Promise<Response> {
    return fetch(`${this.catalogServiceUrl}${path}`, {
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {
      throw new BadGatewayException(
        "Không thể kết nối Catalog Service. Vui lòng thử lại sau.",
      );
    });
  }
}
