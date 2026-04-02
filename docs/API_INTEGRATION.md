# Frontend API integration guide

This document describes how a web or mobile client should talk to the **unified-commerce** NestJS API. All paths are relative to your API base URL (e.g. `https://api.example.com` or `http://localhost:3000`). There is **no global path prefix** unless you add one (e.g. behind a reverse proxy).

**Conventions**

- **JSON** bodies: `Content-Type: application/json`
- **Validation**: Unknown fields in JSON bodies are rejected (`403` with validation details is possible; invalid payloads return `400` with Nest’s default error shape).
- **CORS**: The API enables CORS automatically. With **`CORS_ORIGIN` unset**, the server **echoes the request’s `Origin`** (works for local dev, e.g. frontend `http://localhost:3000` → API `http://localhost:3030`). In production, set **`CORS_ORIGIN`** to a comma-separated allowlist (e.g. `https://app.example.com,https://www.example.com`).

### OpenAPI (Swagger)

- **Interactive UI:** `{API_BASE}/docs` or `{API_BASE}/api-docs` (same UI)
- **OpenAPI JSON:** `{API_BASE}/docs-json` or `{API_BASE}/api-docs-json`
- **Discovery:** `GET {API_BASE}/api` — JSON with the URLs above (REST routes are **not** prefixed with `/api`; only this discovery endpoint uses `/api`)

Use **Authorize** in Swagger UI and paste a JWT **access** token from `POST /auth/login`, `POST /auth/verify-email`, or `POST /auth/refresh`. Protected routes are marked with a lock icon.

---

## Authentication (JWT)

### Access token

Send on every protected request:

```http
Authorization: Bearer <accessToken>
```

Access tokens are **short-lived** (default `15m`, configurable via `JWT_ACCESS_EXPIRES` on the server).

### Refresh token

Returned with the access token on **successful login**, **`POST /auth/verify-email`** (after the user confirms their email), and **`POST /auth/refresh`**. It is **not** returned from **`POST /auth/register`** (registration only sends a verification email). Store the refresh token securely (httpOnly cookie preferred, or secure storage on mobile). Use it **only** for refresh — not as `Bearer` on normal routes.

### Token response shape (login / verify-email / refresh)

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": "15m"
}
```

When **`localCart`** was sent on **login** or **verify-email** and was non-empty, the response may also include **`cart`** (same shape as **`GET /cart`**).

### Refresh flow

1. `POST /auth/refresh` with body `{ "refreshToken": "<refreshToken>" }` (no `Authorization` header required).
2. On success, replace stored **access** and **refresh** tokens with the new pair.
3. On `401`, treat the session as ended; send the user through login again.

### Forgot password

`POST /auth/forgot-password`

```json
{ "email": "user@example.com" }
```

**Response (always this shape — do not use it to detect whether the email exists):**

```json
{
  "message": "If an account exists for that email, we sent a link to reset your password."
}
```

The API is **stricter rate-limited** on this route (5 requests per minute per IP by default). When the email matches a user and **`RESEND_API_KEY`** is set, the server emails a link:

`{FRONTEND_URL}/reset-password?token=<jwt>`

Configure **`FRONTEND_URL`** (or **`PUBLIC_APP_URL`**) in `.env`; otherwise the link defaults to `http://localhost:3000`. The token is a short-lived JWT signed with **`JWT_PASSWORD_RESET_SECRET`** (or falls back to **`JWT_REFRESH_SECRET`**). TTL defaults to **`PASSWORD_RESET_TOKEN_EXPIRES`** (`1h`).

### Reset password

`POST /auth/reset-password`

```json
{
  "token": "<token from email query string>",
  "password": "minimum8chars"
}
```

**Success:** `200` with `{ "message": "Password has been reset. Sign in with your new password; existing sessions were signed out." }`

**Invalid or expired token:** `400` with Nest’s default error body (`message` describes the problem).

After a successful reset, **refresh tokens** stored on the user are cleared — all devices must sign in again. When **`RESEND_API_KEY`** is set, the server also emails **“Your password was changed”** to the account address.

### Email verification (summary)

New accounts must verify email before **`POST /auth/login`** issues tokens. The server sends links to **`{FRONTEND_URL}/verify-email?token=...`**; the client completes verification with **`POST /auth/verify-email`** and can request new links with **`POST /auth/resend-verification`**. Unverified login returns **`403`** with **`code`: `"EMAIL_NOT_VERIFIED"`** (and may resend the email automatically).

**Full request/response shapes, flows, and UI handling** are in **[Email verification (frontend integration)](#email-verification-frontend-integration)** below.

### JWT payload (for UI logic only — do not trust for authorization)

Decoded access token includes roughly:

- `sub` — user id (UUID)
- `email`
- `role` — `USER` | `ADMIN_SUPER` | `ADMIN_STAFF`

Use `role` to show/hide admin UI; the API still enforces roles server-side.

---

## Public vs protected endpoints

| Area | Auth |
|------|------|
| `GET /health` | None |
| `POST /auth/register`, `POST /auth/login`, `POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /auth/refresh`, `POST /auth/forgot-password`, `POST /auth/reset-password` | None |
| `POST /products/import`, `GET /products/import/:importId` | None (import is rate-limited) |
| Socket.IO `/realtime` | None for **`import.subscribe`** / **`import.updated`**; optional Bearer JWT in `auth.token` for **`order.updated`** |
| `GET /products` | None — recent products (`?limit=`, capped) |
| `GET /products/:idOrSlug` | None — **`idOrSlug`** is the product **UUID** or the readable **`slug`** from list/detail JSON |
| `GET /me`, `PATCH /me` | Bearer access token |
| `GET /cart`, cart mutations | Bearer |
| `POST /orders`, `GET /orders`, `GET /orders/:id` | Bearer |
| `POST /payments/initialize` | Bearer |
| `GET /admin/*`, `PATCH /admin/*`, `POST /admin/scrape-preview` | Bearer + `ADMIN_SUPER` or `ADMIN_STAFF` |

Webhook routes (`POST /payments/webhooks/*`) are server-to-server — not called from the browser.

---

## Email verification (frontend integration)

Implement signup confirmation, a **verify-email** screen, and **resend** using the endpoints below. All paths are under your **`{API_BASE}`** (e.g. `https://api.example.com`). Use **`Content-Type: application/json`**.

### Server configuration (links inside emails)

The API embeds your storefront URL in verification emails:

`{FRONTEND_URL}/verify-email?token=<jwt>`

Set **`FRONTEND_URL`** or **`PUBLIC_APP_URL`** in the API’s environment so links point at your app (e.g. `https://app.example.com`). If unset, the server defaults to `http://localhost:3000`.

Verification JWTs are signed with **`JWT_EMAIL_VERIFICATION_SECRET`** if set, else **`JWT_PASSWORD_RESET_SECRET`**, else **`JWT_REFRESH_SECRET`**. Link TTL defaults to **`EMAIL_VERIFICATION_TOKEN_EXPIRES`** (`48h`).

Emails are sent via **Resend** when **`RESEND_API_KEY`** is set. For development without a verified domain, the API can use Resend’s onboarding sender (see **`RESEND_SANDBOX`** / non-production behavior in your deployment docs).

### Flow overview

| Step | Who | Action |
|------|-----|--------|
| 1 | Client | `POST /auth/register` — user signs up |
| 2 | API | Creates user; sends “Verify your email” (if Resend configured) |
| 3 | User | Opens link in email → lands on **`/verify-email?token=...`** in your SPA |
| 4 | Client | Read **`token`** from the URL → `POST /auth/verify-email` with `{ "token": "..." }` |
| 5 | API | Marks email verified; returns **access + refresh** tokens |
| 6 | Client | Store tokens; user is logged in (same as after login) |

If the user never received the email or the link expired: show **Resend** using `POST /auth/resend-verification`. If they try **login** before verifying: handle **`403`** + **`EMAIL_NOT_VERIFIED`** (the API may have resent the email automatically).

---

### 1. Register — `POST /auth/register`

**Request**

```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "user@example.com",
  "password": "minimum8chars",
  "phone": "+234..."
}
```

`phone` is optional. `firstName` / `lastName` are required (1–100 characters). There is **no** `localCart` on register; merge a guest cart on **`verify-email`** or after login (see below).

**Success — `200`**

```json
{
  "requiresEmailVerification": true,
  "email": "user@example.com",
  "message": "Check your inbox to verify your email. You can sign in after you confirm your address."
}
```

There are **no** `accessToken` / `refreshToken` in this response.

**Client UX:** Navigate to a “Check your email” screen; optionally show the masked **`email`**. Do not store JWTs from register.

**Errors:** `400` validation; `409` if email already registered.

---

### 2. Confirm email — `POST /auth/verify-email`

Call this when the user lands on your **`/verify-email`** route with a **`token`** query parameter (from the email link).

**Request**

```json
{
  "token": "<paste value of ?token= from the email URL>",
  "localCart": [
    {
      "productId": "550e8400-e29b-41d4-a716-446655440000",
      "quantity": 1,
      "variantSelection": { "Color": "Black" }
    }
  ]
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `token` | Yes | JWT string from **`verify-email?token=`** |
| `localCart` | No | Same shape as **`POST /auth/login`** (max **100** lines). Merges into the user’s cart after verification. |

**Success — `200`**

Same shape as login / refresh:

```json
{
  "accessToken": "…",
  "refreshToken": "…",
  "expiresIn": "15m",
  "cart": { }
}
```

`cart` is present only when **`localCart`** was non-empty (same structure as **`GET /cart`**).

**Client UX:** Persist **`accessToken`** and **`refreshToken`**; redirect to home or checkout. Clear the **`token`** from the URL (replace route without query) for security.

**Errors**

| Status | Meaning |
|--------|---------|
| `400` | Invalid or expired **`token`** — show “Link expired” and offer **resend** (section 3) |

---

### 3. Resend verification — `POST /auth/resend-verification`

Use when the user did not receive the first email or the verification link expired.

**Request**

```json
{ "email": "user@example.com" }
```

**Success — `200`**

Always return this message shape (do **not** infer whether the address exists or is unverified):

```json
{
  "message": "If an account exists and is not yet verified, we sent a confirmation link."
}
```

**Rate limiting:** **5 requests per minute** per IP (same class as **`POST /auth/forgot-password`**). On **`429`**, show “Try again in a minute.”

**Client UX:** “Resend email” button on the “Check your email” and “Verify expired” screens; optional cooldown timer.

---

### 4. Login before verification — `POST /auth/login`

If the password is correct but the user has **not** verified, the API returns **`403`** (no tokens).

**Response body (JSON)**

```json
{
  "statusCode": 403,
  "message": "Please verify your email before signing in. We sent another confirmation link to your inbox.",
  "code": "EMAIL_NOT_VERIFIED",
  "email": "user@example.com",
  "verificationEmailSent": true
}
```

| Field | Purpose |
|-------|---------|
| `code` | Always **`EMAIL_NOT_VERIFIED`** for this case — use for branching (not only HTTP status) |
| `email` | Confirmed address (for display / resend prefill) |
| `verificationEmailSent` | **`true`** if the API successfully sent another verification email; **`false`** if sending failed (e.g. Resend misconfiguration) — still show **resend** |

If **`verificationEmailSent`** is **`false`**, **`message`** is shorter (no “We sent another…” sentence).

**Client UX:** Do not treat as wrong password. Show “Verify your email” state; if **`verificationEmailSent`**, toast that a new email was sent; offer **resend** in all cases.

---

### 5. Profile flag — `GET /me`

After login or verify-email, **`GET /me`** includes **`emailVerified`** (`boolean`) so settings UIs can show verification state without guessing from errors.

---

### Minimal fetch examples (browser)

Replace **`API_BASE`** with your API origin.

**Verify email (e.g. on `/verify-email` page load)**

```ts
const params = new URLSearchParams(window.location.search);
const token = params.get('token');
if (!token) {
  // show error: missing link
} else {
  const res = await fetch(`${API_BASE}/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // 400 → expired / invalid token → offer resend
    throw err;
  }
  const data = await res.json();
  // data.accessToken, data.refreshToken, data.expiresIn [, data.cart]
}
```

**Resend**

```ts
await fetch(`${API_BASE}/auth/resend-verification`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: userEmail }),
});
// Always show the same success copy; do not reveal if email exists
```

**Login with unverified handling**

```ts
const res = await fetch(`${API_BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (res.status === 403) {
  const body = await res.json();
  if (body.code === 'EMAIL_NOT_VERIFIED') {
    // redirect to verify-email / check inbox UI
    // use body.verificationEmailSent, body.email
    return;
  }
}
```

---

## Auth

### Register

`POST /auth/register`

```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "user@example.com",
  "password": "minimum8chars",
  "phone": "+234..."
}
```

`phone` is optional. `firstName` and `lastName` are required (1–100 characters each).

**Response:** see **[Email verification (frontend integration)](#email-verification-frontend-integration)** (§1 Register) — **`requiresEmailVerification`**, **`email`**, and **`message`**; **no** **`accessToken`** until **`POST /auth/verify-email`** succeeds.

**Guest cart:** registration does **not** accept **`localCart`**. After verification, send **`localCart`** on **`POST /auth/verify-email`** (same merge behavior as login), or sign in and send **`localCart`** on **`POST /auth/login`**, or call **`POST /cart/sync`** once you have a Bearer token.

### Login

`POST /auth/login`

```json
{
  "email": "user@example.com",
  "password": "...",
  "localCart": [
    { "productId": "550e8400-e29b-41d4-a716-446655440000", "quantity": 1 },
    {
      "productId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      "quantity": 2,
      "variantSelection": { "Color": "Black", "Storage": "256GB" }
    }
  ]
}
```

`localCart` is optional. When present and non-empty, the response includes **`cart`** alongside **`accessToken`**, **`refreshToken`**, and **`expiresIn`**.

**Unverified email:** valid password but email not confirmed → **`403`** with **`code`: `"EMAIL_NOT_VERIFIED"`** (see **[Email verification (frontend integration)](#email-verification-frontend-integration)** — §4).

### Verify email

Same as **[§2 Confirm email](#email-verification-frontend-integration)** in the integration chapter below.

`POST /auth/verify-email`

```json
{
  "token": "<jwt from email query string>",
  "localCart": [
    { "productId": "550e8400-e29b-41d4-a716-446655440000", "quantity": 1 }
  ]
}
```

**`token`** — required (from **`?token=`** on **`{FRONTEND_URL}/verify-email`**).

**`localCart`** — optional; same rules as login (max **100** lines). When non-empty, the response includes **`cart`** like **`GET /cart`**.

**Success:** **`200`** with **`accessToken`**, **`refreshToken`**, **`expiresIn`** (and **`cart`** if `localCart` was sent).

**Invalid or expired token:** **`400`** — use **resend verification** if the link expired.

### Resend verification email

Full detail: **[Email verification (frontend integration)](#email-verification-frontend-integration)** (§3 Resend verification).

`POST /auth/resend-verification`

```json
{ "email": "user@example.com" }
```

**Response (always this shape — do not use it to detect whether the email exists or is unverified):**

```json
{
  "message": "If an account exists and is not yet verified, we sent a confirmation link."
}
```

Rate-limited (**5 requests per minute** per IP by default), same order of magnitude as **`POST /auth/forgot-password`**.

### Refresh

`POST /auth/refresh`

```json
{
  "refreshToken": "<refreshToken>"
}
```

---

## User profile

Routes are mounted at the **root** (not under `/users`).

### Get current user

`GET /me` — Bearer required.

Typical JSON includes **`emailVerified`** (`boolean`) so the UI can show verification state without inferring it from errors.

### Update profile

`PATCH /me`

```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "phone": "+234...",
  "defaultShippingAddress": {
    "fullName": "Jane Doe",
    "line1": "1 Street",
    "line2": "Apt 2",
    "city": "Lagos",
    "state": "LA",
    "country": "NG",
    "postalCode": "100001",
    "phone": "+234..."
  }
}
```

All fields optional; only send what changes. For orders, if `shippingAddress` is omitted at checkout, the API uses `defaultShippingAddress` when set.

---

## Products

### Import from URL (async)

`POST /products/import`

```json
{
  "url": "https://www.jumia.com.ng/..."
}
```

**Responses (shape varies):**

- **First-time success (or cache-only hit with no failed import row):** may include `status: "completed"` and `product` (full product object).
- **Same URL after a successful import (`import` row `COMPLETED`):** the API **re-queues a scrape** to refresh the product. You get `status: "queued"` or `"processing"` and the **same `importId`**; poll until `COMPLETED` again. The URL→product Redis cache is cleared when the rescrape starts so `POST /products/import` cannot short-circuit to an old “completed” payload while a new job is expected. When the worker finishes, it **updates the existing `products` row** in Postgres (title, description, `originalPrice` / `salePrice`, currency, `images`, `variants`, availability, `lastScrapedAt` / `lastVerifiedAt`). **`markupPercent` on that row is preserved** across rescrapes; only the scraped supplier price and derived sale price are recomputed with the stored markup. After `COMPLETED`, **`GET /products/:idOrSlug`** (and the `product` object on the import status response) should match the latest scrape—refetch the product by id or slug rather than relying on a cached client copy.
- **Queued / processing (first import or in-flight):** `status` is `"queued"` or `"processing"` and an `importId` (UUID) is returned.

**Why “queued” or “processing”?** Imports do **not** run inside the HTTP request. The API enqueues a **background job** (Bull/Redis) that launches **Playwright** to load the retailer page and extract data. That keeps requests fast and avoids browser timeouts. If the **same normalized URL** is submitted again while a job is still `QUEUED` or `PROCESSING`, the API returns **`processing`** and the **same `importId`** — one shared job, not two scrapes.

**How long to wait?** There is no fixed time. Plan for roughly **30 seconds to a few minutes** (`typicalWaitSeconds.min` / `typicalWaitSeconds.max` in the JSON are hints for UI copy only). If status stays `QUEUED` for many minutes, the worker process may be down, **Redis unreachable**, or the DB row may have **lost its Bull job** (e.g. Redis restarted). The API **re-attaches** a missing job when you **poll** `GET /products/import/:id` or **POST** `/products/import` again for the same URL, so polling usually self-heals without manual steps.

**Do workers start with the app?** Yes. In this codebase the Bull worker runs **in the same Node process** as the HTTP server (`JobsModule`). You should see a log like `[job:scrape] worker=ready` at startup. If Redis is wrong or empty, jobs never run — fix `REDIS_URL` to match a persistent Redis instance.

**Showing a patient UI:** While `QUEUED` or `PROCESSING`, responses include:

| Field | Use |
|--------|-----|
| `userMessage` | Show under a spinner / skeleton (localized copy can replace it) |
| `phase` | `"queued"` = waiting for or in queue; `"scraping"` = browser import running |
| `pollAfterMs` | Wait this many ms before the next `GET /products/import/:importId` (e.g. `2500`) |
| `typicalWaitSeconds` | `{ "min": 30, "max": 180 }` — e.g. “Usually 30s–3 min” |

Poll:

`GET /products/import/:importId`

Returns `status` (`QUEUED` | `PROCESSING` | `COMPLETED` | `FAILED`), the same **pending hints** as above while not finished, optional user-safe `message` when `FAILED` (no internal scrape errors), and `product` only when **`COMPLETED`**. A later failed retry does not attach `product` to a `FAILED` response (the catalog row may still exist at `GET /products/:idOrSlug` if you kept the id or slug from an earlier success).

**Real-time (no extra polling required):** As soon as the worker saves **`PROCESSING`**, **`COMPLETED`**, or **`FAILED`**, the server emits **`import.updated`** on Socket.IO (namespace **`/realtime`**) with the **same JSON** as this GET would return for that moment—including the full **`product`** on completion. Connect, send **`import.subscribe`** with `{ "importId": "<uuid from POST import>" }`, then listen for **`import.updated`**. When `status === "COMPLETED"`, use **`payload.product`** immediately (that object is already what you would get from **`GET /products/:idOrSlug`**). If `status` is `PROCESSING` but `product` is present (e.g. rescrape), treat it as the **previous** catalog snapshot until you receive **`COMPLETED`**. See **Real-time updates (Socket.IO)** below.

**Background price verify:** After a successful import scrape, the server enqueues a **delayed** job (about one minute) that scrapes the same URL again and **merges the result into the product row** (same fields as a rescrape: price, title, media, variants, description text, timestamps). That keeps checkout-time refreshes and post-import verification aligned with the latest adapter output. If you change scraper logic and rescrape, allow up to ~1–2 minutes after `COMPLETED` before assuming the verify pass has run, or hit **`GET /products/:idOrSlug`** again.

**Not persisted:** **`POST /admin/scrape-preview`** only returns JSON for debugging; it does **not** write to `products` or `imported_products`. To refresh the database after code changes, use **`POST /products/import`** with the same product URL and poll until **`COMPLETED`**, then **`GET /products/:idOrSlug`**.

**Rate limit:** this route is throttled (e.g. 10 requests per minute per IP). Expect `429` if exceeded.

### Get product (public)

`GET /products/:idOrSlug` — pass either the product **`id`** (UUID) or the human-readable **`slug`** (same value as in JSON responses). Use **`slug`** in storefront URLs for readable paths (e.g. `/products/iphone-air-256gb-light-gold`); cart and orders still use **`productId`** = UUID.

Typical product fields include: `id`, `slug`, `sourceUrl`, `scrapeUrl` (same value as `sourceUrl`, the normalized URL used for scrapes and future periodic rescrapes), `rescrapeEnabled` (default `true`; set `false` to exclude from cron rescrape jobs), `source`, `title`, `description`, `brand`, `originalPrice`, `salePrice`, `currency`, `markupPercent`, `images`, `variants`, `availability`, `stockQuantity` (`null` = unlimited), `lastScrapedAt`, `lastVerifiedAt`, timestamps. **`description`** is assembled from scraper output: e.g. **Apple** may include JSON-LD excerpt, an optional configuration **price range**, and **Configurations:** lines from the matrix; **Amazon** may append a **retailer list price** sentence when the PDP shows a markdown (there is no separate `compareAtPrice` field on the product JSON). **`configurationPrices`** (`label`, `originalPrice`, `salePrice`, optional `partNumber` / `sku`) lists per-configuration prices when the scraper provides them (**Apple** metrics SKUs). **`availability`** is sometimes set to human-readable strings (e.g. Amazon **In stock** / **Out of stock**).

**Frontend layout:** see **`PRODUCT_PAGE_UI_GUIDE.md`** for how to display pricing, variants, images, and description on product pages and cards.

### List recent products (public)

`GET /products` — no auth. Returns the newest products first (same object shape as **`GET /products/:idOrSlug`**).

**Query:** `limit` (optional, integer) — default **24**, maximum **100** (values below 1 are treated as 1).

**Admin:** For a longer internal list (up to **500** rows), use **`GET /admin/products`** with Bearer + admin role.

---

## Cart

All routes require Bearer.

### Get cart

`GET /cart`

Response includes `id` and `items[]` with `id`, `quantity`, `variantSelection`, and nested `product` (or minimal `{ id }` if relation missing).

### Add line

`POST /cart/items`

```json
{
  "productId": "uuid",
  "quantity": 1,
  "variantSelection": { "Size": "M", "Color": "Black" }
}
```

`variantSelection` optional.

### Merge guest / local cart (after login)

`POST /cart/sync` — Bearer required.

Use when the client kept a guest cart in **localStorage** (or similar) and did not send **`localCart`** on **`POST /auth/login`** or **`POST /auth/verify-email`**. Body:

```json
{
  "items": [
    { "productId": "uuid", "quantity": 1 },
    {
      "productId": "uuid",
      "quantity": 2,
      "variantSelection": { "Color": "Black" }
    }
  ]
}
```

Max **100** lines. Merges into the server cart the same way as repeated **`POST /cart/items`** (quantities add per `productId`). Returns the full cart as **`GET /cart`**.

### Update quantity

`PATCH /cart/items/:itemId`

```json
{
  "quantity": 2
}
```

`0` removes the line.

### Remove line

`DELETE /cart/items/:itemId`

---

## Orders

Bearer required.

### Create order from cart

`POST /orders`

```json
{
  "shippingAddress": {
    "fullName": "Jane Doe",
    "line1": "...",
    "city": "...",
    "country": "NG"
  }
}
```

Omit `shippingAddress` only if the user profile has `defaultShippingAddress` set.

**Behavior:** re-scrapes each cart line to refresh price, checks **stock** when `stockQuantity` is set on products, creates the order as `PENDING`, snapshots line items, clears the cart, and may enqueue a confirmation email.

### List my orders

`GET /orders`

### Get one order

`GET /orders/:id`

**Order response highlights:**

- `status` — `PENDING` | `PAID` | `PROCESSING` | `ORDERED_FROM_SUPPLIER` | `SHIPPED` | `DELIVERED` | `CANCELLED`
- `items[]` — snapshots: `title`, `price`, `currency`, `quantity`, `images`, `variant`, etc.
- `payment` — after payment:
  - `provider` — `paystack` | `stripe`
  - `methodDetails` — e.g. brand, last4, channel, `label`
  - `paystackReference`, `stripeCheckoutSessionId`, `stripePaymentIntentId` as applicable
- `tracking[]` — shipment events when present

---

## Payments

Bearer required for initialization only.

### Initialize payment

`POST /payments/initialize`

```json
{
  "orderId": "uuid",
  "provider": "paystack"
}
```

or

```json
{
  "orderId": "uuid",
  "provider": "stripe",
  "stripePaymentMethodTypes": ["card", "link"],
  "stripeSuccessUrl": "https://app.example/success?session_id={CHECKOUT_SESSION_ID}",
  "stripeCancelUrl": "https://app.example/cancel"
}
```

**`provider` values:** `paystack` | `stripe` (lowercase strings).

**Paystack optional:** `paystackChannels` — e.g. `["card","bank","ussd","qr","mobile_money","bank_transfer","eft"]`. Omit to use Paystack account defaults.

**Stripe optional:** `stripePaymentMethodTypes` — e.g. `card`, `link`, `us_bank_account`, `ideal`, `sepa_debit`, `klarna`, `afterpay_clearpay`, `affirm`. Omit for **dynamic** Checkout methods.  
**URLs:** If omitted, the server uses `STRIPE_CHECKOUT_SUCCESS_URL` / `STRIPE_CHECKOUT_CANCEL_URL`. Success URL **must** contain the literal `{CHECKOUT_SESSION_ID}` substring (Stripe replaces it).

**Paystack response:**

```json
{
  "provider": "paystack",
  "authorizationUrl": "https://...",
  "accessCode": "...",
  "reference": "...",
  "channels": ["card"] 
}
```

Redirect the browser to `authorizationUrl` (or open in WebView). Paystack will call your **server** webhook on success; your UI should confirm payment via polling `GET /orders/:id` until `status` is `PAID` or use success callback page that refetches the order.

**Stripe response:**

```json
{
  "provider": "stripe",
  "sessionId": "cs_...",
  "url": "https://checkout.stripe.com/...",
  "paymentMethodTypes": ["card", "link"]
}
```

Redirect to `url`. After Checkout, Stripe hits the **backend** webhook; poll `GET /orders/:id` on your success page until `PAID`.

**Frontend keys:** You may use **Paystack public key** or **Stripe publishable key** only if you build a custom client-side flow. This API’s default flows are **redirect-based** (Paystack URL / Stripe Checkout URL) after `initialize`.

---

## Admin (staff / super admin)

Bearer + role `ADMIN_STAFF` or `ADMIN_SUPER`.

### List orders

`GET /admin/orders`

Same order shape as user list, plus `userEmail` on each order when returned through admin paths (see server `toResponse`).

### Patch order

`PATCH /admin/orders/:id`

```json
{
  "status": "SHIPPED",
  "supplierOrderId": "PO-123",
  "trackingNumber": "1Z999...",
  "carrier": "DHL",
  "trackingStatus": "IN_TRANSIT"
}
```

All fields optional. When `carrier` and `trackingNumber` are both sent, a tracking row is appended and a notification may be sent.

### List products (admin)

`GET /admin/products`

### Scrape preview (debug only)

`POST /admin/scrape-preview`

```json
{ "url": "https://..." }
```

Runs **Playwright in the HTTP request** (no import row, no queue). Returns `{ url, detectedSource, scraped }` in **`ScrapedProduct`** shape. **Throttled** (e.g. 5/min). **Does not update the catalog:** there is no `products` row write. Use **`POST /products/import`** (queued worker) so results are saved and **`GET /products/:idOrSlug`** reflects adapter changes after you deploy new scraper code. See **`docs/SCRAPER_ARCHITECTURE.md`** for the scrape stack overview.

---

## Real-time updates (Socket.IO)

Namespace **`/realtime`**, path **`/socket.io`** (Socket.IO v4).

### Product import — `import.updated`

Imports are **public** (no JWT). You can open a socket **without** `auth.token` and only use import events.

1. After `POST /products/import` returns `importId`, connect and **emit** `import.subscribe` with `{ importId }`.
2. The ack is `{ ok: true, importId }` or `{ ok: false, error: "invalid_import_id" | "import_not_found" }`.
3. If the import is already **`COMPLETED`** or **`FAILED`**, the server sends one **`import.updated`** immediately with the full status payload.
4. Otherwise, wait for **`import.updated`** when the worker moves to **`PROCESSING`** (scrape started), again when it reaches **`COMPLETED`** (includes **`product`**), or **`FAILED`**.

```ts
import { io } from 'socket.io-client';

const socket = io(`${API_BASE_URL}/realtime`, { path: '/socket.io' });

socket.on('connect', () => {
  socket.emit('import.subscribe', { importId }, (ack: { ok: boolean }) => {
    if (!ack.ok) console.error('subscribe failed', ack);
  });
});

socket.on('import.updated', (payload) => {
  if (payload.status === 'COMPLETED' && payload.product) {
    // Show new title, price, variants, images immediately — same as GET /products/:idOrSlug
    renderProduct(payload.product);
  }
});
```

For **logged-in** users, you can pass **`auth: { token: accessToken }`** on the **same** socket so you also receive order events (below).

### Orders — `order.updated`

With a **valid** JWT (`auth.token` or `?token=`), the server joins the socket to **`user:<userId>`** for order notifications.

```ts
const socket = io(`${API_BASE_URL}/realtime`, {
  path: '/socket.io',
  auth: { token: accessToken },
});
```

```ts
socket.on('order.updated', (payload: { orderId: string; status: string }) => {
  // refetch GET /orders/:id or merge into store
});
```

Invalid or expired JWT does **not** disconnect the socket; you still get import events, but not order pushes until you reconnect with a fresh token.

---

## Error handling

- **`401 Unauthorized`** — missing/invalid/expired access token. Try refresh once, then login.
- **`403 Forbidden`** — authenticated but not allowed (e.g. non-admin hitting admin routes), **or** login blocked until email verification (**`code`: `"EMAIL_NOT_VERIFIED"`** in the JSON body — see **Authentication → Login when email is not verified**).
- **`400 Bad Request`** — validation or business rule (e.g. empty cart, insufficient stock, wrong order state for payment).
- **`404 Not Found`** — resource missing or not owned by the user (orders are scoped by user).
- **`429 Too Many Requests`** — throttling (notably product import).

Nest validation errors often look like:

```json
{
  "statusCode": 400,
  "message": ["url must be a valid URL"],
  "error": "Bad Request"
}
```

---

## Suggested frontend flows

1. **Browse / import:** `POST /products/import` → open Socket.IO **`import.subscribe`** with `importId` and apply **`import.updated`** when `status === "COMPLETED"` (use **`product`** from the event—no wait for a poll). Optionally keep polling `GET /products/import/:id` as a fallback. After a **re-import**, the next **`import.updated`** with **`COMPLETED`** again carries the refreshed **`product`**.
2. **Checkout:** `POST /cart/items` … → `POST /orders` → `POST /payments/initialize` → redirect to Paystack or Stripe URL → success page polls `GET /orders/:id`.
3. **Account:** register → verify email (`POST /auth/verify-email` or link from inbox) → login; handle login **`403`** + **`EMAIL_NOT_VERIFIED`** with resend. `GET /me` / `PATCH /me`; keep cart and orders behind auth.
4. **Admin:** gate routes on `role`; use `/admin/*` (e.g. **`GET /admin/products`** for the full catalog). Storefront home can use public **`GET /products?limit=…`** for recent items.

---

## Environment variables (frontend)

Only **public** keys belong in the frontend bundle (e.g. Paystack **public** key, Stripe **publishable** key) if you add custom payment UI. **Never** expose `JWT_*_SECRET`, `PAYSTACK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, database URLs, or webhook secrets in client code.

---

## Quick reference

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` | — |
| POST | `/auth/register` | — |
| POST | `/auth/verify-email` | — |
| POST | `/auth/resend-verification` | — |
| POST | `/auth/login` | — |
| POST | `/auth/refresh` | — |
| POST | `/auth/forgot-password` | — |
| POST | `/auth/reset-password` | — |
| GET | `/me` | Bearer |
| PATCH | `/me` | Bearer |
| POST | `/products/import` | — |
| GET | `/products/import/:importId` | — |
| GET | `/products` | — |
| GET | `/products/:idOrSlug` | — |
| GET | `/cart` | Bearer |
| POST | `/cart/sync` | Bearer |
| POST | `/cart/items` | Bearer |
| PATCH | `/cart/items/:itemId` | Bearer |
| DELETE | `/cart/items/:itemId` | Bearer |
| POST | `/orders` | Bearer |
| GET | `/orders` | Bearer |
| GET | `/orders/:id` | Bearer |
| POST | `/payments/initialize` | Bearer |
| GET | `/admin/orders` | Bearer admin |
| PATCH | `/admin/orders/:id` | Bearer admin |
| GET | `/admin/products` | Bearer admin |
| POST | `/admin/scrape-preview` | Bearer admin |
| Socket.IO | `/realtime` | — for import events; optional JWT for `order.updated` |
