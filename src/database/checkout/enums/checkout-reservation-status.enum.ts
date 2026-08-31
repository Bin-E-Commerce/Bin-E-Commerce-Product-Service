// File này định nghĩa trạng thái persistence của ledger checkout.
// Enum giữ contract đồng nhất giữa entity và service, trong khi schema PostgreSQL vẫn dùng varchar + check constraint.
export enum CheckoutReservationStatus {
  RESERVED = "RESERVED",
  RELEASED = "RELEASED",
}
