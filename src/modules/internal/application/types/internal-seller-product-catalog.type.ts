// Read model catalog dành cho Seller Copilot; bỏ sản phẩm đã xóa nhưng giữ status để phân biệt vòng đời catalog.
// Contract không xuất entity ORM hay dữ liệu của shop khác qua ranh giới service nội bộ.

export interface InternalSellerProductCatalogOption {
    name: string;
    value: string;
}

export interface InternalSellerProductCatalogVariant {
    variantId: string;
    name: string;
    sku: string;
    sellerSku: string | null;
    options: InternalSellerProductCatalogOption[];
    price: number;
    originalPrice: number | null;
    available: number;
    reserved: number;
    quantitySold: number;
    lowStockThreshold: number;
    thumbnailUrl: string | null;
}

export interface InternalSellerProductCatalogItem {
    productId: string;
    isShopLinked: boolean;
    name: string;
    description: string | null;
    fullDescription?: string | null;
    shortDescription?: string | null;
    imageCount?: number;
    hasThumbnail?: boolean;
    thumbnailUrl: string | null;
    status: string;
    totalSold: number;
    availableTotal: number;
    variants: InternalSellerProductCatalogVariant[];
    variantCount: number;
    hasMoreVariants: boolean;
}

export interface InternalSellerProductCatalogSnapshot {
    items: InternalSellerProductCatalogItem[];
    totalCount: number;
    hasMore: boolean;
}
