# Adapter Variant Reference

Each adapter documents: what variant axes it exposes, how `configurationPrices` rows are structured, where prices come from, and what the frontend needs to handle.

---

## Apple

**Axes:** `Storage`, `Color`, `Carrier` (optional)

**Price model:** Storage × Color drives price; Carrier is routing-only (same price across carriers).

**Primary data source:** `script#metrics` (inline JSON with per-SKU `fullPrice`).  
**Fallback source:** DOM `a[data-slot-name="productSelection"]` elements (configRows with `dimensionCapacity`, `dimensionColor`, `carrier-logos`).

### Variant axes
| Axis | Selectable | Price-changing |
|------|-----------|----------------|
| Storage | Yes | Yes |
| Color | Yes | Yes |
| Carrier | Yes | No |

### `configurationPrices` rows (metrics path)
```json
{
  "label": "iPhone 17 256GB Black Titanium",
  "originalPrice": "799.00",
  "partNumber": "MNXX3LL/A",
  "sku": "MNXX3LL/A",
  "variantSelections": { "Storage": "256 GB", "Color": "Black Titanium" },
  "available": true,
  "metadata": { "source": "apple-metrics" }
}
```

### `configurationPrices` rows (configRow fallback)
```json
{
  "label": "256 GB · Black Titanium · AT&T",
  "originalPrice": "799.00",
  "variantSelections": { "Storage": "256 GB", "Color": "Black Titanium", "Carrier": "AT&T" }
}
```

### Carrier link map (metadata)
When a product has carrier options, `metadata.carrierLinkMap` is a dict:
```
"256 GB|Black Titanium|AT&T" → "/shop/buy-iphone/iphone-17/..."
```
Use this to resolve the Apple checkout URL after the user selects Storage + Color + Carrier.

### Frontend notes
- Storage options are sorted smallest → largest (GB then TB).
- Color options are sorted alphabetically.
- Carrier is separate from the pricing matrix — don't use it to filter `configurationPrices`.
- Display price range in description if `hi - lo > 50`.

---

## Nike

**Axes:** `Size` (always), `Width` (when wide/regular options exist), `Fit` (when multi-group: e.g. Men's / Women's / Kids), `Color` (read-only, single current value)

**Price model:** All sizes share the same price (no per-size pricing). Multi-group products have different prices per group.

**Data source:** `__NEXT_DATA__` → `props.pageProps.selectedProduct` (with deep fallback search).

### Variant axes
| Axis | Selectable | Price-changing | Notes |
|------|-----------|----------------|-------|
| Size | Yes | No | `ACTIVE` status = available |
| Width | Yes | No | Only present when `sizeFitSections` has ≥2 sections |
| Fit | Yes | Yes | Groups like "Men's", "Women's", "Kids" — each has its own `styleColor` and price |
| Color | Display only | N/A | Single value, shown but not switchable from this scrape |

### `configurationPrices` rows — flat sizes (most products)
```json
{
  "label": "10",
  "originalPrice": "110.00",
  "sku": "DC3728-101-10",
  "variantAxis": "Size",
  "optionValue": "10",
  "variantSelections": { "Size": "10" },
  "available": true,
  "currency": "USD",
  "metadata": { "source": "nike-size", "gtin": "194500000000" }
}
```

### `configurationPrices` rows — Width × Size (wide-width products)
```json
{
  "label": "Regular / 10",
  "originalPrice": "110.00",
  "sku": "...",
  "variantAxis": "Size",
  "optionValue": "10",
  "variantSelections": { "Width": "Regular", "Size": "10" },
  "available": true,
  "metadata": { "source": "nike-fit-section", "fitType": "WIDTH" }
}
```

### `configurationPrices` rows — multi-group (group-level)
```json
{
  "label": "Men's",
  "originalPrice": "110.00",
  "sku": "DC3728-101",
  "variantAxis": "Fit",
  "optionValue": "Men's",
  "variantSelections": { "Fit": "Men's" },
  "available": true,
  "metadata": {
    "source": "nike-group",
    "styleColor": "DC3728-101",
    "pdpUrl": "https://www.nike.com/t/DC3728-101",
    "isSelectedGroup": true
  }
}
```

### Frontend notes
- When `Fit` axis is present, navigating groups requires loading a different PDP URL (`pdpUrl` in metadata).
- `statusModifier` determines overall availability ("BUYABLE" → In Stock).
- Color switching is not supported from a single scrape — each colorway is a separate URL.

---

## Amazon

**Axes:** Dynamic — anything in the Twister dimension list (e.g. `Size`, `Color`, `Style`, `Pattern`, `Flavor`, `Pack Size`, etc.)

**Price model:** Only the current ASIN has a confirmed price. All other variants are marked `priceNeedsLookup: true` and require a separate scrape.

**Data source:** Inline `P.register('twister-js-init-dpx-data', ...)` script block containing `variationValues`, `variationDisplayLabels`, `dimensions`, and `dimensionToAsinMap`.

### `configurationPrices` rows
```json
{
  "label": "Large · Black",
  "originalPrice": "29.99",
  "sku": "B0XXXXXX",
  "variantSelections": { "Size": "Large", "Color": "Black" },
  "available": true,
  "metadata": {
    "asin": "B0XXXXXX",
    "source": "amazon-twister",
    "priceNeedsLookup": true
  }
}
```
The current variant row has no `priceNeedsLookup` flag; all others do.

### Frontend notes
- Display axes in `dimensions` order (preserves Amazon's intended UX order).
- Human-readable axis names come from `variationDisplayLabels`; fallback is `humaniseDimKey` (e.g. `size_name` → `Size`).
- When user selects a non-current variant, trigger a new scrape for that ASIN.
- `compareAtPrice` and `discount` are scraped from the buybox and only apply to the current ASIN.
- `dealType` (e.g. "Limited-time deal") and `savingsAmount` are also available.

---

## StockX

**Axes:** `Size` (US sizing; EU/UK available in metadata)

**Price model:** "Lowest ask" — live resale price fetched from StockX's market. Per-size prices require real-time lookup. When live price is unavailable, falls back to retail reference price.

**Data source:** `__NEXT_DATA__` → `GetProduct` query (`props.pageProps.req.appContext.states.query.value.queries`).

### `configurationPrices` rows
```json
{
  "label": "US 10 / EU 44",
  "originalPrice": "180.00",
  "sku": "036000291452",
  "variantAxis": "Size",
  "optionValue": "US 10",
  "available": true,
  "metadata": {
    "source": "stockx",
    "variantId": "uuid-...",
    "sizeUS": "10",
    "sizeEU": "44",
    "sizeUK": "9",
    "upc": "036000291452",
    "priceNeedsLookup": true,
    "priceSource": "retail-reference"
  }
}
```
When a live "Lowest Ask" price is captured, `priceNeedsLookup` is `false` and `priceSource` is `"lowest-ask"`.

### Frontend notes
- `priceNeedsLookup: true` means displayed price is retail reference only. Resolve real ask price before showing a buy option.
- `styleId`, `retailPrice`, and `priceSource` are in the top-level `metadata` field (not inside `configurationPrices`).
- `colorway` and `releaseDate` are embedded in the product description.
- EU and UK sizes are in `configurationPrices[n].metadata` — display them as secondary labels under the US size.

---

## eBay

**Axes:** None

**Variant model:** Single-listing marketplace. No variant axes are extracted.

```json
{
  "variants": []
}
```

**Price model:** JSON-LD offer price (matched by `iid` query param when it's a hub-page URL; falls back to `offers[0]`). DOM microdata is the least reliable fallback.

### Fields available but not variants
- `compareAtPrice` — list/was price from `priceSpecification` or strikethrough DOM element
- `discount` — savings percentage (e.g. "40% off")
- `savingsAmount` — computed `list - current`
- `conditionLabel` — "New", "Used", "Refurbished", "Open Box"
- `shippingCost` — from `shippingDetails[0].shippingRate.value`

### Frontend notes
- eBay is per-listing. "Variants" on eBay are separate listings — you cannot select them from a single scrape.
- Hub page URLs (`/p/...?iid=...`) are auto-resolved to `/itm/{iid}` before scraping.

---

## Zara

**Axes:** `Color` (when multiple), `Size`

**Price model:** One price applies across all sizes of a color. Sale price (`compareAtPrice`) is available when on sale.

**Data sources (priority order):**
1. `window.zara.appConfig` inline script (`"product":{"id":...}`) — v2 architecture
2. `script#__NEXT_DATA__` → `props.pageProps.productDetail` — v1 Next.js architecture
3. JSON-LD `Product` node — limited, no variant data
4. DOM/meta tags — price and title only, no variants

### Variant axes
| Axis | Selectable | Price-changing | Notes |
|------|-----------|----------------|-------|
| Color | Yes | No | Per-color size availability may differ |
| Size | Yes | No (v1) / Yes (v2 cents) | v2 has per-size SKU and price |

### `configurationPrices` rows — v1 (Next.js, multi-color)
```json
{
  "label": "Ecru",
  "originalPrice": "49.90",
  "variantAxis": "Color",
  "optionValue": "Ecru",
  "available": true,
  "metadata": { "source": "zara" }
}
```
No per-size configurationPrices in v1 — size availability is in `variants[].options` only.

### `configurationPrices` rows — v2 (appConfig, per-size)
```json
{
  "label": "XS",
  "originalPrice": "49.90",
  "sku": "12345678",
  "variantAxis": "Size",
  "optionValue": "XS",
  "available": true,
  "metadata": { "source": "zara-v2", "sizeId": 1 }
}
```

### Frontend notes
- Selected color is resolved via the `v1` query param (SKU prefix) in the URL, or the `selected: true` flag in the JSON.
- In v1, images are per-color — swap images when the user changes color.
- In v2, images come from `xmedia[].extraInfo.deliveryUrl` on the selected color's data.
- Sizes with `availability !== "out_of_stock"` are in-stock (v1). In v2, `availability === "in_stock"` is explicitly set per size.

---

## GOAT

**Axes:** `Size` only

**Price model:** Per-size "lowest ask" prices. Each size can have a different price. Primary source is `availableSizesNewV2` / `availableSizesNew`; supplemented by XHR to `/product_variants/buy_bar_data`.

**Data source:** `__NEXT_DATA__` → `props.pageProps.product` or `props.pageProps.productTemplate`. XHR intercept overlays live per-size prices.

### `configurationPrices` rows
```json
{
  "label": "Size 10",
  "originalPrice": "185.00",
  "variantAxis": "Size",
  "optionValue": "10",
  "currency": "USD",
  "available": true,
  "displayLabel": "10 — from USD 185.00",
  "metadata": {
    "source": "goat",
    "sizeValue": 10
  }
}
```

### Frontend notes
- `variants` only shows available sizes (from `availableMerged`). If none are available, shows all sizes.
- The top-level `price` is the cheapest in-stock size.
- Per-size prices differ — always show the individual prices from `configurationPrices`, not the top-level `price`.
- `colorway` and `sku` (style code) are in the description.
- `productCondition` (e.g. "new_no_defects") is also in the description.

---

## SHEIN

**Axes:** None

**Variant model:** No variant axes are extracted. SHEIN has color/size selectors on-page, but they are not scraped.

```json
{
  "variants": []
}
```

**Price model:** JSON-LD `AggregateOffer.lowPrice` (range price) → `__NEXT_DATA__` `salePrice.amount` → DOM price selectors.

### Frontend notes
- SHEIN blocks most scraping; the adapter gets a single price point representing the base/lowest config.
- Currency is inferred from URL subdomain (`.co.uk` → GBP, `.de/.fr` → EUR, etc.).
- If variants are needed, a future enhancement would need to intercept SHEIN's goods detail API.

---

## Converse

**Axes:** `Color`, `Size` — but via two different platform paths

**Price model:**
- **SFCC path** (converse.com): all variants same price; compare price available when on sale.
- **Magento path** (converse.co.za and other regional sites via Vaimo): per-child-product pricing (each Color × Size combination is a separate product with its own price).

**Data sources:**
- SFCC: `window.__STATE__` (Redux state) or `script#product-schema`
- Magento: `Magento_Swatches/js/swatch-renderer` inline script containing `jsonConfig`

### Variant axes
| Axis | Selectable | Price-changing | Notes |
|------|-----------|----------------|-------|
| Color | Yes | No (SFCC) / Yes (Magento) | SFCC: colorVariations; Magento: from attributes |
| Size | Yes | No (SFCC) / Yes (Magento) | SFCC: variationAttributes; Magento: from attributes |

### `configurationPrices` rows — SFCC (multi-color only)
```json
{
  "label": "Black",
  "originalPrice": "70.00",
  "variantAxis": "Color",
  "optionValue": "Black",
  "available": true,
  "metadata": { "source": "converse", "selection": { "Color": "Black" } }
}
```
No per-size configurationPrices in SFCC path.

### `configurationPrices` rows — Magento (full Color × Size matrix)
```json
{
  "label": "Black · M",
  "originalPrice": "70.00",
  "sku": "ABC123",
  "variantAxis": "Size",
  "optionValue": "M",
  "currency": "ZAR",
  "available": true,
  "displayLabel": "Black · M — ZAR 70.00",
  "metadata": {
    "source": "converse-magento",
    "magentoChildProductId": "12345",
    "axes": { "color": "Black", "size": "M" },
    "selection": { "Color": "Black", "Size": "M" },
    "color": "Black",
    "size": "M"
  }
}
```

### Frontend notes
- Detect platform via which path produced data — SFCC has `productName` in state; Magento has `jsonConfig` with `attributes` + `optionPrices`.
- Magento `index` maps `childProductId → { attrId: optionId }` — use this to cross-reference `configurationPrices[n].metadata.selection` against the active `variants` axes.
- `compareAtPrice` is the maximum `oldPrice` across all Magento child products.
- Magento `salable` dict and `child_attributes.stock_quantity` determine per-child availability.

---

## Jumia

**Axes:** None

**Variant model:** No variant axes are extracted. Currency is hardcoded to `NGN`.

```json
{
  "variants": [],
  "currency": "NGN"
}
```

**Price model:** DOM scrape only — `.prc` element or `[data-price]` attribute.

### Frontend notes
- Jumia has size/color selectors on-page but they are not scraped.
- `description` comes from `#product-details` DOM element.
- If variants are needed for Jumia in the future, their product API (`/catalog/product/...`) would be the target.

---

## Quick Reference Table

| Adapter | Size | Color | Storage | Width/Fit | Group | Carrier | Per-size Pricing |
|---------|------|-------|---------|-----------|-------|---------|-----------------|
| Apple | — | Yes | Yes | — | — | Yes (routing) | Yes (per SKU) |
| Nike | Yes | Display only | — | Yes (optional) | Yes (optional) | — | No |
| Amazon | Yes (dynamic) | Yes (dynamic) | — | — | — | — | No (needs lookup) |
| StockX | Yes (US+EU+UK) | — | — | — | — | — | Needs lookup |
| eBay | — | — | — | — | — | — | N/A (single listing) |
| Zara | Yes | Yes (optional) | — | — | — | — | v2 only |
| GOAT | Yes | — | — | — | — | — | Yes (per size) |
| SHEIN | — | — | — | — | — | — | N/A |
| Converse | Yes | Yes | — | — | — | — | Magento path only |
| Jumia | — | — | — | — | — | — | N/A |

---

## `configurationPrices` shape reference

All rows share these base fields:

```ts
{
  label: string;                          // human-readable row label
  originalPrice: string;                  // decimal string e.g. "79.99"
  sku?: string;                           // ASIN / UPC / SKU / partNumber
  variantAxis?: string;                   // which axis this row belongs to: "Size" | "Color" | "Storage" | "Fit"
  optionValue?: string;                   // the option value within that axis
  variantSelections?: Record<string, string>;  // full selection map: { Size: "10", Color: "Black" }
  available?: boolean;
  currency?: string;
  displayLabel?: string;                  // pre-formatted label with price (GOAT, Converse)
  metadata?: Record<string, unknown>;     // adapter-specific extras
}
```

**`variantSelections`** is the most reliable field for matching a row to a user's current selection state — use it when present (Apple, Nike, Amazon, Zara v1).  
**`optionValue` + `variantAxis`** is the fallback for single-axis adapters (StockX, GOAT, Zara v2, Converse SFCC).
