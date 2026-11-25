// Port semantic retrieval để application không phụ thuộc OpenAI, HTTP hay Qdrant.
export const SEMANTIC_SEARCH_CANDIDATES = Symbol('SEMANTIC_SEARCH_CANDIDATES');

export interface SemanticSearchCandidate {
    productId: string;
    similarityScore: number;
}

export interface SemanticSearchCandidatesPort {
    // Lấy top semantic IDs đã lọc trạng thái/embedding; Product Service áp các business filter còn lại.
    findCandidates(
        query: string,
        options: { limit: number; inStockOnly: boolean },
    ): Promise<SemanticSearchCandidate[]>;
}
