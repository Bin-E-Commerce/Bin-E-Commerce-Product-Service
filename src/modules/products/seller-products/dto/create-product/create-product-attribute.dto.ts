import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";

export class CreateProductAttributeDto {
  // ID thuộc tính đến từ Catalog Service; Catalog có thể sinh UUID v5 sau khi import dữ liệu.
  // Ràng buộc định dạng vẫn được giữ, chỉ mở rộng đúng phiên bản UUID được chấp nhận.
  @IsUUID("all")
  categoryAttributeId: string;

  // Select và multi-select gửi ID option thay vì text tự do để bộ lọc storefront luôn dùng dữ liệu chuẩn từ Catalog Service.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  // Catalog Service sinh UUID theo nhiều phiên bản, trong đó dữ liệu import hiện dùng UUID v5.
  // Không giới hạn v4 ở đây vì option ID là khóa tham chiếu hợp lệ, không phải UUID do Product Service tự sinh.
  @IsUUID("all", { each: true })
  selectedOptionIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  valueText?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  valueNumber?: number;

  @IsOptional()
  @IsBoolean()
  valueBoolean?: boolean;
}
