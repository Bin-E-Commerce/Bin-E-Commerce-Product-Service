// Contract read-only cho dashboard seller; Product Service chỉ trả product thuộc shop được truyền vào.

export interface InternalSellerDashboardProductSummary {
    catalogProducts: number;
    activeProducts: number;
    inStockProducts: number;
    stockUnits: number;
    outOfStockProducts: number;
}

export interface InternalSellerDashboardProductSnapshot {
    summary: InternalSellerDashboardProductSummary;
}
