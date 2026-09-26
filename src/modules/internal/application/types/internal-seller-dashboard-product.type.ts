// Contract read-only cho dashboard seller; Product Service chỉ trả product thuộc shop được truyền vào.

export interface InternalSellerDashboardProductSummary {
    activeProducts: number;
    outOfStockProducts: number;
}

export interface InternalSellerDashboardProductItem {
    productId: string;
    name: string;
    thumbnailUrl: string | null;
    quantitySold: number;
    revenue: number | null;
    stock: number;
}

export interface InternalSellerDashboardProductSnapshot {
    summary: InternalSellerDashboardProductSummary;
    topProducts: InternalSellerDashboardProductItem[];
}
