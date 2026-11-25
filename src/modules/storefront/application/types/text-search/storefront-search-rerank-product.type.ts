// Dữ liệu tối thiểu mà reranker cần; không để adapter AI phụ thuộc entity TypeORM.
export interface StorefrontSearchRerankProduct {
    id: string;
    name: string;
    slug: string;
    sellerSku: string | null;
    gtin: string | null;
    brand: {
        name: string | null;
        normalizedName: string | null;
    } | null;
    metadata: Record<string, unknown> | null;
    shortDescription: string | null;
    description: string | null;
    exactVariantNameMatch: boolean;
    exactVariantCodeMatch: boolean;
}
