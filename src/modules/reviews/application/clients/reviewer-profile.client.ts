// Client nay lay profile cong khai toi thieu tu Auth Service de hydrate review legacy chua co snapshot.
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface ReviewerPublicProfile {
  keycloakId: string;
  name: string;
  avatarUrl: string | null;
}

interface ReviewerProfilesResponse {
  data?: ReviewerPublicProfile[];
}

@Injectable()
export class ReviewerProfileClient {
  private readonly targetBase: string;
  private readonly internalToken: string;

  // Doc discovery URL va internal token tu config, khong de credential di qua browser.
  constructor(config: ConfigService) {
    this.targetBase = config.get<string>("AUTH_SERVICE_URL", "http://localhost:3002");
    this.internalToken = config.get<string>("INTERNAL_SERVICE_TOKEN", "");
  }

  // Lay profile theo batch de mot product detail khong tao N request theo so review.
  async getPublicProfiles(userIds: string[]): Promise<Map<string, ReviewerPublicProfile>> {
    const ids = Array.from(new Set(userIds.filter(Boolean))).slice(0, 100);
    if (ids.length === 0) return new Map();

    try {
      const response = await fetch(
        `${this.targetBase}/api/v1/internal/users/public-profiles?ids=${encodeURIComponent(ids.join(","))}`,
        {
          headers: {
            accept: "application/json",
            "x-internal-service-token": this.internalToken,
          },
          signal: AbortSignal.timeout(3_000),
        },
      );
      if (!response.ok) return new Map();
      const body = (await response.json()) as ReviewerProfilesResponse;
      return new Map((body.data ?? []).map((profile) => [profile.keycloakId, profile]));
    } catch {
      // Profile la du lieu phu tro; Auth Service tam thoi loi khong duoc lam trang chi tiet san pham bi 5xx.
      return new Map();
    }
  }
}
