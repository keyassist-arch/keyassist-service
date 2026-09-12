# Scraper architecture (Scrape.do–style mapping)

This backend is a **product ingestion engine**, not a full scraping-as-a-service product. The same **layers** you see in services like Scrape.do appear here in simpler form.

## Request flow

```
Client
  → POST /products/import  (or admin POST /admin/scrape-preview)
  → Product import service + BullMQ (production path)
  → Worker → ScraperService
  → Site detector + adapter → Playwright page
  → ScrapedProduct (normalized DTO)
  → ProductsService upsert
```

| Concept (Scrape.do) | This codebase |
|---------------------|---------------|
| Request API | `POST /products/import` (queued). Admin-only **`POST /admin/scrape-preview`** runs a **sync** scrape for debugging (no DB import row). |
| Rotating proxies | Optional **`SCRAPE_PROXY`** on each Playwright **browser context** (`PlaywrightService.newScrapeContext`). Plug in Bright Data, Smartproxy, etc. Full IP rotation is provider-side. |
| Browser layer | **Playwright** (Chromium), shared browser, per-scrape context. |
| Anti-bot (light) | No forced UA override — every context uses the launched Chromium's real `navigator.userAgent`/Client Hints (kept internally consistent), `--disable-blink-features=AutomationControlled` + StealthPlugin, a post-load humanize pass (delay/mouse/scroll), and a challenge-page detector (`PlaywrightService.detectBlock`) that flags Cloudflare/PerimeterX/Datadome/Akamai/CAPTCHA pages via `LoadedPage.blockedReason`. Site-specific adapters (Jumia, Amazon, Nike, Apple, Shein) + **generic** JSON-LD / OG fallback. |
| Normalized output | **`ScrapedProduct`** (`title`, `price`, `currency`, `images`, `variants`, …) then `ProductsService.buildProductFromScrape` + markup. |
| Queue / scale | **BullMQ** + Redis — scrapes **never** run on the HTTP thread for user imports. |

## Directory map

| Layer | Location |
|-------|----------|
| URL / site detection | `src/scraper/utils/detect-source.util.ts` |
| Scraper orchestration | `src/scraper/scraper.service.ts` |
| Playwright lifecycle | `src/scraper/playwright.service.ts` (`getBrowser`, `newScrapeContext`) |
| Proxy parsing | `src/scraper/utils/parse-scrape-proxy.util.ts` |
| Locale / language / timezone | Env `SCRAPE_LOCALE`, `SCRAPE_ACCEPT_LANGUAGE`, `SCRAPE_TIMEZONE_ID` → `PlaywrightService.newScrapeContext` (defaults: `en-US`, `en-US,en;q=0.9`, `America/Los_Angeles`). Reduces wrong-region HTML (e.g. `content-language: ko-KR`) vs [Apple US buy pages](https://www.apple.com/shop/buy-iphone/iphone-air). |
| Bot-wall/challenge detection | `PlaywrightService.detectBlock` (private, called from `loadPage`) |
| Site adapters | `src/scraper/adapters/*.adapter.ts` |
| Normalized shape | `src/scraper/interfaces/scraped-product.interface.ts` |
| Queue worker | `src/jobs/processors/scrape-product.processor.ts` |

## Phases (what to add later)

1. **Done (MVP):** Playwright, adapters, Bull queue, retries on the job, optional proxy env, UA pool + adapter overrides.
2. **Next:** Stronger timeouts/backoff per domain, structured scrape logging, HTTP+Cheap parse path only where safe (many retail PDPs need JS).
3. **Heavy:** CAPTCHA services, session stores, geo endpoints per job, multi-proxy rotation without a single `SCRAPE_PROXY` URL.

## Environment

- **`SCRAPE_PROXY`** — optional; applied in `newScrapeContext` (and can be overridden per call later).
- **`SCRAPE_LOCALE` / `SCRAPE_ACCEPT_LANGUAGE` / `SCRAPE_TIMEZONE_ID`** — pin US (or other) storefront behavior; Scrape.do–like responses often differ by IP + cookies + `Accept-Language`.
- **`REDIS_URL`** — required for queued imports to run in workers.

### Reference HTML: `amazon.html` and Scrape.do

The repo’s **`amazon.html`** snapshot was produced by hitting Amazon **through [Scrape.do](https://scrape.do)** (not by raw Playwright from your laptop). Response headers such as **`scrape.do-cookies`**, **`scrape.do-target-url`**, **`scrape.do-resolved-url`**, and **`scrape.do-initial-status-code`** are added by **Scrape.do on the HTTP response** to their client. They reflect a **managed Amazon session** (cookies, IP reputation, anti-bot handling). You will **not** see those headers inside Playwright when you open `amazon.com` directly; they are not something Amazon sends.

**What to expect in this codebase**

| How you scrape | What you get |
|----------------|--------------|
| Playwright with **no** proxy | Often bot walls, CAPTCHAs, or thin HTML on Amazon; adapters may fail or differ from `amazon.html`. |
| Playwright with **`SCRAPE_PROXY`** pointing at Scrape.do (or another US/residential proxy) | Closer to the full PDP Amazon serves real browsers; aligns better with `amazon.html` and the **Amazon adapter** selectors. |
| Scrape.do **HTTP API** (fetch HTML yourself) | You receive their wrapper response (those `scrape.do-*` headers + body). This app does **not** call that API today; it only supports proxying **Chromium** via `SCRAPE_PROXY`. |

**Scrape.do → Playwright proxy (typical pattern)**  
Use their **super proxy / gateway** URL from [their documentation](https://scrape.do/documentation/). Parsed by `parse-scrape-proxy.util.ts` as a normal HTTP proxy, e.g.:

```bash
# Token as HTTP basic user (exact host/port/password rules follow Scrape.do’s dashboard)
SCRAPE_PROXY=http://YOUR_SCAPE_DO_TOKEN@api.scrape.do:80
```

Confirm host, port, and whether a **password** or extra flags are required in your plan; encode special characters in the token per URL rules. Keep **`SCRAPE_LOCALE` / `SCRAPE_ACCEPT_LANGUAGE` / `SCRAPE_TIMEZONE_ID`** US-oriented for `amazon.com` PDPs.

Services such as Scrape.do combine **residential/datacenter IPs**, **session cookies** (surfacing as `scrape.do-cookies` on **their** response), and consistent **locale** so heavy PDPs render completely. Locally, **`SCRAPE_PROXY`** from a US-capable provider plus the locale env vars above is the supported way to approximate that; the Apple adapter parses **configuration lines** from the main content into `variants` and `product.description`.

## Ceiling of browser-level hardening (no `SCRAPE_PROXY` set)

Without `SCRAPE_PROXY`, every scrape leaves from the host's own egress IP — on Railway that's a shared datacenter range. Enterprise bot management (Akamai, PerimeterX, Datadome — what Amazon/Walmart/Nike run) blocks primarily on **IP reputation**, ahead of browser fingerprint. `PlaywrightService`'s hardening (consistent UA/Client Hints, stealth patches, humanize pass, challenge detection) closes real gaps and should measurably help sites with lighter protection (Etsy, eBay, Backmarket, Zara, Jumia, Reebelo, Converse), but it cannot fix a block keyed on the IP itself. Watch worker logs for `[playwright] loadPage blocked reason=...` — a `cloudflare-challenge`/`perimeterx`/`datadome`/`akamai-*`/`http-403`/`http-429` reason on a site that used to work through scrape.do is the signal that only `SCRAPE_PROXY` (or restoring scrape.do) fixes, not further browser-side tuning.

## Operational note

If **`POST /products/import`** returns `queued` but nothing moves, verify Redis and worker logs (`[job:scrape] worker=ready`, `worker=picked_job`). Sync **`POST /admin/scrape-preview`** is only for **short** debugging sessions; it ties up the API process and is throttled.

After each successful adapter run, **`ScraperService`** logs **`[scrape] raw_scrape … json=<full JSON>`** — the entire **`ScrapedProduct`** (title, price, currency, `images`, `description`, `brand`, **`variants`** `{ name, options[] }`, `availability`). If variants are empty in the log, the site adapter is not extracting them yet; extend the adapter to populate `variants` (and optionally add fields to `ScrapedProduct` + API later).

## Storefront notes (Apple / Amazon / generic)

Third-party writeups often suggest **`script#metrics`** and **`__NEXT_DATA__`** for Apple. In this repo:

| Source | Accuracy / usage here |
|--------|------------------------|
| **`script#metrics`** | On captured `apple.html`, JSON is `data.products[]` (each: `sku`, `partNumber`, `name`, `price.fullPrice`). **Not** a single blob at `data.products[0]` for the whole PDP — it is a **per-SKU list**. The **Apple adapter** reads this block and uses it for: query params (`part`, `sku`, …) → slug match (storage + color in the last path segment) → fallback **minimum** `fullPrice` when matrix strings are messy. JSON-LD + the product matrix remain the source for **copy, images, and configuration lines**. |
| **`__NEXT_DATA__`** | Some Apple **www** marketing pages use Next.js; **store** buy URLs in our snapshots are not relying on it. Keep as an optional fallback only if you confirm it on the exact template you scrape. |
| **Amazon** | Real price often appears under **`#corePrice_feature_div`** / related blocks, not only `.a-price`; variants may refresh via XHR after swatches. This codebase already biases selectors that way; **`SCRAPE_PROXY`** + US locale env vars matter. Optional hardening (not required for MVP): `page.route` on variant fetches, **`waitForPriceStability`** polling after paint. |
| **JSON-LD “list price” vs sale** | On some marketplaces, structured data shows **MRP** while the DOM shows the **sale** price. The **generic** adapter prefers JSON-LD first; if a site systematically lies in schema, add or tighten a **site adapter** (same idea as Jumia: DOM / `data-price` override). |
| **Shared price normaliser** | Useful when you persist **list vs sale** from arbitrary strings. Today, catalog **sale** price is still driven by **`originalPrice` + markup** after scrape; a dedicated **`normalisePrice`** module is optional unless you extend **`ScrapedProduct`** and DB columns. |
| **Raw scrape JSON in DB** | Storing **`rawData` jsonb** on `Product` (or import rows) lets you re-normalise after selector changes without re-scraping. Not implemented by default — needs a migration + write path from the scrape worker. |
