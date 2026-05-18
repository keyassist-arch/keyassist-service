# Adapter → Frontend Contract

Compiled from the GOAT, Amazon, Apple, Zara, StockX, eBay, and Nike adapter changes.  
This document describes every new API field and the UI behaviour each one requires.

---

## 1. New top-level product fields

These fields are now returned by the `/products/:id` (and import) API alongside the existing `price`, `currency`, `variants`, etc.

| Field | Type | Source | Meaning |
|---|---|---|---|
| `compareAtPrice` | `string \| null` | Amazon, Zara, eBay, Nike | Crossed-out "was" / list price. `price` is always the current selling price. |
| `discount` | `string \| null` | Amazon, eBay, Nike | Raw savings badge text scraped from the PDP, e.g. `"-40%"` or `"60% off"`. |
| `savingsAmount` | `string \| null` | Amazon, eBay | Absolute saving as a decimal string, e.g. `"1020.00"`. Computed from `compareAtPrice − price`. |
| `dealType` | `string \| null` | Amazon | Promotional label, e.g. `"Limited-time deal"` or `"Lightning Deal"`. |
| `metadata` | `Record<string, unknown> \| null` | Apple, StockX, Nike | Adapter-specific extra data. Carries `carrierLinkMap` for Apple (see §4), `styleId`/`priceSource` for StockX (see §6), and nothing at the product level for Nike (group routing is in `configurationPrices[].metadata`). |

> All discount fields are optional — treat `null`/`undefined` as "no promotion". When `savingsAmount` is present, prefer it over computing the difference client-side to avoid floating-point drift.

---

## 2. `configurationPrices` — shape and usage

`configurationPrices` is a `ProductConfigurationPrice[]` stored as JSONB. It drives per-option price display across all adapters. The relevant fields:

```ts
type ProductConfigurationPrice = {
  label: string;              // human-readable row label
  originalPrice: string;      // supplier price (decimal string, e.g. "425.00")
  sku?: string;               // adapter-specific SKU / ASIN / part number
  partNumber?: string;        // Apple part number
  variantAxis?: string;       // single-axis label, e.g. "Size" (GOAT)
  optionValue?: string;       // matches variants[].options entry (GOAT)
  variantSelections?: Record<string, string>; // multi-axis, e.g. { Storage: "256 GB", Color: "Sky Blue" }
  currency?: string;          // per-row currency override (usually absent)
  available?: boolean;        // false = show as disabled / greyed-out
  displayLabel?: string;      // ready-made display copy (GOAT only)
  metadata?: Record<string, unknown>;
};
```

**Lookup rules by adapter:**

| Adapter | How to find the active price row |
|---|---|
| GOAT | Match `optionValue === selectedSize` (single-axis via `variantAxis: "Size"`) |
| Apple | Match `variantSelections` against selected Storage + Color |
| Amazon | All variants share `currentPrice`; non-current ASIN rows have `metadata.priceNeedsLookup: true` |
| StockX | Match `optionValue === selectedSize` (e.g. `"US 10"`); all rows share one price — check `metadata.priceNeedsLookup` before showing a buy button |
| Zara | Match `optionValue === selectedSize` (single-axis via `variantAxis: "Size"`); `available: false` means OOS |
| Nike | For **multi-group** products (kids fit / men's+women's): rows with `variantAxis: "Fit"` give group-level prices; rows with `variantAxis: "Size"` are sizes within the selected group. For **width** products: match `variantSelections: { Width: selectedWidth, Size: selectedSize }`. For **single-group** products: match `optionValue === selectedSize` (same as GOAT). |

> The API applies `markupPercent` to produce a `salePrice` per product. The `configurationPrices` rows carry the **supplier** `originalPrice` — the frontend is responsible for displaying the markup-adjusted price when needed. If the API exposes `salePrice` per row, use that; otherwise apply the markup yourself.

---

## 3. GOAT — per-size price selector

### What the adapter now returns

```jsonc
{
  "price": "135.00",          // lowest ask across all sizes
  "currency": "USD",
  "variants": [
    { "name": "Size", "options": ["9", "9.5", "10", "10.5", ...] }
  ],
  "configurationPrices": [
    {
      "label": "Size 9",
      "originalPrice": "135.00",
      "variantAxis": "Size",
      "optionValue": "9",
      "currency": "USD",
      "available": true,
      "displayLabel": "9 — from USD 135.00",
      "metadata": { "source": "goat", "sizeValue": 90 }
    },
    {
      "label": "Size 9.5",
      "originalPrice": "145.00",
      "optionValue": "9.5",
      "available": true,
      ...
    },
    // sizes with no ask are omitted entirely
  ]
}
```

**Before this change:** `configurationPrices` was empty — all sizes showed the same template price.  
**After:** each available size has its own lowest-ask price.

### Required UI behaviour

1. **Size buttons** — render from `variants[0].options` (the full size list).
2. **Price per button** — look up `configurationPrices.find(r => r.optionValue === size)`.
   - If a row exists: show `displayLabel` or build `"Size {optionValue} — from {currency} {originalPrice}"`.
   - If no row: the size has no active ask — show the button as disabled/sold-out.
3. **Disabled state** — a `configurationPrices` row with `available: false` should render greyed-out and non-selectable.
4. **Header price** — update to match the selected size's `originalPrice` on selection. Default to `product.price` (the minimum ask) before any selection.

```
[ 9 $135 ] [ 9.5 $145 ] [ 10 $160 ] [ 10.5 — ] [ 11 $175 ] ...
                                        ↑ no ask — disabled
```

---

## 4. Apple — 3-step variant selection (Storage → Color → Carrier)

### What the adapter now returns

```jsonc
{
  "price": "999.00",          // cheapest unlocked SKU
  "currency": "USD",
  "variants": [
    { "name": "Storage", "options": ["256 GB", "512 GB", "1 TB"] },
    { "name": "Color",   "options": ["Cloud White", "Light Gold", "Sky Blue", "Space Black"] },
    { "name": "Carrier", "options": ["AT&T", "Boost", "T-Mobile", "Verizon", "Connect to any carrier later"] }
  ],
  "configurationPrices": [
    // 12 rows — one per Storage × Color combination (carrier-independent)
    {
      "label": "iPhone Air 256GB Sky Blue",
      "originalPrice": "999.00",
      "partNumber": "MQDT3LL/A",
      "sku": "MQDT3LL/A",
      "variantSelections": { "Storage": "256 GB", "Color": "Sky Blue" },
      "available": true,
      "metadata": { "source": "apple-metrics" }
    },
    { "variantSelections": { "Storage": "256 GB", "Color": "Space Black" }, "originalPrice": "999.00", ... },
    { "variantSelections": { "Storage": "512 GB", "Color": "Sky Blue" },   "originalPrice": "1199.00", ... },
    // ... 9 more rows
  ],
  "metadata": {
    "carrierLinkMap": {
      "256 GB|Sky Blue|AT&T":              "/shop/buy-iphone/iphone-16e/att/...",
      "256 GB|Sky Blue|Verizon":           "/shop/buy-iphone/iphone-16e/verizon/...",
      "256 GB|Sky Blue|Connect to any carrier later": "/shop/buy-iphone/iphone-16e/...",
      // ... one entry per Storage × Color × Carrier triple
    }
  }
}
```

**Before this change:** Carrier was mixed into `configurationPrices` rows, giving misleading per-carrier prices (only unlocked rows had prices, carrier rows were dropped silently).  
**After:** Carrier is a separate routing axis — it never changes the price, only the checkout URL.

### Required UI behaviour

The selection flow is strictly ordered:

```
Step 1  Storage   →  256 GB / 512 GB / 1 TB
Step 2  Color     →  Sky Blue / Light Gold / Cloud White / Space Black
                     ↑ price is now determined from configurationPrices
Step 3  Carrier   →  AT&T / Boost / T-Mobile / Verizon / Unlocked
                     ↑ price does NOT change — only the checkout URL changes
```

**Price lookup (steps 1–2):**

```ts
const activePrice = product.configurationPrices.find(
  (r) =>
    r.variantSelections?.['Storage'] === selectedStorage &&
    r.variantSelections?.['Color'] === selectedColor,
);
// display activePrice.originalPrice
```

**Carrier routing (step 3):**

```ts
const carrierLinkMap = product.metadata?.carrierLinkMap as Record<string, string> | undefined;
const appleUrl = carrierLinkMap?.[`${selectedStorage}|${selectedColor}|${selectedCarrier}`];
// use appleUrl as the "Buy on Apple" deep-link, or pass to checkout
```

If `appleUrl` is absent for a combination (e.g. a carrier doesn't carry that colour), disable that carrier option or show a "not available" state.

---

## 5. Amazon — sale / deal display

### What the adapter now returns

```jsonc
{
  "price": "23.99",
  "currency": "USD",
  "compareAtPrice": "39.99",          // crossed-out list price
  "discount": "-40%",                 // badge text from the PDP
  "dealType": "Limited-time deal",    // promotional banner label
  // ... rest of product fields
}
```

All three fields are optional and `null` when the product has no active promotion.

### Required UI behaviour

```
┌─────────────────────────────────────────────┐
│  Limited-time deal                 ← dealType banner (yellow/orange)
│
│  $23.99                            ← price (current)
│  ~~$39.99~~   -40%                 ← compareAtPrice (strikethrough) + discount badge
└─────────────────────────────────────────────┘
```

- **`dealType`** — render as a coloured badge/banner above the price block (only when present).
- **`compareAtPrice`** — render as strikethrough text next to the current price (only when present and greater than `price`).
- **`discount`** — render as a badge alongside `compareAtPrice` (e.g. a red pill). The value is raw text from the page; display it as-is.
- If all three are absent, render the normal price block with no promotional styling.

---

## 6. StockX — size selector with live-price gate

### What the adapter now returns

```jsonc
{
  "price": "220.00",        // retail reference price (live ask not in SSR HTML)
  "currency": "USD",
  "variants": [
    { "name": "Size", "options": ["US 7", "US 7.5", "US 8", ..., "US 18"] }
  ],
  "configurationPrices": [
    {
      "label": "US 9 / EU 42.5",
      "originalPrice": "220.00",   // same for all rows — retail reference only
      "sku": "012345678901",        // UPC when available, falls back to variant ID
      "variantAxis": "Size",
      "optionValue": "US 9",
      "available": true,
      "metadata": {
        "source": "stockx",
        "variantId": "abc123",
        "sizeUS": "9",
        "sizeEU": "EU 42.5",
        "sizeUK": "UK 8.5",
        "upc": "012345678901",
        "priceNeedsLookup": true,   // always true unless live ask was captured
        "priceSource": "retail-reference"
      }
    },
    // ... one row per size
  ],
  "metadata": {
    "styleId": "CT8532-006",
    "retailPrice": "220.00",
    "priceSource": "retail-reference"   // or "lowest-ask" when scrape.do captures it
  },
  "description": "... Retail Price: $220\nNote: Displayed price is retail/reference only. Live resale price requires real-time lookup."
}
```

**`priceSource` values:**

| Value | Meaning |
|---|---|
| `"lowest-ask"` | Live aggregate lowest ask was captured (scrape.do path with JS execution). Per-size prices still need lookup. |
| `"retail-reference"` | Only the SSR retail price was available. The resale price may be significantly higher. |

### Required UI behaviour

1. **Size buttons** — render from `variants[0].options`. Show EU size alongside US from `metadata.sizeEU` in the matching `configurationPrices` row (e.g. `"US 9 / EU 42.5"`).
2. **Price display** — when `product.metadata.priceSource === "retail-reference"`, show the price with a clear label:
   ```
   From $220  (retail reference — tap to see live price)
   ```
   Do **not** display it as if it were the resale price. StockX resale prices can be 30–200%+ above retail.
3. **Live-price gate** — when a user selects a size and `configurationPrices[n].metadata.priceNeedsLookup === true`, trigger a live price fetch before showing the buy/checkout button. Display a loading state while fetching.
4. **`priceSource === "lowest-ask"`** — the displayed price is the aggregate lowest ask across all sizes but still not per-size. Show it as "From $X" and still gate on a per-size live lookup at checkout.

```
[ US 7   ] [ US 7.5 ] [ US 8  ] [ US 9  ] [ US 10 ] ...
  EU 40      EU 40.5   EU 41    EU 42.5   EU 44

  Selected: US 9 / EU 42.5
  ┌──────────────────────────────────────┐
  │  Retail ref: $220                    │
  │  [Get live price]  ← triggers lookup │
  └──────────────────────────────────────┘
```

---

## 7. Zara — per-size selector with sale price

### What the adapter now returns

**v2 appConfig pages (most current Zara pages):**

```jsonc
{
  "price": "49.95",
  "currency": "EUR",
  "compareAtPrice": "79.95",    // present on sale items; null otherwise
  "variants": [
    { "name": "Color", "options": ["Ecru", "Black"] },   // only when >1 color
    { "name": "Size",  "options": ["S-M", "L-XL"] }
  ],
  "configurationPrices": [
    {
      "label": "S-M",
      "originalPrice": "49.95",
      "sku": "530724400",
      "variantAxis": "Size",
      "optionValue": "S-M",
      "available": true,
      "metadata": { "source": "zara-v2", "sizeId": 1 }
    },
    {
      "label": "L-XL",
      "originalPrice": "49.95",
      "sku": "530724401",
      "optionValue": "L-XL",
      "available": false,       // out_of_stock
      "metadata": { "source": "zara-v2", "sizeId": 2 }
    }
  ]
}
```

**Before this change:** the v2 architecture (no `__NEXT_DATA__`) fell through to the DOM/meta fallback, losing all size and sale-price data.  
**After:** sizes, per-size stock status, and sale prices are all captured from `window.zara.appConfig`.

### Required UI behaviour

1. **Size buttons** — render from `variants` where `name === "Size"`. Use `configurationPrices` for the `available` flag — `false` means OOS, render greyed-out.
2. **Sale pricing** — when `compareAtPrice` is present, display strikethrough + current price (same pattern as Amazon §5):
   ```
   ~~€79.95~~  €49.95
   ```
3. **Color selector** — when `variants` includes a `Color` axis (multiple colors), show a color swatch row. Switching color requires a new page load (Zara color URLs are separate PDPs); redirect to the color's product URL rather than trying to swap images client-side.
4. **Stock label** — if all `configurationPrices` rows have `available: false`, show an "Out of stock" banner.

```
Color:  [Ecru ✓]  [Black]

Size:   [S-M  €49.95]   [L-XL — OOS]

        ~~€79.95~~  €49.95   ← sale layout
```

---

## 8. eBay — discount, condition, and shipping display

### What the adapter now returns

```jsonc
{
  "price": "679.99",
  "currency": "USD",
  "compareAtPrice": "1699.99",    // offer.priceSpecification "List Price"
  "discount": "60% off",          // (.x-price-transparency--discount) DOM
  "savingsAmount": "1020.00",     // computed: listPrice − salePrice
  "brand": "Lenovo",
  "variants": [],                 // eBay listings are single fixed-price items
  "description": "...\n\nCondition: Refurbished\n\nShipping: USD 322.87"
}
```

**Before these changes:**
- `compareAtPrice` and `discount` were never extracted — list price lived in `offer.priceSpecification` (skipped) and the discount % in a DOM span (not read).
- `itemCondition` surfaced as the raw schema.org URL (`"https://schema.org/RefurbishedCondition"`).
- Shipping cost was silently dropped.

**After:** list price, savings %, savings amount, normalised condition, and shipping cost are all captured and surfaced.

### Price data sources (priority order)

| Field | Primary source | DOM fallback |
|---|---|---|
| `price` | `offer.price` (JSON-LD, iid-matched or first) | `[itemprop="price"]` content attr |
| `compareAtPrice` | `offer.priceSpecification.price` where `name` contains "List"/"Was" | `.ux-textspans--STRIKETHROUGH` text |
| `discount` | — | `.x-price-transparency--discount` text |
| `savingsAmount` | Computed from the two prices above | — |

### Condition label normalisation

`offer.itemCondition` is a schema.org URL. The adapter normalises it before returning:

| Raw value | Displayed as |
|---|---|
| `https://schema.org/NewCondition` | `New` |
| `https://schema.org/UsedCondition` | `Used` |
| `https://schema.org/RefurbishedCondition` | `Refurbished` |
| `https://schema.org/OpenBoxCondition` | `Open Box` |
| `https://schema.org/DamagedCondition` | `Damaged` |

The normalised label appears in `description` and can be used to render a condition badge.

### Required UI behaviour

```
┌──────────────────────────────────────────────────┐
│  [Refurbished]                  ← condition badge │
│                                                   │
│  $679.99                        ← price           │
│  ~~$1,699.99~~   60% off        ← compareAtPrice  │
│  You save: $1,020.00            ← savingsAmount   │
│                                                   │
│  Shipping: $322.87              ← from description│
└──────────────────────────────────────────────────┘
```

- **Condition badge** — parse from `description` (look for `"Condition: ..."` line) or expose as a separate field once the product entity supports it.
- **`compareAtPrice`** — render strikethrough only when present and numerically greater than `price`.
- **`discount`** — raw text badge, display as-is alongside the strikethrough price.
- **`savingsAmount`** — "You save: {currency} {savingsAmount}" line. Use this value directly rather than computing `compareAtPrice − price` client-side.
- **Shipping** — visible in `description`. No dedicated field yet; parse the `"Shipping: ..."` line if you need to display it separately in the UI.
- **No variants** — eBay single-listing items have `variants: []`. Do not render a variant selector.

---

## 9. Nike — multi-group fit selector and width/size cross-product

### What the adapter now returns

Nike PDPs fall into three structural types:

**Type A — multi-group (kids fit or men's+women's split):**

```jsonc
{
  "price": "90.00",           // price of the selected group (Baby/Toddler)
  "currency": "USD",
  "variants": [
    { "name": "Fit",  "options": ["Baby/Toddler", "Little Kids", "Big Kids"] },
    { "name": "Size", "options": ["2C", "3C", "4C", "5C", "6C", "7C", "8C", "9C", "10C"] },
    { "name": "Color", "options": ["Black/Cement Grey/Fire Red/Muslin"] }
  ],
  "configurationPrices": [
    // Group-level rows (Fit axis):
    {
      "label": "Baby/Toddler",
      "originalPrice": "90.00",
      "sku": "II1270-001",          // styleColor of this group's product
      "variantAxis": "Fit",
      "optionValue": "Baby/Toddler",
      "variantSelections": { "Fit": "Baby/Toddler" },
      "available": true,
      "metadata": {
        "source": "nike-group",
        "styleColor": "II1270-001",
        "pdpUrl": "https://www.nike.com/t/II1270-001",
        "isSelectedGroup": true
      }
    },
    { "label": "Little Kids", "originalPrice": "105.00", "sku": "II1269-001", "variantSelections": { "Fit": "Little Kids" }, "metadata": { "isSelectedGroup": false, ... } },
    { "label": "Big Kids",    "originalPrice": "165.00", "sku": "II1271-001", "variantSelections": { "Fit": "Big Kids"    }, "metadata": { "isSelectedGroup": false, ... } },
    // Per-size rows within the selected group (Size axis):
    { "label": "2C", "originalPrice": "90.00", "sku": "<merchSkuId>", "variantAxis": "Size", "optionValue": "2C", "variantSelections": { "Size": "2C" }, "available": true, "metadata": { "source": "nike-size", "gtin": "..." } },
    { "label": "3C", "originalPrice": "90.00", ... },
    // ...
  ]
}
```

**Type B — width/fit sections (adult shoes with Regular/Wide options):**

```jsonc
{
  "price": "120.00",
  "variants": [
    { "name": "Width", "options": ["Regular", "Wide"] },
    { "name": "Size",  "options": ["M 7", "M 7.5", "M 8", ...] },
    { "name": "Color", "options": ["Black/White"] }
  ],
  "configurationPrices": [
    {
      "label": "Regular / M 7",
      "originalPrice": "120.00",
      "sku": "<merchSkuId>",
      "variantAxis": "Size",
      "optionValue": "M 7",
      "variantSelections": { "Width": "Regular", "Size": "M 7" },
      "available": true,
      "metadata": { "source": "nike-fit-section", "gtin": "...", "fitType": "WIDTH" }
    },
    { "label": "Wide / M 7", "originalPrice": "120.00", "variantSelections": { "Width": "Wide", "Size": "M 7" }, ... },
    // ...
  ]
}
```

**Type C — single-group standard (most adult apparel / accessories):**

```jsonc
{
  "price": "110.00",
  "variants": [
    { "name": "Size",  "options": ["XS", "S", "M", "L", "XL"] },
    { "name": "Color", "options": ["Black"] }
  ],
  "configurationPrices": [
    { "label": "S", "originalPrice": "110.00", "sku": "<merchSkuId>", "variantAxis": "Size", "optionValue": "S", "available": true, "metadata": { "source": "nike-size" } },
    // ...
  ]
}
```

**Sale items** (any type) add:

```jsonc
{
  "compareAtPrice": "150.00",    // prices.initialPrice when > currentPrice
  "discount": "27% off"          // prices.discountPercentage formatted
}
```

**Before this change:**
- `productGroups` was never read — Baby/Toddler, Little Kids, and Big Kids were treated as separate unrelated products.
- `sizeFitSections` was ignored — width options on adult products silently dropped.
- `s.skuId` was used instead of `s.merchSkuId` — every size row had `sku: undefined`.
- `waitForFunction` only checked the legacy `initialState` path, causing a 20s timeout on all current Nike pages before falling through to the deep-search fallback.
- Discount fields (`initialPrice`, `discountPercentage`) were never read.

### Required UI behaviour

**Type A — multi-group:**

```
Step 1  Fit group:
  [Baby/Toddler $90] [Little Kids $105] [Big Kids $165]
        ↑ selecting a non-current group navigates to its pdpUrl

Step 2  Size (within selected group):
  [2C] [3C] [4C] [5C] [6C] [7C] [8C] [9C] [10C]
   ↑ all share the group price from the Fit row
```

- Render the `Fit` axis as a segmented control or tab row where each option shows its price.
- Selecting a group where `isSelectedGroup: false` is a **navigation event** — use `metadata.pdpUrl` to redirect. Do not try to swap data client-side; the sizes and price belong to a different product.
- After navigation the new page's selected group will have `isSelectedGroup: true`.

**Type B — width/size:**

```
Width:  [Regular]  [Wide]

Size:   [M 7] [M 7.5] [M 8] [M 8.5] [M 9] ...

Price lookup:
  configurationPrices.find(r =>
    r.variantSelections?.Width === selectedWidth &&
    r.variantSelections?.Size  === selectedSize
  )
```

**Type C — single-group (no `Fit` or `Width` variant):**

Same as GOAT: match `optionValue === selectedSize`.

**Sale display (all types):**

```
~~$150.00~~   $110.00   27% off
```

Same rendering rules as Amazon §5 and eBay §8.

**How to detect the type:**

```ts
const hasFitAxis   = product.variants.some(v => v.name === 'Fit');
const hasWidthAxis = product.variants.some(v => v.name === 'Width');
// Type A = hasFitAxis, Type B = hasWidthAxis, Type C = neither
```

---

## 10. `available` flag on `configurationPrices` rows

All adapters that emit `configurationPrices` rows now set `available: boolean`:

| Value | UI treatment |
|---|---|
| `true` | Selectable option |
| `false` | Greyed-out, non-selectable, optionally show "Sold out" tooltip |
| `undefined` | Treat as `true` (legacy rows from adapters that predate this field) |

---

## 11. Field availability by source

| Field | GOAT | Amazon | Apple | Zara | StockX | eBay | Nike |
|---|---|---|---|---|---|---|---|
| `variants` | Size | (from twister) | Storage, Color, Carrier | Color, Size | Size | — (single item) | Fit¹, Width², Size, Color |
| `configurationPrices` | per-size ask | per-ASIN (price lookup needed) | per-Storage×Color SKU | per-size (OOS flag) | per-size (price lookup needed) | — | per-Fit-group + per-size within group |
| `compareAtPrice` | — | list price | — | was-price on sale | — | list price | `initialPrice` when > `currentPrice` |
| `discount` | — | savings % | — | — | — | "60% off" text | `discountPercentage`% off |
| `savingsAmount` | — | computed | — | — | — | computed | — |
| `dealType` | — | deal badge | — | — | — | — | — |
| `metadata.carrierLinkMap` | — | — | Storage×Color×Carrier → URL | — | — | — | — |
| `metadata.priceSource` | — | — | — | — | `"lowest-ask"` \| `"retail-reference"` | — | — |
| `metadata.styleId` | — | — | — | — | style ID string | — | — |
| `configurationPrices[].available` | yes | yes | yes | yes | yes (always `true`) | — | yes |
| `configurationPrices[].displayLabel` | yes | — | — | — | — | — | — |
| `configurationPrices[].variantAxis` + `optionValue` | yes (Size) | — | — | yes (Size) | yes (Size) | — | yes (Fit or Size) |
| `configurationPrices[].variantSelections` | — | yes (multi-dim) | yes (Storage×Color) | — | — | — | yes (Fit or Width×Size) |
| `configurationPrices[].metadata.priceNeedsLookup` | — | yes (non-current ASIN) | — | — | yes (when no live ask) | — | — |
| `configurationPrices[].metadata.sizeEU` / `sizeUK` | — | — | — | — | yes | — | — |
| `configurationPrices[].metadata.pdpUrl` | — | — | — | — | — | — | yes (Fit rows only) |
| `configurationPrices[].metadata.isSelectedGroup` | — | — | — | — | — | — | yes (Fit rows only) |
| `configurationPrices[].metadata.gtin` | — | — | — | — | — | — | yes (Size rows) |

¹ `Fit` axis only present on multi-group products (kids sizing tiers, men's+women's split).  
² `Width` axis only present on adult products with `sizeFitSections` (Regular/Wide/X-Wide).
