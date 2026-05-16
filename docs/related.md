# Related Products — Frontend Integration Guide

The related products endpoint returns items a shopper is likely interested in while viewing a product detail page. Results are ranked by relevance: same-category products appear first, then products with a similar name/title.

All paths are relative to your API base URL. This endpoint is **public** — no auth token required.

---

## Endpoint

```
GET /products/:idOrSlug/related
```

Pass either the product's UUID or its URL slug as `:idOrSlug`.

**Query parameters**

| Parameter         | Default | Max | Description                                              |
|-------------------|---------|-----|----------------------------------------------------------|
| `limit`           | `8`     | `20` | Number of related products to return                   |
| `displayCurrency` | —       | —   | ISO 4217 code (e.g. `USD`, `NGN`, `EUR`) to convert prices |

---

## TypeScript type

The response is a flat array of the same `Product` shape returned by `GET /products` and `GET /products/:idOrSlug`.

```ts
// Re-use your existing Product type — no new type needed
type RelatedProductsResponse = Product[];
```

---

## Fetch function

```ts
interface GetRelatedOptions {
  limit?: number;           // 1–20, default 8
  displayCurrency?: string; // ISO 4217, e.g. 'USD'
}

async function getRelatedProducts(
  idOrSlug: string,
  options: GetRelatedOptions = {},
): Promise<Product[]> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.displayCurrency) params.set('displayCurrency', options.displayCurrency);

  const query = params.toString() ? `?${params}` : '';
  const res = await fetch(`${API_BASE}/products/${idOrSlug}/related${query}`);

  if (res.status === 404) throw new Error('Product not found');
  if (res.status === 400) {
    const body = await res.json();
    throw new Error(body.message);
  }
  if (!res.ok) throw new Error('Failed to fetch related products');

  return res.json();
}

// e.g.
getRelatedProducts('iphone-air-256gb-light-gold', { limit: 6, displayCurrency: 'NGN' });
```

---

## How results are ranked

1. **Same category** — products sharing the same category as the viewed item appear first, ordered by newest first.
2. **Name similarity** — if fewer than `limit` results were found in step 1, products whose titles share significant keywords with the viewed product fill the remainder (also newest first).

The viewed product itself is never included.

---

## Common patterns

### Product detail page

Fetch the product and its related items in parallel to avoid a waterfall:

```ts
const [product, related] = await Promise.all([
  getProduct(slug),
  getRelatedProducts(slug, { limit: 8 }),
]);
```

### Currency-aware storefront

Pass the user's active currency so prices arrive pre-converted — no client-side math needed:

```ts
const related = await getRelatedProducts(slug, {
  limit: 8,
  displayCurrency: userCurrency, // e.g. 'NGN'
});
```

### Hiding the section when empty

The array may be empty if the product has no category and no title keywords matched anything:

```tsx
{related.length > 0 && (
  <section>
    <h2>You might also like</h2>
    <ProductGrid items={related} />
  </section>
)}
```

---

## Error handling

| Status | When it happens                                         | What to do                    |
|--------|---------------------------------------------------------|-------------------------------|
| 404    | The `:idOrSlug` product does not exist                  | Product page should handle this itself |
| 400    | `displayCurrency` is not a valid 3-letter ISO 4217 code | Fall back to no currency param |
| 500    | Server error                                            | Silently hide the section     |

Related items are supplementary UI — if the request fails, hide the section rather than blocking the page.

---

## Caching tips

Related results change whenever new products are added to the same category. A short TTL keeps the section fresh without hammering the API:

- **30 seconds** is a safe default for most storefronts.
- With Next.js: `fetch(url, { next: { revalidate: 30 } })`
- Cache per product slug, not globally, so each product page gets its own related set.
