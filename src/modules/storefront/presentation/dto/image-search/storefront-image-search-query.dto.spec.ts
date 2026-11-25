// Kiểm tra tham số tồn kho ở đúng cấu hình ValidationPipe của API tìm ảnh.
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { StorefrontImageSearchQueryDto } from '@/modules/storefront/presentation/dto/image-search/storefront-image-search-query.dto';

describe('StorefrontImageSearchQueryDto', () => {
    const target = new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
    });
    const metadata = {
        type: 'query' as const,
        metatype: StorefrontImageSearchQueryDto,
    };

    // Tắt hoặc bỏ bộ lọc phải giữ đúng ý định, kể cả khi Nest tự chuyển kiểu query.
    it.each([
        [{ inStock: 'false' }, false],
        [{ inStock: 'true' }, true],
        [{}, undefined],
    ])(
        'should preserve the inventory filter from %j',
        async (query, expected) => {
            // Arrange
            const rawQuery = { ...query };

            // Act
            const result = (await target.transform(
                rawQuery,
                metadata,
            )) as StorefrontImageSearchQueryDto;

            // Assert
            expect(result.inStock).toBe(expected);
        },
    );

    // Giá trị sai hoặc lặp query phải bị từ chối thay vì âm thầm bật bộ lọc.
    it.each([{ inStock: 'unknown' }, { inStock: ['true', 'false'] }])(
        'should reject an invalid inventory filter %j',
        async ({ inStock }) => {
            // Arrange
            const rawQuery = { inStock };

            // Act
            const transformation = target.transform(rawQuery, metadata);

            // Assert
            await expect(transformation).rejects.toBeInstanceOf(
                BadRequestException,
            );
        },
    );
});
