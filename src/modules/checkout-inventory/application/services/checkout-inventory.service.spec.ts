// File này kiểm thử transaction reserve/release của Checkout domain bằng dependency mock, không kết nối database thật.
import { createMock, type DeepMocked } from "@golevelup/ts-jest";
import { DataSource } from "typeorm";
import { CheckoutReservation } from "../../../../database/checkout/entities/checkout-reservation.entity";
import { CheckoutInventoryService } from "./checkout-inventory.service";

describe("CheckoutInventoryService", () => {
  let target: CheckoutInventoryService;
  let mockDataSource: DeepMocked<DataSource>;

  beforeEach(() => {
    mockDataSource = createMock<DataSource>();
    target = new CheckoutInventoryService(mockDataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should return the stored response without reserving inventory for a repeated key", async () => {
    // Arrange
    const expected = {
      reservationKey: "checkout-key-001",
      items: [],
    };
    const reservationRepository = {
      findOne: jest.fn().mockResolvedValue({ status: "RESERVED", response: expected }),
    };
    const manager = {
      query: jest.fn(),
      getRepository: jest.fn().mockReturnValue(reservationRepository),
    };
    mockDataSource.transaction.mockImplementation(async (callback: any) => callback(manager));

    // Act
    const result = await target.reserve({
      reservationKey: "checkout-key-001",
      items: [{
        productId: "22222222-2222-4222-8222-222222222222",
        variantId: "33333333-3333-4333-8333-333333333333",
        quantity: 1,
      }],
    });

    // Assert
    expect(result).toEqual(expected);
    expect(manager.getRepository).toHaveBeenCalledWith(CheckoutReservation);
    expect(manager.getRepository).toHaveBeenCalledTimes(1);
  });

  it("should return success without changing inventory for a repeated release", async () => {
    // Arrange
    const reservationRepository = {
      findOne: jest.fn().mockResolvedValue({ status: "RELEASED" }),
    };
    const manager = {
      query: jest.fn(),
      getRepository: jest.fn().mockReturnValue(reservationRepository),
    };
    mockDataSource.transaction.mockImplementation(async (callback: any) => callback(manager));

    // Act
    const result = await target.release({
      reservationKey: "checkout-key-001",
      items: [{
        variantId: "33333333-3333-4333-8333-333333333333",
        quantity: 1,
      }],
    });

    // Assert
    expect(result).toEqual({ released: true });
    expect(manager.getRepository).toHaveBeenCalledWith(CheckoutReservation);
    expect(manager.getRepository).toHaveBeenCalledTimes(1);
  });
});
