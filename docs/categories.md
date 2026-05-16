# Categories — Frontend Integration Guide

All paths are relative to your API base URL (e.g. `http://localhost:3000` locally or your hosted API URL). Categories endpoints are **public** — no auth token is needed to read them.

---

## TypeScript types

```ts
export interface Category {
  id: string;           // UUID
  name: string;
  slug: string;         // URL-friendly, e.g. "fashion-apparel"
  description: string | null;
  imageUrl: string | null;
  position: number;     // display order, lower = first
  productCount: number;
  createdAt: string;    // ISO 8601
  updatedAt: string;
}

export interface PaginatedProducts {
  total: number;
  page: number;
  limit: number;
  results: Product[];   // your existing Product type
}
```

---

## Endpoints

### `GET /categories` — list all categories

Fetch this once on app load (or per-page if you need fresh counts). Returns all categories ordered by `position`, then `createdAt`.

```ts
async function getCategories(): Promise<Category[]> {
  const res = await fetch(`${API_BASE}/categories`);
  if (!res.ok) throw new Error('Failed to fetch categories');
  return res.json();
}
```

**Example response**

```json
[
  {
    "id": "a1b2c3d4-...",
    "name": "Sneakers",
    "slug": "sneakers",
    "description": "Lifestyle and performance footwear",
    "imageUrl": "https://cdn.example.com/sneakers.jpg",
    "position": 0,
    "productCount": 142,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-06-01T00:00:00.000Z"
  },
  {
    "id": "b2c3d4e5-...",
    "name": "Electronics",
    "slug": "electronics",
    "description": null,
    "imageUrl": null,
    "position": 1,
    "productCount": 58,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-06-01T00:00:00.000Z"
  }
]
```

---

### `GET /categories/:idOrSlug` — single category

Pass either the UUID or the slug. Use the slug in URLs so they're human-readable.

```ts
async function getCategory(idOrSlug: string): Promise<Category> {
  const res = await fetch(`${API_BASE}/categories/${idOrSlug}`);
  if (res.status === 404) throw new Error('Category not found');
  if (!res.ok) throw new Error('Failed to fetch category');
  return res.json();
}

// e.g.
getCategory('sneakers');
getCategory('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
```

---

### `GET /categories/:idOrSlug/products` — products in a category

The main endpoint for a category browse/listing page. Supports pagination and optional currency conversion.

**Query parameters**

| Parameter         | Default | Max | Description                                              |
|-------------------|---------|-----|----------------------------------------------------------|
| `page`            | `1`     | —   | Page number (1-based)                                    |
| `limit`           | `24`    | `100` | Items per page                                         |
| `displayCurrency` | —       | —   | ISO 4217 code (e.g. `USD`, `NGN`, `EUR`) to convert prices |

```ts
interface GetProductsOptions {
  page?: number;
  limit?: number;
  displayCurrency?: string;
}

async function getCategoryProducts(
  idOrSlug: string,
  options: GetProductsOptions = {},
): Promise<PaginatedProducts> {
  const params = new URLSearchParams();
  if (options.page) params.set('page', String(options.page));
  if (options.limit) params.set('limit', String(options.limit));
  if (options.displayCurrency) params.set('displayCurrency', options.displayCurrency);

  const res = await fetch(`${API_BASE}/categories/${idOrSlug}/products?${params}`);
  if (res.status === 404) throw new Error('Category not found');
  if (res.status === 400) {
    const body = await res.json();
    throw new Error(body.message); // e.g. invalid displayCurrency
  }
  if (!res.ok) throw new Error('Failed to fetch products');
  return res.json();
}

// e.g.
getCategoryProducts('sneakers', { page: 2, limit: 12, displayCurrency: 'USD' });
```

**Example response**

```json
{
  "total": 142,
  "page": 2,
  "limit": 12,
  "results": [
    {
      "id": "...",
      "name": "Air Max 90",
      "price": 120.00,
      "currency": "USD",
      ...
    }
  ]
}
```

Use `total` and `limit` to calculate total pages: `Math.ceil(total / limit)`.

---

## Common patterns

### Category navigation / sidebar

```ts
const categories = await getCategories();

// categories already arrive sorted by position — render as-is
categories.map(c => ({
  label: c.name,
  href: `/shop/${c.slug}`,
  count: c.productCount,
}));
```

### Category browse page (e.g. `/shop/[slug]`)

```ts
// Fetch category metadata and first page of products in parallel
const [category, products] = await Promise.all([
  getCategory(slug),
  getCategoryProducts(slug, { page: 1, limit: 24 }),
]);
```

### Pagination

```ts
const totalPages = Math.ceil(products.total / products.limit);
const hasNextPage = products.page < totalPages;
const hasPrevPage = products.page > 1;
```

### Currency conversion

Pass the user's selected currency via `displayCurrency`. All `price` values in `results` will be converted before they arrive — no client-side math needed.

```ts
getCategoryProducts('electronics', {
  page: 1,
  displayCurrency: userCurrency, // e.g. 'NGN'
});
```

---

## Error handling

| Status | When it happens                                           | What to do                    |
|--------|-----------------------------------------------------------|-------------------------------|
| 404    | Category slug or UUID does not exist                      | Show a "not found" page       |
| 400    | `displayCurrency` is not a valid 3-letter ISO 4217 code   | Fall back to default currency |
| 500    | Server error                                              | Show a generic error state    |

---

## Caching tips

- **Category list** (`GET /categories`) changes rarely. Cache it for 60 seconds or revalidate on navigation.
- **Products in a category** (`GET /categories/:slug/products`) changes more frequently. A shorter TTL (10–30 s) or on-demand revalidation is safer.
- If you're using Next.js, pass `{ next: { revalidate: 60 } }` in your fetch options for the category list and `{ next: { revalidate: 15 } }` for product pages.
