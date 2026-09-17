# Product Service dùng build context là root repository vì dùng tsconfig.base.json
# và packages/common của monorepo. Dockerfile chỉ copy source Product cần thiết;
# các service khác không bị đưa vào image.

# -----------------------------------------------------------------------------
# Giai đoạn build: cài dependency cố định và compile Product Service.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifest trước source để Docker cache layer npm khi chỉ thay đổi code.
COPY tsconfig.base.json ./
COPY packages/common ./packages/common
COPY services/product-service/package.json services/product-service/package-lock.json ./services/product-service/
COPY services/product-service/tsconfig.json services/product-service/tsconfig.build.json services/product-service/nest-cli.json ./services/product-service/

# Cài đúng dependency theo lockfile riêng của Product; devDependency cần cho Nest CLI
# chỉ tồn tại ở builder và sẽ được loại khỏi runtime image.
WORKDIR /app/services/product-service
RUN npm ci --include=dev --ignore-scripts

# Chỉ copy source Product, không dùng COPY . . để tránh kéo artifact/service khác.
COPY services/product-service/src ./src

# Dùng đúng build script của Product; tsconfig.build.json loại test khỏi artifact,
# còn nest-cli.json giữ entry/output contract hiện tại của service.
RUN npm run build

# Giảm kích thước image cuối bằng cách bỏ Nest CLI, TypeScript, Jest và dev tools.
RUN npm prune --omit=dev

# TypeScript giữ alias @common/* trong JavaScript sau khi compile. Đặt bản build
# vào node_modules để Node.js resolve được alias ở runtime mà không cần loader thêm.
RUN mkdir -p node_modules/@common \
  && cp -R dist/packages/common/. node_modules/@common/

# -----------------------------------------------------------------------------
# Giai đoạn runtime: chỉ giữ dependency production và artifact đã compile.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

RUN addgroup -g 1001 -S nodejs \
  && adduser -S nestjs -u 1001

WORKDIR /app

# dist có thể chứa cả packages/common do rootDir trỏ về monorepo; copy toàn bộ
# artifact của Product workspace để các import nội bộ được giữ đúng cấu trúc.
COPY --from=builder --chown=nestjs:nodejs /app/services/product-service/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/services/product-service/dist ./dist

ENV NODE_ENV=production \
  PORT=3008 \
  NODE_OPTIONS=--max-old-space-size=128

EXPOSE 3008

# Product health kiểm tra HTTP process và DataSource; route có URI versioning v1.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD wget --quiet --tries=1 --spider "http://localhost:${PORT}/api/v1/health" || exit 1

USER nestjs

# Chạy Node trực tiếp để nhận SIGTERM đúng khi Compose/Kubernetes rolling update.
CMD ["node", "dist/services/product-service/src/main.js"]
