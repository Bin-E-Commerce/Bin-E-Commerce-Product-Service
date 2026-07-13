import type { HelmetOptions } from "helmet";

// Tạo cấu hình Helmet theo môi trường để local Swagger vẫn chạy mượt nhưng production có header chặt hơn.
export function buildHelmetOptions(isDev: boolean): HelmetOptions {
  return {
    contentSecurityPolicy: isDev
      ? false
      : {
          directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
          },
        },
    crossOriginEmbedderPolicy: false,
  };
}
