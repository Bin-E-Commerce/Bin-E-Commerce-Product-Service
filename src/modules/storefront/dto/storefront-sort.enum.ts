// Các cách sắp xếp được phép trên catalog public.
// Enum giới hạn contract để client không thể truyền tên cột SQL tùy ý.

export enum StorefrontSort {
  NEWEST = "newest",
  PRICE_ASC = "price_asc",
  PRICE_DESC = "price_desc",
  RATING_DESC = "rating_desc",
  SOLD_DESC = "sold_desc",
}
