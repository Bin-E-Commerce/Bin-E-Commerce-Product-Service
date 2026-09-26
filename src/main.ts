// File này khởi động Product Service, cấu hình validation/API boundary và telemetry.
// File không chứa nghiệp vụ product; các feature module giữ contract và persistence rule.

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from '@/app.module';
import { buildHelmetOptions } from '@/common/config/helmet.config';
import { setupHttpObservability } from '@common/observability/http-observability';

// Khởi động Product Service, nơi quản lý product, variant, ảnh và shop nguồn crawl.
// Khởi động product boundary và đăng ký validation, security cùng telemetry.
async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule, {
        logger: ['error', 'warn', 'log'],
    });

    app.getHttpAdapter().getInstance().set('trust proxy', 1);

    const config = app.get(ConfigService);
    const isDev = config.get<string>('NODE_ENV') !== 'production';
    const port = Number(config.get<string>('PORT', '3008'));

    app.use(helmet(buildHelmetOptions(isDev)));
    app.setGlobalPrefix('api');
    // Đăng ký metrics RED và request ID trước khi service bắt đầu nhận traffic.
    setupHttpObservability(app, 'product-service');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            transformOptions: { enableImplicitConversion: true },
        }),
    );
    app.enableCors({ origin: false });

    if (isDev) {
        const documentConfig = new DocumentBuilder()
            .setTitle('Product Service')
            .setDescription(
                'Product, variant, image, brand and external shop APIs',
            )
            .setVersion('1.0')
            .build();
        SwaggerModule.setup(
            'docs',
            app,
            SwaggerModule.createDocument(app, documentConfig),
        );
    }

    app.enableShutdownHooks();

    await app.listen(port);
    console.log(`[product-service] Running on port ${port}`);
}

void bootstrap();
