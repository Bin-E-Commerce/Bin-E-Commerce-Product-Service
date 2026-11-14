// Kiểm chứng chuẩn hóa query và các match trực tiếp dùng chung cho retrieval SQL và reranker.
import {
    getStorefrontSearchMatchPriority,
    normalizeStorefrontSearchTerm,
} from '@/modules/storefront/application/utils/storefront-search.utils';

describe('storefront search utils', () => {
    // NFKC gộp dấu tiếng Việt tổ hợp trước khi tạo token để query cùng chữ hiển thị trong catalog.
    it('should normalize composed Unicode and expose accent-folded tokens', () => {
        // Arrange
        const query = 'A\u0301O   thun size M';

        // Act
        const result = normalizeStorefrontSearchTerm(query);

        // Assert
        expect(result?.rawTerm).toBe('ÁO thun size M');
        expect(result?.tokens.map((token) => token.normalizedTerm)).toEqual([
            'ao',
            'thun',
            'size',
            'm',
        ]);
    });

    // LIKE wildcard của query phải được escape để ký tự người dùng gõ không mở rộng phạm vi tìm kiếm.
    it('should escape LIKE wildcards in the phrase pattern', () => {
        // Arrange
        const query = String.raw`alpha%_\test`;

        // Act
        const result = normalizeStorefrontSearchTerm(query);

        // Assert
        expect(result?.likeTerm).toBe(String.raw`alpha\%\_\\test`);
    });

    // Tên, slug và mã catalog có thứ tự ưu tiên cao hơn brand để model không đảo exact product match.
    it('should give direct product matches higher priority than an exact brand match', () => {
        // Arrange
        const query = 'áo thun';
        const exactProduct = { name: 'Áo thun' };
        const exactBrand = { brand: { name: 'Áo thun', normalizedName: 'ao thun' } };

        // Act
        const productPriority = getStorefrontSearchMatchPriority(
            query,
            exactProduct,
        );
        const brandPriority = getStorefrontSearchMatchPriority(
            query,
            exactBrand,
        );

        // Assert
        expect(productPriority).toBe(2);
        expect(brandPriority).toBe(1);
    });

    // Brand normalized_name cho phép tên gõ không dấu vẫn được bảo vệ khỏi việc model xếp tụt xuống.
    it('should recognize an accent-insensitive exact brand match', () => {
        // Arrange
        const query = 'dien may';
        const product = { brand: { name: 'Điện Máy', normalizedName: 'dien may' } };

        // Act
        const result = getStorefrontSearchMatchPriority(query, product);

        // Assert
        expect(result).toBe(1);
    });
});
