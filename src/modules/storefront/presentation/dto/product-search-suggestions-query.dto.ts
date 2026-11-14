// DTO giới hạn autocomplete vào truy vấn ngắn, có giới hạn độ dài để tránh query nặng từ input tự do.
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ProductSearchSuggestionsQueryDto {
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @MinLength(2)
    @MaxLength(120)
    q!: string;
}
