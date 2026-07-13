<div align="center">

# Product Service

### Product graph, marketplace import readiness, and SKU-level commerce data for Bin E-Commerce.

Product data gets messy fast when catalog, seller, inventory and crawler concerns live in one place. Product Service keeps that graph explicit, queryable, and ready for both internal sellers and marketplace imports.

<p>
  <img alt="NestJS" src="https://img.shields.io/badge/NestJS-11-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-product_db-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" />
  <img alt="TypeORM" src="https://img.shields.io/badge/TypeORM-0.3-262627?style=for-the-badge" />
</p>

| Product Graph | Import Safety | Service Boundary |
| --- | --- | --- |
| Products, variants, options, images, attributes and reviews | Source ids, external shops and idempotent upsert keys | Catalog taxonomy and seller onboarding stay outside this service |

<p>
  <a href="#see-it-work">See it work</a>
  ·
  <a href="#api-reference">API</a>
  ·
  <a href="#data-model">Data model</a>
  ·
  <a href="#import-direction">Import flow</a>
</p>

</div>

---

## The Problem

An e-commerce product is not just a row named `products`. It is a graph: brand, shop ownership, images, variants, option values, inventory snapshot, attributes, reviews and external source metadata.

If that graph is mixed into Catalog Service or Seller Service, the system becomes hard to import, hard to query and hard to evolve. Product Service owns the product graph while keeping category taxonomy and seller onboarding in their own bounded contexts.

If you have worked with Shopee, Tiki or Lazada-style product data, the pattern is familiar: catalog taxonomy is stable master data, while product data changes constantly. This service separates those two concerns.

---

## See It Work

```bash
cd services/product-service
cp .env.example .env
npm install
npm run dev
```

The service starts on port `3008` by default:

```text
[product-service] Running on port 3008
```

Try the public product APIs:

```bash
curl "http://localhost:3008/api/v1/health"
curl "http://localhost:3008/api/v1/products?page=1&pageSize=20"
curl "http://localhost:3008/api/v1/products?originType=EXTERNAL&status=ACTIVE"
```

In development, Swagger is available at:

```text
http://localhost:3008/docs
```

Through API Gateway:

```text
http://localhost:3001/api/v1/products
```

---

## Trust Surface

| Concern | Product Service behavior |
| --- | --- |
| Files touched | Reads `.env` / `.env.local`; writes no files at runtime. |
| Network calls | Connects to PostgreSQL only. Current product APIs do not call external marketplaces directly. |
| Database writes | Current exposed API is read-only. Tables are created in local dev when `synchronize=true`. |
| Secrets | Uses service-local env variables. Production should inject secrets per service. |
| Reversibility | Stop the process and drop `bin_ecommerce_product` if you want to reset local data. |

---

## Service Boundary

| Area | Owner | Why |
| --- | --- | --- |
| Category tree, category attributes, attribute options | `catalog-service` | Category taxonomy is shared master data. |
| Seller onboarding, approval state, internal seller account | `seller-service` | Seller identity and approval workflow should not be coupled to products. |
| Products, variants, product images, product option values, product attributes, product reviews | `product-service` | This graph changes with listing/import operations. |
| Raw marketplace crawling and source adapters | `packages/crawl-tiki` and future crawler packages | Crawlers should map data into service contracts, not own production tables. |

Important import rule:

```text
Crawler/importer must not create new categories.
It must resolve every source category to an existing catalog-service category_id.
If category mapping fails, skip the product and log it for manual mapping.
```

---

## Product Ownership Model

Product Service supports two product origins.

```text
INTERNAL
  product.seller_shop_id != null
  product.external_shop_id = null

EXTERNAL
  product.seller_shop_id = null
  product.external_shop_id != null
```

`seller_shop_id` is a logical reference to Seller Service. It is intentionally not a physical foreign key because services may use separate databases.

`external_shop_id` points to `external_shops`, a product-service table that stores shop data coming from Tiki/Shopee/Lazada-style imports. An external shop is not a real Bin seller account; it only preserves source context for imported products.

---

## API Reference

Base URL when running service directly:

```text
http://localhost:3008/api/v1
```

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service, PostgreSQL and memory health status. |
| `GET` | `/products` | List products with pagination and filters. |
| `GET` | `/products/:id` | Read one product with brand, external shop, images, variants, options, inventory, attributes and reviews. |

### List Products

```bash
curl "http://localhost:3008/api/v1/products?page=1&pageSize=20"
```

Supported query parameters:

| Parameter | Type | Description |
| --- | --- | --- |
| `search` | string | Searches product name, slug and external product id. |
| `categoryId` | UUID | Filters by internal catalog category id. |
| `sellerShopId` | UUID | Filters internal seller products. |
| `externalShopId` | UUID | Filters imported products from one external shop. |
| `originType` | `INTERNAL` or `EXTERNAL` | Filters product ownership origin. |
| `status` | `DRAFT`, `ACTIVE`, `INACTIVE`, `DELETED` | Filters product lifecycle state. |
| `page` | number | Defaults to `1`. |
| `pageSize` | number | Defaults to `20`, maximum `100`. |

Example response shape:

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 20,
  "totalPages": 0
}
```

### Product Detail

```bash
curl "http://localhost:3008/api/v1/products/{productId}"
```

The detail endpoint loads the product graph needed by a product detail page:

```text
product
├── brand
├── externalShop
├── images
├── variants
│   ├── inventory
│   └── optionChoices
│       └── optionValue
│           └── option
├── options
│   └── values
├── attributeValues
└── reviews
```

---

## Data Model

Core tables:

```text
products
brands
external_shops
product_images
product_variants
product_options
product_option_values
product_variant_option_values
inventories
product_attribute_values
product_reviews
```

### Why Four Variant Option Tables?

Variant options are normalized into:

```text
product_options
product_option_values
product_variants
product_variant_option_values
```

This keeps the frontend from reverse-engineering option groups from variant names.

Example:

```text
Product: iPhone 15

product_options:
  - Màu sắc
  - Dung lượng

product_option_values:
  - Đen
  - Trắng
  - 128GB
  - 256GB

product_variants:
  - iPhone 15 Đen 128GB
  - iPhone 15 Trắng 256GB

product_variant_option_values:
  - variant A -> Đen
  - variant A -> 128GB
  - variant B -> Trắng
  - variant B -> 256GB
```

That structure gives the UI a stable way to render:

```text
Màu sắc: Đen, Trắng
Dung lượng: 128GB, 256GB
```

without duplicating strings across every SKU.

---

## Import Direction

The intended marketplace import flow is:

```text
Crawler source adapter
  -> raw product payload
  -> product mapper
  -> resolve existing catalog category
  -> upsert external_shops
  -> upsert brands
  -> upsert products
  -> upsert images / variants / options / attributes / reviews
```

Idempotency keys are built into the model:

| Table | Anti-duplicate strategy |
| --- | --- |
| `products` | Unique `source_platform + external_product_id` when source fields exist. |
| `external_shops` | Unique `source_platform + external_shop_id` and `source_platform + slug`. |
| `brands` | Unique `slug`; unique `source_platform + external_brand_id` for crawled brands. |
| `product_variants` | Unique `sku`; unique `product_id + external_variant_id` when source id exists. |

<details>
<summary><b>Import rules for crawled products</b></summary>

1. Do not insert new categories into Catalog Service.
2. Resolve external category data to an existing `category_id`.
3. If no category mapping exists, skip the product and log the mapping gap.
4. Upsert external shop data with `sourcePlatform` and `externalShopId`.
5. If a product has no variants, create one default variant.
6. Derive `min_price` and `max_price` from variants.
7. Store thumbnail image with `is_thumbnail = true`.
8. Store technical specifications as product attribute values, mapped to internal category attributes where possible.
9. Preserve source-only fields in `metadata` instead of forcing premature columns.

</details>

---

## Local Development

### Environment

Create a local env file:

```bash
cd services/product-service
cp .env.example .env
```

Default variables:

```env
NODE_ENV=development
PORT=3008
APP_VERSION=1.0.0
TYPEORM_LOGGING=false

POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=bin_ecommerce
POSTGRES_PASSWORD=changeme_postgres
POSTGRES_DB=bin_ecommerce_product
```

### Commands

```bash
npm run dev
npm run build
npm run start
npm run type-check
npm run lint
npm run test
```

### Database

For local development, TypeORM `synchronize` is enabled when `NODE_ENV !== production`.

For production, migrations should replace `synchronize` before this service owns write-heavy product workflows.

---

## Runtime Configuration

Product Service uses:

| Capability | Implementation |
| --- | --- |
| HTTP framework | NestJS 11 |
| Validation | Global `ValidationPipe` with whitelist and transform enabled |
| API versioning | URI versioning, default `/api/v1` |
| Database | PostgreSQL via TypeORM |
| Security headers | Helmet with environment-aware config |
| CORS | Disabled at service level; API Gateway should own browser-facing CORS |
| Docs | Swagger only in non-production |
| Shutdown | Nest shutdown hooks enabled |

---

## Production Notes

Recommended production setup:

```text
Frontend
  -> API Gateway
  -> Product Service
  -> PostgreSQL product database
```

Keep Product Service behind API Gateway. The gateway should handle public routing, authentication, rate limits and CORS.

Inject environment variables with one of:

```text
AWS Secrets Manager
Kubernetes Secret
ECS Task Definition
GitHub Actions Secret
```

Do not share one root `.env` across production services.

---

## Roadmap

Near-term:

- Add importer endpoint or worker for Tiki mapped payloads.
- Add product write APIs for approved sellers.
- Add admin moderation status transitions.
- Add category attribute mapping for imported specifications.
- Add read models optimized for home/product listing pages.

Later:

- Event integration with inventory/order services.
- Search indexing pipeline.
- Price history and promotion snapshots.
- Product audit log.
- Seller ownership checks for product mutations.

---

## Project Layout

```text
src/
├── common/
│   └── config/
│       └── helmet.config.ts
├── database/
│   └── entities/
│       ├── product.entity.ts
│       ├── product-variant.entity.ts
│       ├── product-option.entity.ts
│       ├── product-option-value.entity.ts
│       ├── product-variant-option-value.entity.ts
│       ├── product-image.entity.ts
│       ├── inventory.entity.ts
│       ├── brand.entity.ts
│       ├── external-shop.entity.ts
│       ├── product-attribute-value.entity.ts
│       └── product-review.entity.ts
├── modules/
│   ├── health/
│   └── products/
│       ├── controllers/
│       ├── dto/
│       ├── enums/
│       ├── services/
│       └── types/
├── app.module.ts
└── main.ts
```

---

## FAQ

### Why does Product Service store `category_id` without a foreign key?

Category data belongs to Catalog Service. In a microservice setup, Product Service stores the internal category UUID as a logical reference instead of creating a cross-database foreign key.

### Why does Product Service have `external_shops`?

Crawler imports need source shop data for display and traceability. `external_shops` keeps that source context without pretending the external shop is an approved Bin seller.

### Why are product attributes not stored directly on `products.metadata`?

Structured attributes power filters, comparison tables and validation. `metadata` is reserved for source-specific fields that are not stable enough to model yet.

---

## License

Private project for Bin E-Commerce.
