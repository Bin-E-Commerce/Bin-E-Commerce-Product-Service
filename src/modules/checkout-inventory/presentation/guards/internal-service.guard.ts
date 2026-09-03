// File này bảo vệ checkout inventory endpoint khỏi truy cập trực tiếp từ browser.

import { timingSafeEqual } from "crypto";
import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";

// Chỉ Order Service có shared token mới được yêu cầu thay đổi inventory.
@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  // So sánh token constant-time và từ chối khi môi trường chưa cấu hình secret.
  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>("INTERNAL_SERVICE_TOKEN", "");
    if (!expected) throw new ServiceUnavailableException("Internal service token chưa được cấu hình.");
    const request = context.switchToHttp().getRequest<Request>();
    const received = request.headers["x-internal-service-token"];
    if (typeof received !== "string" || !this.tokensMatch(received, expected)) {
      throw new UnauthorizedException("Invalid internal service token");
    }
    return true;
  }

  // Node yêu cầu hai buffer cùng độ dài trước khi timingSafeEqual.
  private tokensMatch(received: string, expected: string): boolean {
    const receivedBuffer = Buffer.from(received);
    const expectedBuffer = Buffer.from(expected);
    return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
  }
}
