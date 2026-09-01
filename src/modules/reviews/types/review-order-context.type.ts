// File này mô tả purchase proof mà Product Service nhận từ Order Service để không phụ thuộc entity hoặc database cross-service.

export interface ReviewItemContext {
  orderItemId: string;
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  imageUrl: string | null;
}

export interface ReviewOrderContext {
  orderId: string;
  ownerId: string;
  fulfillmentStatus: string;
  deliveredAt: string | null;
  reviewDeadline: string | null;
  deliveryConfirmationStatus: string;
  hasOpenDeliveryIssue: boolean;
  items: ReviewItemContext[];
}

// Proof của một item không cần lặp toàn bộ danh sách item của order.
export interface ReviewItemProof extends Omit<ReviewOrderContext, "items"> {
  orderItemId: string;
  productId: string;
  variantId: string;
  sellerOwnerId: string | null;
  productName: string;
}
