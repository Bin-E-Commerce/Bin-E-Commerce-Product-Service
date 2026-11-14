// Port search reranker để application chỉ phụ thuộc contract, không biết URL hay HTTP headers.
export const SEARCH_RERANKER = Symbol('SEARCH_RERANKER');

export interface SearchRerankCandidate {
    itemId: string;
    title: string;
    brand: string | null;
    category: string | null;
    sku: string | null;
    description: string | null;
}

export interface SearchRerankPrediction {
    itemId: string;
    score: number;
}

export interface SearchRerankerPort {
    // Kiểm tra readiness có cache ngắn; tránh gọi embedding trả phí nếu artifact chưa được nạp.
    isReady(): Promise<boolean>;

    // Chấm mức liên quan query-product; score chỉ có ý nghĩa so sánh trong cùng request.
    rerank(
        query: string,
        candidates: SearchRerankCandidate[],
    ): Promise<SearchRerankPrediction[]>;
}
