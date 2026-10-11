import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

// DTO này nhận cặp giá xem trước và giá mới; identity/shop luôn lấy từ header và route đã xác thực.
export class SetSellerVariantPriceDto {
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(100)
    @Max(2_147_483_647)
    expectedPrice!: number;

    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(100)
    @Max(2_147_483_647)
    nextPrice!: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(100)
    @Max(2_147_483_647)
    minimumPrice?: number;
}
