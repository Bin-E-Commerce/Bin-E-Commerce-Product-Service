import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";

@Controller("health")
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  // Trả trạng thái sống của Product Service và kết nối Postgres để gateway/ops kiểm tra nhanh.
  @Get()
  check() {
    const postgres = this.postgresStatus();

    return {
      status: postgres.status === "up" ? "ok" : "degraded",
      service: "product-service",
      version: this.config.get<string>("APP_VERSION", "1.0.0"),
      environment: this.config.get<string>("NODE_ENV", "development"),
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      checks: {
        http: { status: "ok" },
        postgres,
        memory: this.memoryUsage(),
      },
    };
  }

  // Đọc trạng thái DataSource thay vì query nặng, đủ cho healthcheck local và container.
  private postgresStatus() {
    return {
      status: this.dataSource.isInitialized ? "up" : "down",
      database: this.dataSource.options.database ?? null,
      type: this.dataSource.options.type,
    };
  }

  // Đưa memory về MB để response dễ đọc hơn số byte thô.
  private memoryUsage() {
    const usage = process.memoryUsage();
    return {
      status: "ok",
      rssMb: Math.round(usage.rss / 1024 / 1024),
      heapUsedMb: Math.round(usage.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(usage.heapTotal / 1024 / 1024),
    };
  }
}
