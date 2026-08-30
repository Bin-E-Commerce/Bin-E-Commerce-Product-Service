// File này mô tả snapshot Product trả cho Order Service sau khi revalidate và reserve.

export interface CheckoutReservationResponse {
  reservationKey: string;
  items: CheckoutSnapshotItem[];
}

// Snapshot được lấy từ product database, không dùng dữ liệu Cart để quyết định giá.
export interface CheckoutSnapshotItem {
  productId: string;
  variantId: string;
  sellerShopId: string | null;
  sellerOwnerId: string | null;
  sku: string;
  productName: string;
  variantName: string;
  imageUrl: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}
