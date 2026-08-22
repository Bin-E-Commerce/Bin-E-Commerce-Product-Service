import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Brand } from "../../../database/entities/brand.entity";
import type { PaginatedProductResponse } from "../shared/types/paginated-product-response.type";
import { ListBrandsQueryDto } from "./dto/list-brands-query.dto";

@Injectable()
export class BrandsService {
  constructor(
    @InjectRepository(Brand)
    private readonly brandRepository: Repository<Brand>,
  ) {}

  // Trả danh sách brand đang hoạt động để combobox tải theo trang thay vì đưa toàn bộ dữ liệu xuống trình duyệt.
  async list(
    query: ListBrandsQueryDto,
  ): Promise<PaginatedProductResponse<Brand>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;
    const builder = this.brandRepository
      .createQueryBuilder("brand")
      .where("brand.isActive = :isActive", { isActive: true });

    if (query.search?.trim()) {
      builder.andWhere(
        "(LOWER(brand.name) LIKE :keyword OR LOWER(COALESCE(brand.normalizedName, '')) LIKE :keyword)",
        { keyword: `%${query.search.trim().toLowerCase()}%` },
      );
    }

    const [items, total] = await builder
      .orderBy("brand.name", "ASC")
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
