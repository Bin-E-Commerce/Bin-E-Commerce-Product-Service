import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Permission } from "@common/auth";
import type { SellerProductUserContext } from "../../types/seller-product-user-context.type";

@Injectable()
export class SellerProductAccessService {
  // Tạo user context từ header nội bộ do API Gateway xác thực và ký sinh vào request.
  // Product Service không nhận ownerId từ query/body để người dùng không thể đổi ID và đọc sản phẩm shop khác.
  buildCurrentUserFromHeaders(
    headers: Record<string, unknown>,
  ): SellerProductUserContext {
    return {
      userId: this.getHeaderValue(headers, "x-user-id") ?? "",
      email: this.getHeaderValue(headers, "x-user-email") ?? "",
      permissions: this.parseHeaderList(
        this.getHeaderValue(headers, "x-user-permissions") ?? "",
      ),
    };
  }

  // Kiểm tra lại permission tại Product Service để endpoint vẫn an toàn nếu hạ tầng nội bộ gọi thẳng, bỏ qua Gateway.
  ensureCanReadProducts(
    currentUser: SellerProductUserContext,
  ): SellerProductUserContext {
    if (!currentUser.userId || !currentUser.email) {
      throw new UnauthorizedException(
        "Bạn cần đăng nhập để xem sản phẩm của shop.",
      );
    }

    if (
      !currentUser.permissions.includes(Permission.SELLER_PRODUCT_READ)
    ) {
      throw new ForbiddenException(
        "Bạn không có quyền xem sản phẩm của shop.",
      );
    }

    return currentUser;
  }

  // Chặn tạo sản phẩm ở service đích nếu request nội bộ không mang quyền create đã được Auth Service cấp.
  ensureCanCreateProduct(
    currentUser: SellerProductUserContext,
  ): SellerProductUserContext {
    if (!currentUser.userId || !currentUser.email) {
      throw new UnauthorizedException(
        "Bạn cần đăng nhập để thêm sản phẩm cho shop.",
      );
    }

    if (!currentUser.permissions.includes(Permission.SELLER_PRODUCT_CREATE)) {
      throw new ForbiddenException(
        "Bạn không có quyền thêm sản phẩm cho shop.",
      );
    }

    return currentUser;
  }

  // Kiểm tra quyền cập nhật ở service đích để request nội bộ bị gọi vòng qua Gateway vẫn không thể sửa dữ liệu.
  ensureCanUpdateProduct(
    currentUser: SellerProductUserContext,
  ): SellerProductUserContext {
    if (!currentUser.userId || !currentUser.email) {
      throw new UnauthorizedException(
        "Bạn cần đăng nhập để chỉnh sửa sản phẩm của shop.",
      );
    }

    if (!currentUser.permissions.includes(Permission.SELLER_PRODUCT_UPDATE)) {
      throw new ForbiddenException(
        "Bạn không có quyền chỉnh sửa sản phẩm của shop.",
      );
    }

    return currentUser;
  }

  // Kiểm tra permission delete tại Product Service để request nội bộ không thể bỏ qua lớp bảo vệ của Gateway.
  ensureCanDeleteProduct(
    currentUser: SellerProductUserContext,
  ): SellerProductUserContext {
    if (!currentUser.userId || !currentUser.email) {
      throw new UnauthorizedException(
        "Bạn cần đăng nhập để xóa sản phẩm của shop.",
      );
    }

    if (!currentUser.permissions.includes(Permission.SELLER_PRODUCT_DELETE)) {
      throw new ForbiddenException(
        "Bạn không có quyền xóa sản phẩm của shop.",
      );
    }

    return currentUser;
  }

  // Kiểm tra permission status riêng để thao tác bật/tắt không được suy diễn từ quyền sửa nội dung.
  ensureCanChangeProductStatus(
    currentUser: SellerProductUserContext,
  ): SellerProductUserContext {
    if (!currentUser.userId || !currentUser.email) {
      throw new UnauthorizedException(
        "Bạn cần đăng nhập để thay đổi trạng thái sản phẩm.",
      );
    }

    if (
      !currentUser.permissions.includes(Permission.SELLER_PRODUCT_STATUS_UPDATE)
    ) {
      throw new ForbiddenException(
        "Bạn không có quyền thay đổi trạng thái sản phẩm.",
      );
    }

    return currentUser;
  }

  // Kiểm tra quyền khôi phục riêng để chỉ seller được cấp capability này mới đưa product trở lại shop.
  ensureCanRestoreProduct(
    currentUser: SellerProductUserContext,
  ): SellerProductUserContext {
    if (!currentUser.userId || !currentUser.email) {
      throw new UnauthorizedException(
        "Bạn cần đăng nhập để khôi phục sản phẩm của shop.",
      );
    }

    if (!currentUser.permissions.includes(Permission.SELLER_PRODUCT_RESTORE)) {
      throw new ForbiddenException(
        "Bạn không có quyền khôi phục sản phẩm của shop.",
      );
    }

    return currentUser;
  }

  // Kiem tra quyen tao job toi uu anh tai Product Service de request noi bo khong the bo qua Gateway guard.
  ensureCanGenerateAiImage(currentUser: SellerProductUserContext): SellerProductUserContext {
    if (!currentUser.userId || !currentUser.email) throw new UnauthorizedException("Ban can dang nhap de toi uu anh san pham.");
    if (!currentUser.permissions.includes(Permission.SELLER_AI_IMAGE_OPTIMIZATION_GENERATE)) {
      throw new ForbiddenException("Ban khong co quyen tao yeu cau toi uu anh.");
    }
    return currentUser;
  }

  // Kiem tra quyen apply output AI, tach khoi quyen generate de seller co the duoc cap capability theo vai tro.
  ensureCanApplyAiImage(currentUser: SellerProductUserContext): SellerProductUserContext {
    if (!currentUser.userId || !currentUser.email) throw new UnauthorizedException("Ban can dang nhap de ap dung anh AI.");
    if (!currentUser.permissions.includes(Permission.SELLER_AI_IMAGE_OPTIMIZATION_APPLY)) {
      throw new ForbiddenException("Ban khong co quyen ap dung anh AI.");
    }
    return currentUser;
  }

  // Kiem tra quyen rollback de chi seller duoc cap moi co the khoi phuc anh goc.
  ensureCanRollbackAiImage(currentUser: SellerProductUserContext): SellerProductUserContext {
    if (!currentUser.userId || !currentUser.email) throw new UnauthorizedException("Ban can dang nhap de khoi phuc anh goc.");
    if (!currentUser.permissions.includes(Permission.SELLER_AI_IMAGE_OPTIMIZATION_ROLLBACK)) {
      throw new ForbiddenException("Ban khong co quyen khoi phuc anh goc.");
    }
    return currentUser;
  }

  // Đọc an toàn header đơn hoặc header lặp vì Node/Nest chuẩn hóa tên header thành lowercase.
  private getHeaderValue(
    headers: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = headers[key];
    if (Array.isArray(value)) return value[0];
    return typeof value === "string" ? value : undefined;
  }

  // Chuẩn hóa danh sách permission phân cách bằng dấu phẩy trước khi so khớp chính xác.
  private parseHeaderList(value: string): string[] {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
