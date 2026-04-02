# Unified Commerce

Backend API for **URL-driven product ingestion**, a **catalog** with markup-based sale prices, **cart and checkout**, and **Paystack / Stripe** payments. Built with [NestJS](https://nestjs.com/) and TypeScript.

Retail product pages are opened in a real browser (**Playwright**) via site-specific scrapers (Apple, Amazon, Jumia, Nike, Shein, …) plus a generic JSON-LD / Open Graph fallback. Heavy imports run on a **BullMQ** worker, not on the HTTP thread.

---

## Features

| Area | Notes |
|------|--------|
| **Auth** | JWT access + refresh; forgot / reset password (email via Resend); roles include `USER`, `ADMIN_STAFF`, `ADMIN_SUPER`. |
| **Product import** | `POST /products/import` with a product URL → queued scrape → upsert into Postgres. Re-importing the same URL rescrapes and updates the row. |
| **Catalog** | Public `GET /products` (recent items, `?limit=`) and `GET /products/:id`. Admin full list: `GET /admin/products`. |
| **Realtime** | Socket.IO `/realtime`: `import.subscribe` / `import.updated` for import status; `order.updated` with JWT. |
| **Cart & orders** | Authenticated cart, order creation, re-scrape at checkout for price refresh. |
| **Payments** | Paystack and Stripe (redirect / Checkout); webhooks update order state. |
| **Admin** | Orders, products, optional synchronous scrape preview (`POST /admin/scrape-preview`). |

---

## Requirements

- **Node.js** (LTS recommended)
- **pnpm**
- **PostgreSQL** (`DATABASE_URL`)
- **Redis** — required for **BullMQ** (import queue) and URL→product cache; imports will not complete without a worker + Redis.
- **Playwright** — Chromium is used at runtime; run `pnpm exec playwright install` if browsers are missing.

---

## Quick start

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env
# Edit .env: DATABASE_URL, REDIS_URL, JWT_*_SECRET, etc.
pnpm run start:dev
```

- API default: `http://localhost:3000` (or `PORT` from `.env`).
- OpenAPI UI: `http://localhost:3000/docs` (or `/api-docs`).
- Discovery: `GET /api` for doc URLs.

---

## Environment

Copy **`.env.example`** and set at least:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis for BullMQ + optional cache |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Strong secrets (min length enforced in validation) |
| `PAYSTACK_*` / `STRIPE_*` | Enable payments when configured |
| `SCRAPE_PROXY` | Optional HTTP proxy for Playwright (recommended for strict sites such as Amazon) |
| `SCRAPE_LOCALE`, `SCRAPE_ACCEPT_LANGUAGE`, `SCRAPE_TIMEZONE_ID` | Pin storefront locale (e.g. US Apple/Amazon HTML) |

See **`.env.example`** and `src/config/env.validation.ts` for the full list.

---

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm run start:dev` | Dev server with watch |
| `pnpm run build` | Compile to `dist/` |
| `pnpm run start:prod` | Run `node dist/main` |
| `pnpm run lint` | ESLint |
| `pnpm run test` | Unit tests |
| `pnpm run test:e2e` | E2E tests |
| `pnpm run seed` | Seed script (`src/seed/seed.ts`) |
| `pnpm run migration:run` | TypeORM migrations |

---

## Architecture

```
Client → POST /products/import → Bull queue → Worker → ScraperService → Playwright + adapter → ScrapedProduct → DB upsert
```

- **Scraper layout & proxy:** [`docs/SCRAPER_ARCHITECTURE.md`](docs/SCRAPER_ARCHITECTURE.md)
- **Frontend / mobile integration (routes, auth, Socket.IO):** [`docs/API_INTEGRATION.md`](docs/API_INTEGRATION.md)
- **Product page UI (pricing, variants, images):** [`docs/PRODUCT_PAGE_UI_GUIDE.md`](docs/PRODUCT_PAGE_UI_GUIDE.md)
- **Periodic rescrape (cron idea):** [`docs/CRON_RESCRAPE.md`](docs/CRON_RESCRAPE.md)

Source highlights:

| Path | Role |
|------|------|
| `src/scraper/` | Adapters, Playwright service, source detection |
| `src/product-import/` | Import API, Bull enqueue, Redis lock, Socket emits |
| `src/jobs/processors/` | Scrape worker, verify-price job, notifications |
| `src/products/` | Entities, upsert from scrape, public + admin reads |
| `src/realtime/` | Socket.IO gateway (`import.*`, `order.updated`) |

---

## Operations

- **Worker logs:** On startup you should see `[job:scrape] worker=ready`. If imports stay `QUEUED`, check `REDIS_URL` and that the app process loads `JobsModule`.
- **Amazon / bot-heavy sites:** Prefer **`SCRAPE_PROXY`** (residential or a provider such as Scrape.do); see `docs/SCRAPER_ARCHITECTURE.md`.
- **Docker:** A `Dockerfile` is present for container builds; align env vars with production secrets and a persistent Redis.

---

## License

`private: true` / `UNLICENSED` in `package.json` — set your own license if you open-source the project.
