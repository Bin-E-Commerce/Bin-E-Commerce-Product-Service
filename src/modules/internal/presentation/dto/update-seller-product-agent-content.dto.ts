import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// DTO cập nhật giới hạn ở tên/mô tả; mỗi trường gửi lên phải mang cả giá trị kỳ vọng và giá trị mới.
export class UpdateSellerProductAgentContentDto {
    @IsOptional()
    @IsString()
    @MinLength(20)
    @MaxLength(200)
    expectedName?: string;

    @IsOptional()
    @IsString()
    @MinLength(20)
    @MaxLength(200)
    nextName?: string;

    @IsOptional()
    @IsString()
    @MaxLength(30_000)
    expectedDescription?: string | null;

    @IsOptional()
    @IsString()
    @MinLength(20)
    @MaxLength(30_000)
    nextDescription?: string;
}
