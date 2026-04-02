# Product page UI guide (frontend)

How to render **storefront product detail** and **cards** from the public product API. Shapes match **`GET /products/:idOrSlug`** and each item in **`GET /products?limit=`** (identical object structure). Use **`slug`** in customer-facing URLs when present; **`id`** remains the stable UUID for cart and orders. For auth, cart, and import flows, see **`API_INTEGRATION.md`**.

---

## API shape (what you receive)

All monetary fields are **decimal strings** (e.g. `"999.00"`), not numbers — use them with a formatter or `parseFloat` when doing math client-side.

| Field | Type | Notes |
|-------|------|--------|
| `id` | string (UUID) | Stable product id for cart, orders, and API lookups. |
| `slug` | string | URL-safe segment derived from title; use for **readable storefront routes** (e.g. `/products/{slug}`). Same product as `GET /products/:idOrSlug` with either segment. |
| `title` | string | Primary heading; trim whitespace in CSS if needed. |
| `description` | string \| null | Multi-paragraph plain text; may include **retailer list-price** lines, **`Configurations:`**, and **price-range** copy — see [Adapter-driven description](#adapter-driven-description). Not guaranteed to be Markdown. |
| `brand` | string \| null | Optional subtitle or badge (e.g. “Apple”). |
| `source` | enum string | `jumia` \| `amazon` \| `nike` \| `apple` \| `shein` \| `generic` — useful for icons, “View on {retailer}”, or analytics. |
| `sourceUrl` | string | Canonical product URL on the retailer (normalized). |
| `scrapeUrl` | string | Same value as `sourceUrl`; kept for clarity that this is the scrape/rescrape target. |
| `originalPrice` | string | **Supplier / list price** from the last successful scrape (before your platform markup). |
| `salePrice` | string | **Price the customer pays** on your site: `originalPrice` × (1 + `markupPercent` / 100). |
| `markupPercent` | string | e.g. `"10.00"` — platform margin; usually **admin-facing**; you may hide on consumer PDP or show in “How we price” copy. |
| `currency` | string | ISO-like code (e.g. `USD`, `NGN`), uppercase, short. Use for `Intl.NumberFormat`. |
| `images` | string[] | Absolute image URLs; order = gallery order. May be empty on bad scrapes. |
| `variants` | `{ name: string; options: string[] }[]` | Dimension pickers (e.g. Storage, Color, Carrier). Names are **keys** for cart `variantSelection`. |
| `configurationPrices` | array \| omitted | **Apple (and future adapters):** per-configuration **supplier** and **platform** prices. Each item: `label`, `originalPrice`, `salePrice` (after `markupPercent`), optional `partNumber` / `sku`. Empty `[]` when not provided. Use for accurate **storage / finish** price tables on the PDP. |
| `availability` | string \| null | Human-readable hint when the scraper sets it (e.g. Amazon: **`In stock`** / **`Out of stock`**); may still be `null` on other sources. Treat unknown / null as “check retailer”. |
| `stockQuantity` | number \| null | **`null`** = unlimited / not tracked (dropship). **number** = enforce at checkout server-side. |
| `rescrapeEnabled` | boolean | Catalog metadata; rarely needed on PDP. |
| `lastScrapedAt` | string \| null | ISO 8601 when the product was last scraped. |
| `lastVerifiedAt` | string \| null | ISO 8601 when a follow-up verify scrape last ran. |

**Not included** in JSON: `createdAt` / `updatedAt` (omit from UI or add a future API field if needed).

### Example (truncated)

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "iPhone Air 256GB Light Gold",
  "description": "Apple’s checkout can change the total…\n\nConfigurations:\n256 GB · Light Gold · AT&T — $999.00\n256 GB · Light Gold · Connect to any carrier later — $999.00",
  "brand": "Apple",
  "source": "apple",
  "sourceUrl": "https://www.apple.com/shop/buy-iphone/iphone-air/...",
  "scrapeUrl": "https://www.apple.com/shop/buy-iphone/iphone-air/...",
  "originalPrice": "999.00",
  "salePrice": "1098.90",
  "markupPercent": "10.00",
  "currency": "USD",
  "images": ["https://store.storeimages.cdn-apple.com/..."],
  "variants": [
    { "name": "Storage", "options": ["256 GB", "512 GB", "1 TB"] },
    { "name": "Color", "options": ["Cloud White", "Light Gold", "Sky Blue", "Space Black"] },
    { "name": "Carrier", "options": ["AT&T", "Verizon", "..."] }
  ],
  "configurationPrices": [
    {
      "label": "iPhone Air 256GB Light Gold",
      "originalPrice": "999.00",
      "salePrice": "1098.90",
      "partNumber": "MG1A4LL/A",
      "sku": "MG1A4"
    }
  ],
  "availability": null,
  "stockQuantity": null,
  "rescrapeEnabled": true,
  "lastScrapedAt": "2026-03-28T12:00:00.000Z",
  "lastVerifiedAt": "2026-03-28T12:01:30.000Z"
}
```

---

## Pricing (hero and cart)

1. **Primary price** — Show **`salePrice`** prominently as “Our price” / “Buy now” (this is what checkout uses, subject to re-scrape at order time).
2. **Compare / transparency** — Optionally show **`originalPrice`** struck through with a short label such as “Retailer list” or “Estimated list” so users see your markup policy. If you prefer not to expose supplier price, show only **`salePrice`** and skip the strikethrough.
3. **Same currency** — `originalPrice`, `salePrice`, and display formatting should all use **`currency`**.
4. **Formatting** — Use `Intl.NumberFormat(locale, { style: 'currency', currency: product.currency })` with a **BCP 47** locale that matches your storefront (e.g. `en-NG` for Nigeria). If `currency` is missing or invalid for `Intl`, fall back to fixed decimals + currency code suffix.
5. **Equality** — If `originalPrice === salePrice` (e.g. 0% markup), avoid a fake “discount”; show a single price.
6. **markupPercent** — Optional footnote for trust (“Typical margin X%”); not required for purchase.

---

## Images

- Use **`images[0]`** as the primary / card thumbnail.
- Build a gallery from the full array; handle **`images.length === 0`** with a neutral placeholder.
- URLs are remote (retailer/CDN); use `loading="lazy"` for below-the-fold thumbs, and set width/height or aspect-ratio to reduce layout shift.
- Do not assume square assets; use `object-fit: contain` or a consistent crop per design system.

---

## Variants and add-to-cart

- Each element of **`variants`** is one dimension: **`name`** (e.g. `Storage`, `Color`) and **`options`** (exclusive choices).
- Render as radio groups, segmented controls, or dropdowns — one selected value per `name`.
- **`POST /cart/items`** expects **`variantSelection`** shaped as `{ [variantName]: selectedOption }`, e.g. `{ "Storage": "256 GB", "Color": "Light Gold" }`. Keys must match **`variants[].name`** strings from the product payload.
- If **`variants` is empty**, omit `variantSelection` or send `{}`.
- Pre-select sensible defaults (e.g. first option per dimension) but let the user change before add-to-cart.

---

## Description and “Configurations”

- **`description`** is **plain text**, often with paragraphs separated by `\n\n`.
- **Amazon:** may include feature bullets plus a **retailer list price** line (see [Adapter-driven description](#adapter-driven-description)).
- **Apple:** JSON-LD intro (truncated), optional **“Available from … to …”** range, then a block starting with **`Configurations:`** — one line per matrix row (storage · color · carrier · price snippets). Options:
  - **Simple:** split on `\n\n`, render each chunk as a `<p>`; inside chunks, replace `\n` with `<br />` or keep as preformatted for the config block only.
  - **Structured:** detect **`Configurations:`** (and optionally the list-price / range lines) and render subsections as lists or tables.
- Older Apple copy about trade-in / financing may still appear in JSON-LD excerpts — keep visible in small print or accordion if present.

---

## Availability and stock

- **`stockQuantity === null`** — Do not show “Out of stock” based on stock; server treats as unlimited until you add inventory features.
- **`stockQuantity` is a number** — You may show “Only X left” if product policy allows; checkout still re-validates.
- **`availability`** — For **Amazon**, you may show **`In stock` / `Out of stock`** when present. For other sources it may be `null` or free text — still treat as informational; final fulfilment is with the retailer.

---

## Source and external link

- Show a secondary CTA: **“View on {retailer}”** using **`sourceUrl`** (open in new tab with `rel="noopener noreferrer"`).
- Map **`source`** to a friendly label: Jumia, Amazon, Nike, Apple, Shein, or “Partner” for `generic`.

---

## Adapter-driven description

The API does **not** expose separate fields for “compare-at” or “list” price on the product JSON. When a scraper supplies that context, the backend merges it into **`description`** (and still uses the **current** retailer selling price for **`originalPrice`** / markup math).

| Pattern in `description` | Typical source | UI hint |
|----------------------------|----------------|---------|
| Paragraph starting with **`Retailer list price before discount:`** | **Amazon** when the PDP shows a strike-through list price vs pay price | Optional “Was” / list line for transparency; your **checkout price** remains **`salePrice`**. |
| Block starting with **`Configurations:`** | **Apple** (and similar matrix PDPs) | One line per configuration (storage · color · carrier · price snippet). |
| Sentence **`Available from {currency} X to {currency} Y depending on configuration.`** | **Apple** when multiple SKUs differ by more than ~**$50** | Optional range badge or footnote; not a second price field. |

**Shein** and other adapters generally keep copy shorter; rely on **`title`**, **`variants`**, and **`images`** first.

---

## Adapter updates (variants, images, stock)

Behavior differs by **`source`**; the JSON shape is unchanged.

### Amazon (`source: "amazon"`)

- **`variants`** — Built from buy-box **twister** data when present: dimensions such as **Color**, **Size**, **Style** appear as **`name`** with **`options`** lists (grouped from Amazon’s variant JSON). If parsing fails, **`variants`** may be empty even though the retailer page has swatches.
- **`availability`** — Often **`In stock`** or **`Out of stock`** when the adapter can read the add-to-cart / availability region; do not treat as a guarantee of purchase.
- **`description`** — Product bullets from the PDP when found; plus the **retailer list price** sentence when the page shows a real markdown (see table above).
- **`images`** — Prefers hi-res URLs from in-page **`colorImages`**, with gallery fallbacks.

### Apple (`source: "apple"`)

- **`price` / `originalPrice`** — Resolved in priority order server-side: query **`part` / `sku`** → **metrics** (`script#metrics`) SKU match on URL slug → matrix row matching current path → cheapest matrix or metrics price → JSON-LD low. You only see the **chosen** selling price on the product; the **range** line in **`description`** is optional context.
- **`configurationPrices`** — **Structured** list of **every** hardware SKU from **`script#metrics`** (label = Apple product name, **supplier** `originalPrice`, platform **`salePrice`** from markup). If metrics are missing, **matrix** rows with a parseable `.current_price` are used instead (may include carrier dimensions). Prefer this array over parsing **`description`** for price tables.
- **`variants`** — Prefer **Storage** / **Color** derived from **metrics SKU names** when `script#metrics` is present; otherwise from the **productSelection** matrix (**Storage**, **Color**, **Carrier**).
- **`description`** — Short JSON-LD excerpt, optional **configuration price range** (spread \> $50), then **`Configurations:`** lines appended by the API from matrix rows.
- **`images`** — Prefers **best `srcset`** candidate from gallery `<picture>` / `<img>`, plus JSON-LD / OG fallbacks.

### Shein (`source: "shein"`)

- **`brand`** — Often **`SHEIN`** when the adapter sets it.
- **`variants`** — May be empty; PDPs vary. Rely on **`description`** and **`sourceUrl`** if variants are missing.

---

## List vs detail (cards)

- **Card:** `images[0]`, `title`, `salePrice` + `currency`, optional `brand`, link to `/products/:slug` (or `/products/:id`); prefer **`slug`** for readable URLs.
- **Truncation:** Clamp title to 2 lines; avoid showing full `description` on cards.
- **Same payload** as detail — no extra “summary” DTO.

---

## Freshness and legal copy

- Optionally show: “Last updated” from **`lastScrapedAt`** or **`lastVerifiedAt`** (relative time is fine).
- Fine print: prices can change on the retailer; your API may refresh on import and background verify — align with **`API_INTEGRATION.md`** if you promise live pricing.

---

## Empty and error states

- **404** on `GET /products/:idOrSlug` — Product removed or unknown id/slug; show not-found UI.
- **Missing images / title** — Should be rare; still guard with placeholders and avoid broken layout.

---

## Related

- **OpenAPI:** `{API_BASE}/docs` — schema should mirror this shape.
- **Cart / checkout:** `variantSelection` must stay consistent with **`variants[].name`** and selected **`options`** values.
