// Enum này giới hạn các cách sắp xếp được phép trên catalog public.
// Đặt cùng nhóm enum catalog để DTO và application service dùng chung một contract, đồng thời không cho client truyền tên cột SQL tùy ý.
export enum StorefrontSort {
  NEWEST = "newest",
  PRICE_ASC = "price_asc",
  PRICE_DESC = "price_desc",
  RATING_DESC = "rating_desc",
  SOLD_DESC = "sold_desc",
}
