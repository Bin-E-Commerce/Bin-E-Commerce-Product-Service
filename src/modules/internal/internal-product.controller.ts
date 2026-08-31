// Controller này cung cấp các thông tin sản phẩm tối thiểu cho service nội bộ.
// Controller chỉ phục vụ các business guard liên service và không chứa nghiệp vụ quản lý sản phẩm.

import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Product } from "../../database/catalog/entities/product.entity";
import { ProductOriginType } from "../../database/catalog/enums/product-origin-type.enum";
import { ProductStatus } from "../../database/catalog/enums/product-status.enum";
import { InternalServiceGuard } from "../checkout/guards/internal-service.guard";

// Internal endpoint chỉ trả số liệu tối thiểu, không trả dữ liệu sản phẩm hoặc thông tin của shop khác.
@Controller("internal/products")
@UseGuards(InternalServiceGuard)
export class InternalProductController {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  // Seller Service dùng số lượng này để bảo vệ địa chỉ mặc định đang phục vụ sản phẩm ACTIVE.
  @Get("shops/:shopId/active-count")
  async getActiveProductCount(
    @Param("shopId", new ParseUUIDPipe()) shopId: string,
  ): Promise<{ shopId: string; activeProductCount: number }> {
    const activeProductCount = await this.productRepository.count({
      where: {
        sellerShopId: shopId,
        originType: ProductOriginType.INTERNAL,
        status: ProductStatus.ACTIVE,
      },
    });

    return { shopId, activeProductCount };
  }
}
