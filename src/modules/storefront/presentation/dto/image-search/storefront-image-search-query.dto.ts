// DTO chỉ cho phép filter public storefront; không nhận status để caller không mở sản phẩm inactive.
import { Transform, Type } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import {
    IsBoolean,
    IsEnum,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
} from 'class-validator';
import { StorefrontSort } from '@/database/catalog/enums/storefront-sort.enum';

export class StorefrontImageSearchQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(120)
    search?: string;

    @IsOptional()
    @IsUUID()
    categoryId?: string;

    @IsOptional()
    @IsUUID()
    sellerShopId?: string;

    @IsOptional()
    @Transform(({ value }) => toOptionalNumber(value))
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    minPrice?: number;

    @IsOptional()
    @Transform(({ value }) => toOptionalNumber(value))
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    maxPrice?: number;

    @IsOptional()
    @Transform(({ value }) => toOptionalNumber(value))
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    @Max(5)
    minRating?: number;

    @IsOptional()
    // Đọc chuỗi literal trước khi parse để implicit conversion không đổi 'false' thành true.
    @Type(() => String)
    @Transform(({ value }) => toOptionalBoolean(value))
    @IsBoolean()
    inStock?: boolean;

    @IsOptional()
    @IsEnum(StorefrontSort)
    sort?: StorefrontSort;

    @IsOptional()
    @Transform(({ value }) => Number(value))
    @IsInt()
    @Min(1)
    page = 1;

    @IsOptional()
    @Transform(({ value }) => Number(value))
    @IsInt()
    @Min(1)
    @Max(100)
    pageSize = 20;
}

// Chuỗi rỗng không trở thành filter giá 0; giá sai định dạng sẽ bị DTO từ chối.
function toOptionalNumber(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
}

// Chỉ nhận boolean literal; chuỗi khác không được âm thầm biến thành filter false.
function toOptionalBoolean(value: unknown): boolean | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new BadRequestException('BOOLEAN_FILTER_INVALID');
}
