import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

@Injectable()
export class ProductIdentifierService {
  // Tạo slug đọc được và thêm hậu tố ngẫu nhiên để hai shop có thể dùng cùng tên sản phẩm mà không xung đột URL.
  createSlug(name: string): string {
    const normalizedName = name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 180);

    return `${normalizedName || "san-pham"}-${randomUUID().slice(0, 8)}`;
  }

  // Sinh SKU hệ thống toàn cục; sellerSku được lưu riêng nên người bán vẫn giữ được mã quản trị quen thuộc.
  createSystemSku(shopId: string): string {
    return `BIN-${shopId.slice(0, 8).toUpperCase()}-${randomUUID()
      .replace(/-/g, "")
      .slice(0, 12)
      .toUpperCase()}`;
  }
}
