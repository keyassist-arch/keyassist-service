# Periodic product rescrape (cron)

Each **Product** persists the normalized scrape URL as **`sourceUrl`** (also exposed as **`scrapeUrl`** in API responses). Use that field with **`ScraperService.scrape(product.sourceUrl, product.source)`**, then apply the result with **`ProductsService.applyRescrapeFromData(product.id, scraped)`**.

## Selecting candidates

```ts
// e.g. every 6 hours, rescrape products not touched in 24h
const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
const batch = await productsService.findCandidatesForRescrape(cutoff, 100);
```

Only rows with **`rescrape_enabled = true`** are returned. Disable rescrapes for a product by setting **`rescrapeEnabled`** to `false` (e.g. admin-only field you add later, or a direct DB update).

## Differences vs. checkout price check

- **`refreshPriceFromScrape`** — lightweight: price, title tweak, availability, **`lastVerifiedAt`** only.
- **`applyRescrapeFromData`** — full catalog refresh: same as import upsert logic (images, variants, description, etc.) and updates **`lastScrapedAt`** / **`lastVerifiedAt`**.

## Index

Entity index **`idx_products_rescrape`** on `(rescrape_enabled, last_scraped_at)` supports efficient batch queries.
