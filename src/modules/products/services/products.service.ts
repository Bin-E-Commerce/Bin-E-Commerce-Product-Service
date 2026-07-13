import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Brackets, Repository } from "typeorm";
import { Product } from "../../../database/entities/product.entity";
import { ListProductsQueryDto } from "../dto/list-products-query.dto";
import type { PaginatedResponse } from "../types/paginated-response.type";

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  // Lấy danh sách product với filter cơ bản để FE/public page và import verification dùng chung.
  async listProducts(
    query: ListProductsQueryDto,
  ): Promise<PaginatedResponse<Product>> {
    const page = query.page;
    const pageSize = query.pageSize;
    const qb = this.productRepository
      .createQueryBuilder("product")
      .leftJoinAndSelect("product.brand", "brand")
      .leftJoinAndSelect("product.externalShop", "externalShop")
      .leftJoinAndSelect("product.images", "images")
      .orderBy("product.createdAt", "DESC")
      .addOrderBy("images.sortOrder", "ASC")
      .skip((page - 1) * pageSize)
      .take(pageSize);

    if (query.categoryId) {
      qb.andWhere("product.categoryId = :categoryId", {
        categoryId: query.categoryId,
      });
    }

    if (query.sellerShopId) {
      qb.andWhere("product.sellerShopId = :sellerShopId", {
        sellerShopId: query.sellerShopId,
      });
    }

    if (query.externalShopId) {
      qb.andWhere("product.externalShopId = :externalShopId", {
        externalShopId: query.externalShopId,
      });
    }

    if (query.originType) {
      qb.andWhere("product.originType = :originType", {
        originType: query.originType,
      });
    }

    if (query.status) {
      qb.andWhere("product.status = :status", { status: query.status });
    }

    if (query.search?.trim()) {
      const keyword = `%${query.search.trim()}%`;
      // Tìm trên name/slug/source id để admin dễ kiểm tra product vừa import từ nguồn ngoài.
      qb.andWhere(
        new Brackets((builder) => {
          builder
            .where("product.name ILIKE :keyword", { keyword })
            .orWhere("product.slug ILIKE :keyword", { keyword })
            .orWhere("product.externalProductId ILIKE :keyword", { keyword });
        }),
      );
    }

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // Lấy chi tiết product theo UUID, bao gồm brand, shop nguồn, ảnh, variant, option và thông số.
  async getProductById(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: {
        brand: true,
        externalShop: true,
        images: true,
        variants: {
          inventory: true,
          optionChoices: {
            optionValue: {
              option: true,
            },
          },
        },
        options: {
          values: true,
        },
        attributeValues: true,
        reviews: true,
      },
      order: {
        images: { sortOrder: "ASC" },
        options: { position: "ASC", values: { position: "ASC" } },
      },
    });

    if (!product) {
      throw new NotFoundException("Không tìm thấy sản phẩm.");
    }

    return product;
  }
}
