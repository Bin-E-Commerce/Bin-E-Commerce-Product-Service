# Dockerfile độc lập cho Product Service; service vẫn sở hữu database và inventory riêng.

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/common ./packages/common
COPY services/product-service/package.json services/product-service/package-lock.json ./services/product-service/
COPY services/product-service/tsconfig.json services/product-service/tsconfig.build.json services/product-service/nest-cli.json ./services/product-service/
COPY services/product-service/src ./services/product-service/src
WORKDIR /app/services/product-service
RUN npm ci
RUN npm run build

FROM node:20-alpine AS production
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
WORKDIR /app
COPY services/product-service/package.json services/product-service/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/services/product-service/dist ./dist
ENV NODE_ENV=production
EXPOSE 3008
USER nestjs
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:3008/api/health || exit 1
CMD ["node", "--max-old-space-size=128", "dist/services/product-service/src/main.js"]
