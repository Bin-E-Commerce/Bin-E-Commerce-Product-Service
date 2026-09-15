<div align="center">
  <img src="https://raw.githubusercontent.com/Bin-E-Commerce/Bin-E-Commerce-UI-Web/main/public/images/logo/logo_background_white.png" alt="Bin E-Commerce" width="220" />

  # Product Service

  Give customers trustworthy products to discover, sellers a controlled catalog to manage, and checkout an authoritative stock source.

  <p>
    <img src="https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white" alt="NestJS 11" />
    <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.7" />
    <img src="https://img.shields.io/badge/PostgreSQL-336791?logo=postgresql&logoColor=white" alt="PostgreSQL" />
    <img src="https://img.shields.io/badge/TypeORM-FE0803?logo=typeorm&logoColor=white" alt="TypeORM" />
    <img src="https://img.shields.io/badge/Kafka-231F20?logo=apachekafka&logoColor=white" alt="Kafka" />
    <img src="https://img.shields.io/badge/Helmet-安全-4B5563" alt="Helmet security headers" />
  </p>

  [Portfolio](https://daongocanh.site)
</div>

---

## Table of contents

1. [Problem](#1-problem)
2. [Service at a glance](#2-service-at-a-glance)
3. [Responsibility and boundaries](#3-responsibility-and-boundaries)
4. [Trust surface](#4-trust-surface)
5. [See it work](#5-see-it-work)
6. [Installation](#6-installation)
7. [Architecture](#7-architecture)
8. [Product model](#8-product-model)
9. [Product lifecycle](#9-product-lifecycle)
10. [Inventory and checkout contract](#10-inventory-and-checkout-contract)
11. [Reviews and media](#11-reviews-and-media)
12. [Catalog integration and events](#12-catalog-integration-and-events)
13. [API reference](#13-api-reference)
14. [Project structure](#14-project-structure)
15. [Configuration](#15-configuration)
16. [Local development](#16-local-development)
17. [Testing](#17-testing)
18. [Security and data integrity](#18-security-and-data-integrity)
19. [Operations](#19-operations)
20. [FAQ](#20-faq)
21. [Ownership](#21-ownership)

---

## 1. Problem

An e-commerce product is not just a name and a price. The storefront needs a fast public read model, sellers need an owned product workspace, checkout needs authoritative price and stock checks, reviews need purchase proof, and other services need stable catalog events.

If these rules are spread across the frontend, Cart Service, Order Service, or Seller Service, each workflow can make a different decision about whether a product is visible, purchasable, in stock, or owned by a seller.

Product Service is the boundary for product aggregates and the operations that directly affect their commercial availability. It keeps product, variant, option, image, inventory, review, and checkout-reservation rules close to their data while exposing focused contracts to the rest of the platform.

---

## 2. Service at a glance

| Property | Value |
| --- | --- |
| Runtime | Node.js with NestJS 11 |
| Language | TypeScript |
| Default HTTP port | 3008 |
| HTTP prefix | /api |
| URI version | /v1 |
| Database | PostgreSQL |
| ORM | TypeORM |
| Event integration | Kafka producer and catalog event outbox |
| Security middleware | Helmet |
| Health endpoint | GET /api/health |
| API documentation | GET /docs outside production |
| Database schema policy | Migrations only; synchronize is disabled |

### What this service provides

- public product listing, detail, shop summary, and external-shop reads;
- seller-owned product creation and management;
- product variants, options, attributes, images, videos, and package data;
- product status transitions and soft deletion;
- stock availability and checkout reservation;
- quote, reserve, release, and idempotent reservation behavior;
- customer review creation and update;
- review likes and current-user review state;
- review-media cleanup through Media Service;
- AI product-image apply and rollback workflow;
- catalog snapshots for internal consumers;
- catalog change events for downstream projections.

### What this service does not own

- authentication, access-token validation, or user accounts;
- category taxonomy and category attributes;
- seller shop profile and seller onboarding;
- binary media storage and CDN delivery;
- order state and payment state;
- shipping calculation;
- recommendation ranking.

---

## 3. Responsibility and boundaries

### Product Service owns

| Area | Responsibility |
| --- | --- |
| Product aggregate | Product identity, content, status, source, prices, ratings, and references |
| Variants | SKU, variant options, variant price, and variant-level availability |
| Product options | Groups such as color, size, and capacity |
| Product media references | Image and video references owned by Media Service |
| Inventory | Available, reserved, sold, and low-stock quantities |
| Checkout reservations | Reservation ledger and compensation state |
| Reviews | Review content, publication state, purchase proof reference, and likes |
| Catalog integration | Validated category references and downstream catalog events |
| Seller access | Ownership and permission checks for seller product operations |

### Other services own

| Area | Owner | Product Service interaction |
| --- | --- | --- |
| Identity and permissions | Auth Service / API Gateway | Receives trusted user context |
| Categories and attributes | Catalog Service | Validates category and attribute references |
| Shop ownership/profile | Seller Service | Resolves seller shop and shipping readiness |
| Files and CDN assets | Media Service | Upload, cleanup, and AI-media integration |
| Order purchase proof | Order Service | Confirms review eligibility |
| Order orchestration | Order Service | Calls quote, reserve, and release |
| Shipping rules | Shipping Service | Product stores package dimensions for integration |
| Recommendations | Recommendation Service | Consumes catalog snapshots/events |

The service stores cross-service IDs as logical references. It does not create foreign keys into another service's database.

---

## 4. Trust surface

Product Service receives network requests and events from several boundaries. The important rules are:

- public storefront routes return only products eligible for public visibility;
- seller routes derive the seller identity from trusted Gateway headers;
- a client cannot choose another seller's shop by submitting an arbitrary shop ID;
- internal checkout routes require the shared internal service token;
- category and attribute data are validated through Catalog Service;
- review creation uses the authenticated user and purchase proof from Order Service;
- Media Service remains the owner of uploaded files;
- AI image output is applied only after product ownership, capability, and version checks;
- database schema changes run through migrations, never runtime synchronization.

The service uses a global ValidationPipe with whitelist and forbidNonWhitelisted enabled. UUID route parameters are validated before repository queries.

<details>
<summary><b>What can each caller change?</b></summary>

| Caller | Allowed surface |
| --- | --- |
| Anonymous/customer storefront | Public product reads and public review reads |
| Authenticated customer | Create/update eligible reviews, like or unlike public reviews |
| Seller | Manage products owned by the current seller |
| Order Service | Quote, reserve, and release inventory through internal routes |
| Seller Service | Read the minimum product count needed for shop rules |
| Recommendation workflows | Read a paginated catalog snapshot |
| Catalog integration | Receive product changes through catalog events |

The exact permissions are enforced by the application services and shared authorization contracts. Controllers should remain transport adapters and must not become a second authorization implementation.

</details>

---

## 5. See it work

### Start the service

~~~powershell
cd services/product-service
Copy-Item .env.example .env
npm install
npm run dev
~~~

### Check health

~~~powershell
curl http://localhost:3008/api/health
~~~

Expected shape:

~~~json
{
  "status": "ok",
  "service": "product-service",
  "environment": "development",
  "checks": {
    "http": { "status": "ok" },
    "postgres": {
      "status": "up",
      "type": "postgres"
    },
    "memory": {
      "status": "ok"
    }
  }
}
~~~

### Read the public catalog

~~~powershell
curl "http://localhost:3008/api/v1/products?page=1&pageSize=20"
~~~

### Read one product

~~~powershell
curl "http://localhost:3008/api/v1/products/{productId}"
~~~

Seller and internal operations require the headers and internal credentials supplied by API Gateway or the calling service. For a full checkout test, call quote, reserve, then release with the same reservation key and confirm the second request is idempotent.

---

## 6. Installation

### Prerequisites

- Node.js version supported by the monorepo;
- npm or the repository package manager;
- PostgreSQL;
- Kafka when testing catalog integration and event publishing;
- Auth, Catalog, Seller, Media, and Order services for full integration;
- shared packages available from the repository root.

### Install dependencies

From the repository root:

~~~bash
npm install
~~~

Or use the package manager and lockfile already selected by the repository.

### Create local configuration

~~~powershell
Copy-Item .env.example .env
~~~

Set PostgreSQL credentials and local service URLs before starting the process. The service runs migrations automatically on startup, but TypeORM synchronize is deliberately disabled.

> [!IMPORTANT]
> Product Service writes to PostgreSQL and can publish events to Kafka. It can call Auth, Seller, Catalog, Media, and Order services. Local configuration is read from .env; production secrets must come from the deployment secret manager. To disable the service, stop its process or container. To remove local data, drop only the dedicated development database after confirming it is not shared with another service.

### Production build

~~~bash
npm run type-check
npm run lint
npm test -- --runInBand
npm run build
npm run start
~~~

---

## 7. Architecture

~~~text
+-------------------+       public HTTP       +-------------------------+
| Web application   | ----------------------> |                         |
| API Gateway       |                          |  Product Service        |
+-------------------+                          |                         |
                                               |  Storefront reads       |
+-------------------+       internal HTTP      |  Seller product writes  |
| Order Service     | ----------------------> |  Reviews                |
| Seller Service    |                          |  Inventory reservations |
| Catalog Service   |                          |  PostgreSQL persistence  |
+-------------------+                          +------------+------------+
                                                            |
                                                            v
                                                   +--------+--------+
                                                   | Kafka / outbox  |
                                                   | catalog events  |
                                                   +--------+--------+
                                                            |
                         +------------------+---------------+----------------+
                         v                  v                                v
                  Catalog projection  Recommendation       Other consumers
~~~

### Request boundaries

~~~text
Storefront request
  -> public query DTO validation
  -> active/visible product query
  -> product and variant read model
  -> paginated response

Seller mutation
  -> trusted user context
  -> permission and ownership check
  -> Catalog and Seller validation
  -> PostgreSQL transaction
  -> media reference reconciliation
  -> catalog event/outbox publication

Checkout reservation
  -> internal token guard
  -> product, variant, price, and stock revalidation
  -> reservation ledger
  -> inventory update in transaction
  -> deterministic response for retry
~~~

### Layering

- presentation contains controllers, DTOs, guards, and HTTP contracts;
- application contains use-case services, clients, policies, and response types;
- infrastructure contains database access, external clients, Kafka integration, and persistence details;
- database contains entities, enums, and migrations.

---

## 8. Product model

### Product aggregate

A product stores:

- internal UUID and unique slug;
- internal or external origin;
- seller shop and seller owner references;
- Catalog category and optional brand references;
- name, descriptions, condition, origin, and package dimensions;
- product-level SKU and GTIN;
- product status and soft-deletion metadata;
- minimum and maximum active-variant prices;
- sold, rating, review, and view counters;
- catalog revision;
- image and video references;
- optional AI optimization state;
- external platform/source metadata.

### Variants and options

Variants represent purchasable SKUs. Options describe the dimensions used to select a variant, such as:

- color;
- size;
- storage;
- capacity;
- material.

A product can have multiple options and option values. Each variant can map to option values and has its own price, SKU, status, stock quantity, and inventory record.

### Product status

The product status enum is the source for storefront visibility and seller lifecycle rules. The current data model supports:

- DRAFT;
- ACTIVE;
- INACTIVE;
- DELETED.

Soft deletion keeps lifecycle history and allows a permitted seller to restore a product to the appropriate inactive state. A deleted product is not treated as a normal public listing.

### Internal and external origin

Product origin distinguishes:

- products created and managed by Bin E-Commerce sellers;
- products imported from external shops or platforms.

External shop records and source identifiers prevent crawler re-runs from creating duplicate products. Product Service does not redirect customers to the original platform as part of the public product contract.

---

## 9. Product lifecycle

### Seller creation

1. Gateway authenticates the seller.
2. Product Service builds the seller context from trusted headers.
3. The service verifies create permission and shop ownership.
4. Catalog Service validates category, attributes, and brand references.
5. Media references are normalized and checked.
6. Product, variants, options, attributes, and inventory are saved in one transaction.
7. A catalog change is recorded for downstream consumers.

### Seller update

Updates replace the product graph carefully:

- product content is validated;
- the current status is preserved when the endpoint is only for content changes;
- variant and inventory data are reconciled;
- stale media references are cleaned only when no other product still references them;
- price range and catalog revision are recalculated;
- downstream consumers receive a change event.

### Status transition

Status changes use a dedicated endpoint so publishing or hiding a product is not accidentally mixed with content edits.

Before an internal product becomes active, the service checks the rules required for a sellable listing, including shop and shipping readiness. Status changes are persisted transactionally and published to the catalog integration.

### Delete and restore

Delete is a soft-delete operation that records:

- deletion timestamp;
- deleting user;
- deleted status.

Restore is permission- and ownership-protected. A restored product returns to an inactive workflow so a seller can review it before making it active again.

### Revision safety

catalogRevision increases monotonically for catalog snapshots, including availability changes. Downstream consumers can compare revisions and ignore stale events that arrive out of order.

---

## 10. Inventory and checkout contract

Inventory is stored per product variant:

| Field | Meaning |
| --- | --- |
| quantityAvailable | Units currently available for sale |
| quantityReserved | Units held by active checkout operations |
| quantitySold | Units completed as sold |
| lowStockThreshold | Seller alert threshold |
| updatedAt | Last inventory update |

### Internal endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| POST | /api/v1/internal/checkout/quote | Revalidate and return checkout-relevant values without reserving |
| POST | /api/v1/internal/checkout/reserve | Validate and reserve stock before order creation |
| POST | /api/v1/internal/checkout/release | Compensate a reservation when order persistence fails |

All three routes are protected by InternalServiceGuard.

### Reservation ledger

checkout_reservations stores:

- reservationKey;
- reservation status;
- deterministic response;
- creation timestamp;
- release timestamp.

The unique reservation key is the retry boundary. A repeated reserve request returns the existing result rather than decrementing stock a second time. Release is also designed as an explicit compensation operation.

### Checkout sequence

~~~text
Cart / Order Service
  -> quote current product and package values
  -> reserve using a stable reservation key
  -> create the order snapshot
  -> release if order persistence fails
  -> continue with order and payment workflow
~~~

Order Service owns order orchestration and snapshots. Product Service owns the consistency of price, availability, and reservation state at the time of the call.

---

## 11. Reviews and media

### Review eligibility

A customer review is not accepted solely because a user knows a product ID. Product Review Service uses Order Service integration to verify the purchase and review context.

The review workflow includes:

- create review for a product;
- update the current user's review;
- retrieve the current user's review state for an order;
- like or unlike a public review;
- clean up uploaded review media that is no longer referenced.

### Review ownership

- authenticated identity comes from Gateway headers;
- review updates verify the current reviewer;
- public like/unlike is idempotent;
- review visibility and publication rules are enforced in the application service;
- reviewer display data can be stored as a snapshot so historical reviews do not depend on a live profile response.

### Media boundary

Media Service owns files, storage, processing, and CDN URLs. Product Service stores references and coordinates cleanup.

A product image or review video reference should be removed from Media Service only when the reference is stale and no other product or review still uses it.

### AI product-media workflow

Seller product routes support:

- apply an AI-generated media result;
- rollback a previously applied AI result.

The operation is protected by seller capability and ownership checks. The product stores job ID, optimization status, timestamp, and image lineage so the seller can recover the previous state and later cleanup can distinguish original from generated assets.

---

## 12. Catalog integration and events

Product Service publishes catalog integration changes for consumers such as Catalog projections and Recommendation backfills.

A catalog snapshot contains the minimum fields needed by downstream consumers:

- product ID, name, slug, and image;
- category and brand references;
- seller and external-shop references;
- price range and rating data;
- review count and total sold;
- status and stock availability;
- created and updated timestamps;
- catalog version;
- normalized semantic fields;
- content hash.

Sensitive owner, payment, and internal persistence fields are not part of the snapshot contract.

### Snapshot endpoint

~~~text
GET /api/v1/internal/products/catalog-snapshot?page=1&pageSize=100
~~~

The endpoint is internal and paginated. It can be used for a controlled backfill instead of loading the whole catalog into memory.

### Event delivery

The Kafka producer uses the configured broker list and a product-service client ID. Event publication is best-effort at the producer boundary; database state must remain valid even when Kafka is temporarily unavailable.

The catalog outbox and revision strategy exist to let downstream consumers converge after broker recovery without treating an event delivery failure as permission to corrupt the product transaction.

---

## 13. API reference

All routes are below /api/v1 when URI versioning is enabled.

### Storefront

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /products | Public product listing with query filters and pagination |
| GET | /products/:id | Public product detail by UUID |
| GET | /products/shops/:shopId/summary | Public summary for an internal seller shop |
| GET | /products/external-shops/:slug | Public external-shop page and catalog information |
| GET | /products/external-shops/:shopId/summary | Summary for an external shop UUID |
| GET | /brands | Brand listing |

### Seller products

| Method | Route | Purpose |
| --- | --- | --- |
| POST | /seller/products | Create an owned product graph |
| GET | /seller/products | List products owned by the current seller |
| GET | /seller/products/:productId | Read one owned product |
| PUT | /seller/products/:productId | Update the owned product graph |
| DELETE | /seller/products/:productId | Soft-delete an owned product |
| POST | /seller/products/:productId/restore | Restore a soft-deleted product |
| PATCH | /seller/products/:productId/status | Change ACTIVE or INACTIVE lifecycle state |
| POST | /seller/products/:productId/ai-media/apply | Apply an authorized AI media result |
| POST | /seller/products/:productId/ai-media/rollback | Roll back an applied AI media result |

### Reviews

| Method | Route | Purpose |
| --- | --- | --- |
| POST | /products/:productId/reviews | Create a product review |
| PATCH | /products/reviews/:reviewId | Update the current user's review |
| GET | /reviews/me?orderId=... | Read the current user's review state |
| PUT | /reviews/:reviewId/like | Like a public review |
| DELETE | /reviews/:reviewId/like | Remove a review like |
| POST | /products/reviews/media/cleanup | Clean up unused uploaded review media |

### Internal

| Method | Route | Purpose |
| --- | --- | --- |
| POST | /internal/checkout/quote | Quote product and availability |
| POST | /internal/checkout/reserve | Reserve inventory |
| POST | /internal/checkout/release | Release inventory |
| GET | /internal/products/shops/:shopId/active-count | Return active owned product count |
| GET | /internal/products/catalog-snapshot | Return a paginated catalog snapshot |

### Health and documentation

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /health | Report HTTP, PostgreSQL, and process health |
| GET | /docs | Swagger UI outside production |

Route-level DTO validation rejects unexpected fields and invalid UUIDs. Internal routes require the internal service guard.

---

## 14. Project structure

~~~text
services/product-service/
+-- src/
|   +-- main.ts
|   +-- app.module.ts
|   +-- common/
|   |   +-- config/
|   |       +-- helmet.config.ts
|   +-- database/
|   |   +-- catalog/
|   |   |   +-- entities/
|   |   |   +-- enums/
|   |   +-- checkout/
|   |   |   +-- entities/
|   |   |   +-- enums/
|   |   +-- inventory/
|   |   |   +-- entities/
|   |   +-- reviews/
|   |   |   +-- entities/
|   |   +-- integration/
|   |       +-- entities/
|   |   +-- migrations/
|   +-- kafka/
|   |   +-- kafka.module.ts
|   |   +-- kafka-producer.service.ts
|   +-- modules/
|       +-- brands/
|       +-- checkout-inventory/
|       |   +-- application/
|       |   +-- presentation/
|       +-- health/
|       +-- internal/
|       +-- reviews/
|       |   +-- application/
|       |   +-- presentation/
|       +-- seller-products/
|       |   +-- application/
|       |   +-- presentation/
|       +-- storefront/
|           +-- application/
|           +-- presentation/
+-- .env.example
+-- package.json
+-- tsconfig.json
+-- README.md
~~~

### Module responsibilities

- storefront serves public reads without seller mutation logic;
- seller-products contains seller authorization, management, lifecycle, validation, and media workflows;
- checkout-inventory protects internal stock operations;
- reviews coordinates purchase proof, reviewer identity, media references, and likes;
- internal exposes narrow contracts for trusted services;
- database keeps persistence entities and migrations in one schema boundary;
- kafka publishes integration events and supports recovery through the outbox/revision design.

---

## 15. Configuration

Use [.env.example](./.env.example) as the canonical local template.

| Variable | Required | Purpose |
| --- | --- | --- |
| NODE_ENV | No | development or production behavior |
| PORT | No | HTTP port, default 3008 |
| APP_VERSION | No | Version returned by health |
| TYPEORM_LOGGING | No | Enable TypeORM logging when true |
| POSTGRES_HOST | Yes | PostgreSQL host |
| POSTGRES_PORT | No | PostgreSQL port, default 5432 |
| POSTGRES_USER | Yes | PostgreSQL user |
| POSTGRES_PASSWORD | Yes | PostgreSQL password |
| POSTGRES_DB | Yes | Product database name |
| INTERNAL_SERVICE_TOKEN | Yes for internal routes | Shared service-to-service credential |
| ORDER_SERVICE_URL | Yes for review and checkout integration | Order Service base URL |
| AUTH_SERVICE_URL | Yes for identity integration | Auth Service base URL |
| SELLER_SERVICE_URL | Yes for seller validation | Seller Service base URL |
| CATALOG_SERVICE_URL | Yes for category validation | Catalog Service base URL |
| MEDIA_SERVICE_URL | Yes for media workflows | Media Service base URL |
| KAFKA_BROKERS | Yes for events | Comma-separated broker addresses |
| KAFKA_CLIENT_ID | No | Kafka producer client ID |

### Configuration rules

- use .env.local for developer overrides that must not be committed;
- inject production secrets through the deployment platform;
- keep service URLs environment-specific;
- do not enable TypeORM synchronize in production;
- use TLS and least-privilege database credentials in production;
- rotate internal tokens without placing them in event payloads or logs.

---

## 16. Local development

### Commands

~~~bash
npm run dev
npm run type-check
npm run lint
npm test
npm run build
npm run start
~~~

### Development sequence

1. Start PostgreSQL and create the product database.
2. Start Kafka when testing catalog event publishing.
3. Copy .env.example to .env.
4. Start Catalog, Seller, Media, Auth, and Order services for integrated flows.
5. Start Product Service in watch mode.
6. Verify health and Swagger.
7. Test public listing and product detail.
8. Test seller create, update, status, delete, and restore with a trusted user context.
9. Test quote, reserve, repeat reserve, and release with a stable reservation key.
10. Test review purchase proof, media cleanup, and like/unlike behavior.
11. Inspect PostgreSQL rows, migration state, outbox state, and Kafka events.

### Swagger

When NODE_ENV is not production:

~~~text
http://localhost:3008/docs
~~~

Swagger documents the HTTP boundary. Shared Kafka event contracts and internal payloads remain the source of truth for service-to-service integration.

---

## 17. Testing

### Unit tests

The existing test structure covers important application rules, including:

- seller access and permission decisions;
- product validation;
- status transition behavior;
- soft delete and restore;
- AI media apply and rollback;
- checkout reservation behavior;
- review service behavior;
- storefront query behavior;
- review notification/event policy helpers where applicable.

### Critical test cases

#### Product management

- reject unauthenticated or unauthorized seller access;
- reject a product owned by another seller;
- validate category, attributes, and brand references;
- preserve status during content-only updates;
- calculate min and max variant prices correctly;
- prevent invalid lifecycle transitions;
- delete and restore only the correct product.

#### Inventory

- quote does not mutate stock;
- reserve checks current price and status;
- reserve rejects insufficient quantity;
- repeated reservation key returns the existing result;
- release compensates only the correct reservation;
- concurrent updates do not produce negative available stock.

#### Reviews

- create requires valid purchase proof;
- update requires the review owner;
- public visibility rules are respected;
- likes are idempotent;
- media cleanup does not delete a referenced asset;
- reviewer snapshots remain safe for historical display.

#### Integration

- catalog events contain the correct revision;
- stale event versions are not allowed to overwrite a newer projection;
- Kafka outage does not corrupt the committed product transaction;
- internal routes reject missing or invalid service tokens;
- migration runs cleanly on an empty and existing database.

### Recommended commands

~~~bash
npm run type-check
npm run lint
npm test -- --runInBand
npm run build
~~~

---

## 18. Security and data integrity

- place Product Service behind API Gateway in production;
- accept user identity only from trusted Gateway context;
- protect internal routes with InternalServiceGuard;
- keep INTERNAL_SERVICE_TOKEN outside source control;
- validate all DTOs with whitelist and forbidNonWhitelisted;
- validate UUID route parameters before database access;
- use Helmet security headers;
- use parameterized TypeORM queries and repository APIs;
- keep cross-service IDs as logical references without unsafe cross-database assumptions;
- use transactions for product-graph updates and inventory mutations;
- keep reservation keys unique;
- preserve source media unless no reference remains;
- do not trust client-submitted price or stock during checkout;
- avoid logging full customer, seller, or review payloads;
- sanitize or constrain rich product descriptions before rendering;
- do not expose internal owner, payment, reservation, or service credentials in public responses;
- apply database migrations through controlled deployment steps.

---

## 19. Operations

### Health

GET /api/health reports:

- HTTP process status;
- PostgreSQL initialization state;
- database type and name;
- application version and environment;
- uptime;
- process memory.

The service reports degraded when PostgreSQL is not initialized.

### Observability

Track:

- public listing and detail latency;
- seller mutation latency and error rate;
- checkout quote/reserve/release latency;
- reservation conflict and insufficient-stock rate;
- PostgreSQL connection pool usage;
- migration status;
- Kafka publish failures;
- catalog outbox backlog;
- review media cleanup failures;
- external service timeout and error rates.

### Scaling

Product Service instances can share the same PostgreSQL database and Kafka integration when:

- migrations are applied before serving traffic;
- all instances run compatible contracts;
- reservation transactions use the same database;
- outbox dispatch is coordinated to avoid duplicate publication;
- connection pool sizes are sized for the database rather than multiplied without limit.

### Recovery

- PostgreSQL is the source of truth for product and inventory state;
- Kafka publication can recover through outbox processing and catalog revisions;
- checkout compensation uses the reservation ledger;
- media cleanup can be retried after a downstream outage;
- product deletion is soft deletion, allowing an authorized restore workflow.

---

## 20. FAQ

### Why does Product Service own inventory instead of Order Service?

Order Service orchestrates checkout and owns the order snapshot. Product Service owns the current sellable quantity and the atomic reservation ledger so every checkout path uses one stock authority.

### Why does the storefront not call Catalog Service for every product?

Product Service stores validated category references and serves the product read model. Catalog Service remains the taxonomy owner, while Product Service avoids coupling every product page to several synchronous calls.

### Can a seller send sellerShopId in the request to create a product?

The backend must derive ownership from trusted identity and the seller context. A client-provided shop ID cannot grant access to another shop.

### What happens when Kafka is unavailable?

The database transaction remains the product state authority. Event publication is handled through the integration/outbox strategy so downstream projections can catch up after broker recovery.

### Why are media files not stored in PostgreSQL?

Media Service owns binary storage and CDN delivery. Product Service stores references and lifecycle metadata, which keeps product transactions smaller and prevents two services from owning the same file.

### Can a deleted product appear in the storefront?

A deleted product is excluded from normal public visibility. Restore is a protected seller operation and returns the product to a reviewable inactive state.

### Is AI image optimization allowed to overwrite the original image?

The apply and rollback workflow keeps lineage and previous-state information. Product Service applies only an authorized, version-checked result and can roll back the selected job.

---

## 21. Ownership

### Engineering

**Đào Ngọc Anh**

**Software Engineer**

[View portfolio](https://daongocanh.site)

Software Engineer responsible for the architecture, implementation, integration, and maintenance of this service.

### Architecture and API design

**Đào Ngọc Anh**

Designed the product aggregate boundary, seller ownership rules, inventory reservation contract, review lifecycle, catalog integration, and Media Service coordination for the Bin E-Commerce ecosystem.
