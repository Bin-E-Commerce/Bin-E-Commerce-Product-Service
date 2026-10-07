// DTO nội bộ chỉ nhận số tồn dự kiến và số đã xem trước; shop/user được lấy từ route và header đã xác thực.
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class SetSellerInventoryDto {
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(2_147_483_647)
    expectedAvailable!: number;

    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(2_147_483_647)
    nextAvailable!: number;
}
