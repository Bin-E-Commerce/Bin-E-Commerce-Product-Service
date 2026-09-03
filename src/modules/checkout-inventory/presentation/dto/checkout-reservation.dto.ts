// File này định nghĩa contract nội bộ để Order Service yêu cầu Product giữ hoặc trả tồn kho.

import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsInt, IsString, IsUUID, Max, Min, MaxLength, MinLength, ValidateNested } from "class-validator";

// Một dòng reserve chỉ nhận ID và quantity; không nhận giá hay snapshot từ caller.
export class CheckoutReservationItemDto {
  @IsUUID("4")
  productId!: string;

  @IsUUID("4")
  variantId!: string;

  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}

// Payload reserve giới hạn kích thước để tránh một request chiếm lock quá lâu.
export class ReserveCheckoutDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  reservationKey!: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CheckoutReservationItemDto)
  items!: CheckoutReservationItemDto[];
}

// Payload release dùng cùng danh sách variant đã reserve để compensation có thể chạy khi commit order lỗi.
export class ReleaseCheckoutDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  reservationKey!: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReleaseCheckoutItemDto)
  items!: ReleaseCheckoutItemDto[];
}

// Chỉ cần variant và quantity khi trả tồn kho, productId không ảnh hưởng đến inventory owner.
export class ReleaseCheckoutItemDto {
  @IsUUID("4")
  variantId!: string;

  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}
