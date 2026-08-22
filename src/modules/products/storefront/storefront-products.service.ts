import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Brackets, In, Repository } from "typeorm";
import { Product } from "../../../database/entities/product.entity";
import type { PaginatedProductResponse } from "../shared/types/paginated-product-response.type";
import { ListStorefrontProductsQueryDto } from "./dto/list-storefront-products-query.dto";

@Injectable()
export class StorefrontProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  // Lấy danh sách sản phẩm theo bộ lọc và phân trang để giao diện công khai và công cụ kiểm tra import dùng chung.
  async listStorefrontProducts(
    query: ListStorefrontProductsQueryDto,
  ): Promise<PaginatedProductResponse<Product>> {
    const page = query.page;
    const pageSize = query.pageSize;
    const qb = this.productRepository.createQueryBuilder("product");

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
      // Tìm trên tên, slug và ID nguồn để kiểm tra sản phẩm import mà không phụ thuộc một trường duy nhất.
      qb.andWhere(
        new Brackets((builder) => {
          builder
            .where("product.name ILIKE :keyword", { keyword })
            .orWhere("product.slug ILIKE :keyword", { keyword })
            .orWhere("product.externalProductId ILIKE :keyword", { keyword });
        }),
      );
    }

    // Chỉ phân trang trên bảng products vì JOIN trực tiếp với images sẽ khiến nhiều ảnh của
    // cùng một sản phẩm chiếm giới hạn trang và làm API trả thiếu sản phẩm.
    const [total, idRows] = await Promise.all([
      qb.clone().getCount(),
      qb
        .clone()
        .select("product.id", "id")
        .orderBy("product.createdAt", "DESC")
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .getRawMany<{ id: string }>(),
    ]);

    const productIds = idRows.map((row) => row.id);
    if (productIds.length === 0) {
      return {
        items: [],
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    }

    const items = await this.productRepository.find({
      where: { id: In(productIds) },
      relations: {
        brand: true,
        externalShop: true,
        images: true,
      },
    });

    // Repository.find không bảo toàn thứ tự của danh sách IN, vì vậy cần sắp xếp lại theo
    // thứ tự ID đã được phân trang và sắp xếp ảnh theo vị trí hiển thị của từng sản phẩm.
    const positionById = new Map(
      productIds.map((productId, index) => [productId, index]),
    );
    items.sort(
      (left, right) =>
        (positionById.get(left.id) ?? 0) - (positionById.get(right.id) ?? 0),
    );
    items.forEach((product) => {
      product.images.sort((left, right) => left.sortOrder - right.sortOrder);
    });

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // Lấy chi tiết sản phẩm theo UUID cùng toàn bộ quan hệ cần cho màn hình chi tiết.
  async getStorefrontProductById(id: string): Promise<Product> {
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
