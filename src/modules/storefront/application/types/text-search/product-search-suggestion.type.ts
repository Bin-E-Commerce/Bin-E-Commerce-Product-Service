// Kiểu dữ liệu gọn cho autocomplete; không kéo theo review, tồn kho chi tiết hay dữ liệu bán hàng từ service khác.
export interface ProductSearchSuggestion {
    id: string;
    name: string;
    slug: string;
    minPrice: string;
    maxPrice: string;
    brandName: string | null;
    imageUrl: string | null;
}
