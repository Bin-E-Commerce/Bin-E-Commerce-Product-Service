// Kiểm tra mapping catalog và giới hạn payload bằng repository giả; không cần database hoặc service nội bộ thật.
import { Product } from '@/database/catalog/entities/product.entity';
import { IsNull, Not } from 'typeorm';
import { ProductOriginType } from '@/database/catalog/enums/product-origin-type.enum';
import { ProductStatus } from '@/database/catalog/enums/product-status.enum';
import { ProductVariantStatus } from '@/database/catalog/enums/product-variant-status.enum';
import { TypeOrmInternalSellerProductCatalogRepository } from '@/modules/internal/infrastructure/repositories/typeorm-internal-seller-product-catalog.repository';

describe('TypeOrmInternalSellerProductCatalogRepository', () => {
    let mockProductRepository: { findAndCount: jest.Mock; find: jest.Mock };
    let target: TypeOrmInternalSellerProductCatalogRepository;

    // Mỗi ca dùng entity snapshot riêng để xác nhận mapper và scope không phụ thuộc trạng thái giữa các test.
    beforeEach(() => {
        mockProductRepository = {
            findAndCount: jest.fn(),
            find: jest.fn(),
        };
        target = new TypeOrmInternalSellerProductCatalogRepository(
            mockProductRepository as never,
        );
    });

    // Repository phải giữ đúng tenant và chỉ đọc catalog seller ACTIVE với giới hạn đã được application truyền xuống.
    it('maps product options, images, stock and reports truncated catalog data', async () => {
        // Arrange
        const product = {
            id: 'product-1',
            sellerShopId: 'shop-1',
            originType: ProductOriginType.INTERNAL,
            status: ProductStatus.ACTIVE,
            name: 'Áo khoác',
            shortDescription: null,
            description: 'Áo khoác thể thao.',
            totalSold: 12,
            images: [
                { isThumbnail: false, imageUrl: 'https://cdn.test/other.jpg' },
                { isThumbnail: true, imageUrl: 'https://cdn.test/main.jpg' },
            ],
            variants: [
                {
                    id: 'variant-m',
                    status: ProductVariantStatus.ACTIVE,
                    name: 'Đen / M',
                    sku: 'SKU-M',
                    sellerSku: 'SHOP-M',
                    price: '185000.00',
                    originalPrice: null,
                    stockQuantity: 9,
                    imageUrl: null,
                    images: [],
                    inventory: {
                        quantityAvailable: 7,
                        quantityReserved: 2,
                        quantitySold: 4,
                        lowStockThreshold: 5,
                    },
                    optionChoices: [
                        {
                            optionValue: {
                                value: 'M',
                                option: { name: 'Size', position: 2 },
                            },
                        },
                        {
                            optionValue: {
                                value: 'Đen',
                                option: { name: 'Màu sắc', position: 1 },
                            },
                        },
                    ],
                },
                {
                    id: 'variant-l',
                    status: ProductVariantStatus.ACTIVE,
                    name: 'Đen / L',
                    sku: 'SKU-L',
                    sellerSku: null,
                    price: '185000.00',
                    originalPrice: null,
                    stockQuantity: 6,
                    imageUrl: null,
                    images: [],
                    inventory: null,
                    optionChoices: [],
                },
                {
                    id: 'variant-inactive',
                    status: ProductVariantStatus.INACTIVE,
                    name: 'Đen / XL',
                    sku: 'SKU-XL',
                },
            ],
        } as unknown as Product;
        mockProductRepository.findAndCount.mockResolvedValue([[product], 21]);
        mockProductRepository.find.mockResolvedValue([product]);

        // Act
        const result = await target.getSellerCatalog(
            'shop-1',
            'owner-1',
            20,
            1,
        );

        // Assert
        expect(mockProductRepository.findAndCount).toHaveBeenCalledWith(
            expect.objectContaining({
                where: [
                    {
                        sellerShopId: 'shop-1',
                        originType: ProductOriginType.INTERNAL,
                        status: Not(ProductStatus.DELETED),
                    },
                    {
                        sellerShopId: IsNull(),
                        sellerOwnerId: 'owner-1',
                        originType: ProductOriginType.INTERNAL,
                        status: Not(ProductStatus.DELETED),
                    },
                ],
                order: { updatedAt: 'DESC', id: 'ASC' },
                take: 20,
            }),
        );
        expect(mockProductRepository.find).toHaveBeenCalledWith(
            expect.objectContaining({
                where: [
                    expect.objectContaining({
                        id: expect.anything(),
                        sellerShopId: 'shop-1',
                    }),
                    expect.objectContaining({
                        id: expect.anything(),
                        sellerOwnerId: 'owner-1',
                    }),
                ],
                relations: expect.objectContaining({
                    variants: expect.anything(),
                }),
            }),
        );
        expect(result).toEqual({
            items: [
                {
                    productId: 'product-1',
                    isShopLinked: true,
                    name: 'Áo khoác',
                    description: 'Áo khoác thể thao.',
                    fullDescription: 'Áo khoác thể thao.',
                    shortDescription: null,
                    thumbnailUrl: 'https://cdn.test/main.jpg',
                    imageCount: 2,
                    hasThumbnail: true,
                    status: ProductStatus.ACTIVE,
                    totalSold: 12,
                    availableTotal: 13,
                    variants: [
                        {
                            variantId: 'variant-m',
                            name: 'Đen / M',
                            sku: 'SKU-M',
                            sellerSku: 'SHOP-M',
                            options: [
                                { name: 'Màu sắc', value: 'Đen' },
                                { name: 'Size', value: 'M' },
                            ],
                            price: 185000,
                            originalPrice: null,
                            available: 7,
                            reserved: 2,
                            quantitySold: 4,
                            lowStockThreshold: 5,
                            thumbnailUrl: 'https://cdn.test/main.jpg',
                        },
                    ],
                    variantCount: 2,
                    hasMoreVariants: true,
                },
            ],
            totalCount: 21,
            hasMore: true,
        });
    });

    // Phân trang được áp ở product IDs trước khi join relation để không làm rơi sản phẩm có nhiều ảnh/biến thể.
    it('keeps every product in the selected page when relations are loaded separately', async () => {
        const products = ['p1', 'p2', 'p3', 'p4'].map(
            (id) =>
                ({
                    id,
                    name: `Sản phẩm ${id}`,
                    shortDescription: null,
                    description: null,
                    images: [],
                    variants: [],
                    totalSold: 0,
                    status: ProductStatus.ACTIVE,
                }) as unknown as Product,
        );
        mockProductRepository.findAndCount.mockResolvedValue([products, 4]);
        mockProductRepository.find.mockResolvedValue(products);

        const result = await target.getSellerCatalog(
            'shop-1',
            'owner-1',
            20,
            100,
        );

        expect(result.items.map((item) => item.productId)).toEqual([
            'p1',
            'p2',
            'p3',
            'p4',
        ]);
        expect(result.totalCount).toBe(4);
        expect(result.hasMore).toBe(false);
    });
});
