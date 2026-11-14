// Chuẩn hóa query storefront để so sánh tiếng Việt có dấu/không dấu và dựng pattern an toàn cho ILIKE.

export interface NormalizedStorefrontSearchTerm {
    rawTerm: string;
    likeTerm: string;
    normalizedTerm: string;
    normalizedLikeTerm: string;
    slugTerm: string;
    tokens: StorefrontSearchToken[];
}

export interface StorefrontSearchToken {
    rawTerm: string;
    normalizedTerm: string;
}

export interface StorefrontSearchMatchFields {
    name?: string | null;
    slug?: string | null;
    sellerSku?: string | null;
    gtin?: string | null;
    brand?: {
        name?: string | null;
        normalizedName?: string | null;
    } | null;
}

// Chuẩn hóa tương đương Unicode trước khi dựng pattern, giúp ký tự tiếng Việt gõ dạng tổ hợp vẫn khớp catalog.
export function normalizeStorefrontSearchTerm(
    value: string,
): NormalizedStorefrontSearchTerm | null {
    const rawTerm = value
        .normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);

    if (!rawTerm) return null;

    const likeTerm = escapeStorefrontLikeTerm(rawTerm);
    const normalizedTerm = rawTerm
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, (letter) => (letter === 'đ' ? 'd' : 'D'))
        .toLowerCase()
        .replace(/\s+/g, ' ');
    const normalizedLikeTerm = escapeStorefrontLikeTerm(normalizedTerm);
    const slugTerm = normalizedTerm
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const tokens = (
        rawTerm.match(/[\p{L}\p{N}]+(?:[._\/-][\p{L}\p{N}]+)*/gu) ?? []
    ).map((rawToken) => ({
        rawTerm: rawToken,
        normalizedTerm: normalizeSearchText(rawToken),
    }));

    return {
        rawTerm,
        likeTerm,
        normalizedTerm,
        normalizedLikeTerm,
        slugTerm,
        tokens,
    };
}

// Chỉ escape wildcard LIKE ở pattern; SKU/mã được so sánh nguyên bản và không đổi ý nghĩa.
function escapeStorefrontLikeTerm(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
}

// Bỏ dấu và chuẩn hóa Unicode cho token, đồng bộ với normalized_name và slug của catalog.
function normalizeSearchText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, (letter) => (letter === 'đ' ? 'd' : 'D'))
        .toLowerCase();
}

// Giữ match trực tiếp của tên/mã và tên brand phía trên score AI; tên sản phẩm có ưu tiên cao hơn brand.
export function getStorefrontSearchMatchPriority(
    query: string,
    product: StorefrontSearchMatchFields,
): number {
    const exactQuery = normalizeExactSearchText(query);
    if (!exactQuery) return 0;

    const directProductMatch = [
        product.name,
        product.slug,
        product.sellerSku,
        product.gtin,
    ].some((value) => normalizeExactSearchText(value ?? '') === exactQuery);
    if (directProductMatch) return 2;

    const normalizedQuery = normalizeSearchText(query)
        .trim()
        .replace(/\s+/g, ' ');
    const exactBrandMatch =
        normalizeExactSearchText(product.brand?.name ?? '') === exactQuery ||
        normalizeExactSearchText(product.brand?.normalizedName ?? '') ===
            normalizeExactSearchText(normalizedQuery);
    return exactBrandMatch ? 1 : 0;
}

// Bỏ semantic expansion cho truy vấn mã để exact SKU/GTIN dùng đường SQL xác định và không gọi embedding trả phí.
export function isProductIdentifierQuery(value: string): boolean {
    return /^(?=.*\d)[a-z0-9._/-]{4,64}$/i.test(value.trim());
}

// Loại markup và entity HTML trước khi gửi mô tả catalog sang model; caller tiếp tục giới hạn text theo field.
export function toPlainSearchText(value: string): string {
    return value
        .slice(0, 12_000)
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_entity, code: string) => {
            const numericCode = Number(code);
            return Number.isInteger(numericCode) &&
                numericCode >= 0 &&
                numericCode <= 0x10ffff
                ? String.fromCodePoint(numericCode)
                : ' ';
        })
        .replace(/\s+/g, ' ')
        .trim();
}

// So sánh chuỗi nguyên bản không phân biệt Unicode compatibility, khoảng trắng và chữ hoa/thường.
function normalizeExactSearchText(value: string): string {
    return value
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('vi-VN');
}
