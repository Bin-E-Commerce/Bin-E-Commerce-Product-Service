export interface SellerShopReference {
  id: string;
  name: string;
  status: "active" | "suspended" | "closed";
}

export interface SellerShopProfileReference {
  shop: SellerShopReference;
}
