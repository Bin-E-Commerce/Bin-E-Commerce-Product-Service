// Response phân trang dùng cho danh sách sản phẩm storefront.
export interface PaginatedProductResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
