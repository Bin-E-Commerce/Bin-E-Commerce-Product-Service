// File này lắp dependency graph của Product Service.
// Database schema chỉ được thay đổi qua migration; runtime không tự đồng bộ entity để tránh race condition và mất kiểm soát schema.

import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { HealthModule } from "./modules/health/health.module";
import { ProductsModule } from "./modules/products.module";
import { KafkaModule } from "./kafka/kafka.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres",
        host: config.get<string>("POSTGRES_HOST", "localhost"),
        port: config.get<number>("POSTGRES_PORT", 5432),
        username: config.get<string>("POSTGRES_USER"),
        password: config.get<string>("POSTGRES_PASSWORD"),
        database: config.get<string>("POSTGRES_DB"),
        entities: [__dirname + "/**/*.entity{.ts,.js}"],
        migrations: [__dirname + "/database/migrations/*{.ts,.js}"],
        migrationsRun: true,
        // Không chạy synchronize kể cả ở local; migration là nguồn schema duy nhất của Product Service.
        synchronize: false,
        ssl:
          config.get<string>("NODE_ENV") === "production"
            ? { rejectUnauthorized: false }
            : false,
        logging: config.get<string>("TYPEORM_LOGGING", "false") === "true",
      }),
    }),
    HealthModule,
    ProductsModule,
    KafkaModule,
  ],
})
export class AppModule {}
