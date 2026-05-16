# Frontend API integration guide

This document describes how a web or mobile client should talk to the **unified-commerce** NestJS API. All paths are relative to your API base URL (e.g. `https://api.example.com` or `http://localhost:3000`). There is **no global path prefix** unless you add one (e.g. behind a reverse proxy).

**Conventions**

- **JSON** bodies: `Content-Type: application/json`
- **Validation**: Unknown fields in JSON bodies are rejected (`403` with validation details is possible; invalid payloads return `400` with Nest’s default error shape).
- **CORS**: With **`CORS_ORIGIN` unset**, the server **echoes the request’s `Origin`** (any site can call the API — fine for quick local tests; lock down in production). If **`CORS_ORIGIN` is set** (comma-separated allowlist), the browser **`Origin` must match** an entry or the request is blocked. For a **local Next/React app** calling a **hosted** API (e.g. Railway), either add your exact origin (e.g. `http://localhost:3000`) to **`CORS_ORIGIN`**, or set **`CORS_ALLOW_LOCALHOST=true`** to allow **any** `http(s)://localhost:*` or `http(s)://127.0.0.1:*` in addition to the allowlist. Deploy the API after changing env vars. If preflight still fails with no `Access-Control-Allow-Origin`, check the **Network** tab: a **502/503** HTML response from the proxy also surfaces as a CORS error.

### OpenAPI (Swagger)

- **Interactive UI:** `{API_BASE}/docs` or `{API_BASE}/api-docs` (same UI)
- **OpenAPI JSON:** `{API_BASE}/docs-json` or `{API_BASE}/api-docs-json`
- **Discovery:** `GET {API_BASE}/api` — JSON with the URLs above (REST routes are **not** prefixed with `/api`; only this discovery endpoint uses `/api`)

Use **Authorize** in Swagger UI and paste a JWT **access** token from `POST /auth/login` (or `POST /auth/login/2fa` when 2FA is enabled), `POST /auth/verify-email`, or `POST /auth/refresh`. Protected routes are marked with a lock icon.

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

When **`localCart`** was sent on **login** or **verify-email** and was non-empty, the response may also include **`cart`** (same shape as **`GET /cart`**)—but **only when the login response includes access and refresh tokens**. If the user has [two-factor authentication](#two-factor-authentication-totp) enabled, the first password step does not return tokens; send **`localCart`** again on **`POST /auth/login/2fa`** after a successful TOTP.

### Two-factor authentication (TOTP)

Users can turn **authenticator-app 2FA** on or off from **[User profile → Two-factor (TOTP) settings](#user-profile)**. When 2FA is **enabled**, **`POST /auth/login`** (after a correct password) returns a **pre-auth** payload instead of JWTs. Complete sign-in with **`POST /auth/login/2fa`**.

**1) Password (unchanged request)**

`POST /auth/login` with `email`, `password`, optional `localCart`.

**2a) 2FA not enabled — same as before**

```json
{
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG...",
  "expiresIn": "15m"
}
```

Optional **`cart`** if `localCart` was non-empty.

**2b) 2FA enabled — second step required**

```json
{
  "requiresTwoFactor": true,
  "errorCode": "TWO_FACTOR_REQUIRED",
  "preAuthToken": "eyJhbG...",
  "expiresIn": "5m"
}
```

- **`preAuthToken`** — short-lived JWT (TTL from **`JWT_2FA_PREAUTH_EXPIRES`**, default **`5m`**; signed with **`JWT_2FA_PREAUTH_SECRET`** if set, else **`JWT_REFRESH_SECRET`**). The client does **not** use this as `Authorization: Bearer` on normal API routes — the server rejects any token carrying a `purpose` claim on protected endpoints. It is only for the next call.
- Show a **TOTP / authenticator app** field; then call **`POST /auth/login/2fa`**.

**3) TOTP step**

`POST /auth/login/2fa` (no `Authorization` header; rate-limited, e.g. 10 requests per minute per IP)

```json
{
  "preAuthToken": "<from previous response>",
  "code": "123456",
  "localCart": [
    { "productId": "550e8400-e29b-41d4-a716-446655440000", "quantity": 1 }
  ]
}
```

- **`code`** — 6–8 digits from the app (no spaces, or spaces stripped server-side).
- **`localCart`** — optional; same rules as login (max **100** lines). If you need guest cart merge, send it here (not on the password-only response, which has no session yet).

**Success:** same token shape as normal login: **`accessToken`**, **`refreshToken`**, **`expiresIn`**, and optional **`cart`**.

**Errors:** `401` — wrong or expired TOTP, or bad **`preAuthToken`**. `400` — invalid or expired pre-auth session (re-run **`POST /auth/login`**).

**Enabling 2FA in the app (logged-in user)**

1. `POST /me/2fa/setup` — returns **`qrCodeDataUrl`**, **`otpauthUrl`**, **`secret`** (manual entry), **`issuer`**. A pending setup is stored until you confirm or cancel.
2. User scans the QR in Google Authenticator (or similar), then `POST /me/2fa/enable` with `{ "code": "123456" }`.
3. `GET /me` then includes **`twoFactor.enabled: true`**.

**Disabling 2FA:** `POST /me/2fa/disable` with `{ "password": "...", "code": "..." }` (current password + current TOTP). **All refresh tokens** for that user are cleared; other devices must sign in again.

**Cancel a pending setup (not yet enabled):** `POST /me/2fa/setup/cancel`

**Status only:** `GET /me/2fa` — `{ "enabled": false, "setupPending": true }` (or both booleans as applicable). Same flags appear in **`GET /me`** as **`twoFactor: { enabled, setupPending }`**.

### Passkeys (WebAuthn)

Passkeys let users authenticate with Face ID, Touch ID, Windows Hello, or a hardware security key — no password needed. The implementation uses the [WebAuthn Level 2](https://www.w3.org/TR/webauthn-2/) standard via `@simplewebauthn/server`.

**Server environment variables (required):**

| Variable | Example | Notes |
|----------|---------|-------|
| `PASSKEY_RP_ID` | `example.com` | Bare domain only — no `https://` or path. Use `localhost` in development. |
| `PASSKEY_RP_NAME` | `My Store` | Shown in the browser passkey dialog |
| `PASSKEY_ORIGIN` | `https://example.com` | Comma-separated. Falls back to `FRONTEND_URL`. |

Redis (`REDIS_URL`) is **required** for passkeys — challenges are stored there with a 5-minute TTL.

---

#### Registration (add a passkey to an existing account)

The user must already be logged in with password/TOTP.

**Step 1 — get options**

`POST /auth/passkey/register/start` — Bearer required.

No request body. Returns WebAuthn `PublicKeyCredentialCreationOptions` JSON.

**Step 2 — create credential on device**

Pass the options to `@simplewebauthn/browser`:

```ts
import { startRegistration } from '@simplewebauthn/browser';

const optionsRes = await fetch('/auth/passkey/register/start', {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}` },
});
const options = await optionsRes.json();

const registrationResponse = await startRegistration({ optionsJSON: options });
```

**Step 3 — verify and save**

`POST /auth/passkey/register/finish` — Bearer required.

```json
{
  "response": { /* registrationResponse from startRegistration() */ },
  "friendlyName": "My iPhone"
}
```

`friendlyName` is optional (max 128 chars) — shown in the passkeys list so users know which device each key is from.

**Response:**

```json
{ "verified": true, "credentialId": "abc123..." }
```

---

#### Authentication (sign in with a passkey)

**Step 1 — get challenge**

`POST /auth/passkey/login/start` — no auth, rate-limited (20/min).

No request body. Returns `PublicKeyCredentialRequestOptions` JSON.

**Step 2 — sign with device**

```ts
import { startAuthentication } from '@simplewebauthn/browser';

const optionsRes = await fetch('/auth/passkey/login/start', { method: 'POST' });
const options = await optionsRes.json();

const authResponse = await startAuthentication({ optionsJSON: options });
```

**Step 3 — verify and get tokens**

`POST /auth/passkey/login/finish` — no auth, rate-limited (10/min).

Body: the raw `authResponse` object from `startAuthentication()` (send it directly).

**Response (same shape as password login):**

```json
{
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG...",
  "expiresIn": "15m"
}
```

Store tokens the same way as a password login. The same refresh flow applies.

**Error codes:**
- `401` — passkey not found, bad signature, or counter mismatch (potential replay attack)
- `400` — challenge expired (> 5 min) or session not started — call `login/start` again

---

#### Credential management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/passkey/credentials` | List the user's registered passkeys |
| `PATCH` | `/auth/passkey/credentials/:id` | Rename a passkey (`{ "friendlyName": "Work Mac" }`) |
| `DELETE` | `/auth/passkey/credentials/:id` | Remove a passkey |

`GET /auth/passkey/credentials` response:

```json
[
  {
    "id": "uuid",
    "credentialId": "base64url...",
    "deviceType": "multiDevice",
    "backedUp": true,
    "transports": ["internal"],
    "friendlyName": "My iPhone",
    "createdAt": "2026-05-08T10:00:00.000Z"
  }
]
```

`deviceType` is `"singleDevice"` (bound to one device) or `"multiDevice"` (synced passkey, e.g. iCloud Keychain). Show this in a security settings screen so users understand which passkeys are cross-device.

---

#### Frontend integration summary

```
Register:  POST /auth/passkey/register/start (Bearer)
           → startRegistration({ optionsJSON })   [browser]
           → POST /auth/passkey/register/finish (Bearer, body = { response, friendlyName? })

Login:     POST /auth/passkey/login/start
           → startAuthentication({ optionsJSON })  [browser]
           → POST /auth/passkey/login/finish (body = authResponse)
           → store accessToken + refreshToken
```

Install on the frontend: `npm install @simplewebauthn/browser` (or `pnpm add @simplewebauthn/browser`). The browser package handles all `navigator.credentials` calls and encoding.

---

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
| `POST /auth/register`, `POST /auth/login`, `POST /auth/login/2fa`, `POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /auth/refresh`, `POST /auth/forgot-password`, `POST /auth/reset-password` | None |
| `POST /products/import`, `GET /products/import/:importId` | None (import is rate-limited) |
| Socket.IO `/realtime` | None for **`import.subscribe`** / **`import.updated`**; optional Bearer JWT in `auth.token` for **`order.updated`** |
| `GET /products` | None — recent products (`?limit=`, `?displayCurrency=` optional) |
| `GET /products/:idOrSlug` | None — **`idOrSlug`** is the product **UUID** or the readable **`slug`** from list/detail JSON; optional `?displayCurrency=` |
| `POST /shipping/quote` | None — Kingz-only shipping cost calculator |
| `POST /landed-cost/quote` | None — full landed cost estimate (tax + domestic shipping + Kingz + customs + buffers + margin) |
| `GET /me`, `PATCH /me` | Bearer access token |
| `GET /me/2fa`, `POST /me/2fa/*` (setup, enable, setup/cancel, disable) | Bearer access token |
| `POST /auth/passkey/login/start`, `POST /auth/passkey/login/finish` | None |
| `POST /auth/passkey/register/start`, `POST /auth/passkey/register/finish` | Bearer |
| `GET /auth/passkey/credentials`, `PATCH /auth/passkey/credentials/:id`, `DELETE /auth/passkey/credentials/:id` | Bearer |
| `GET /cart`, cart mutations | Bearer |
| `GET /saves`, `POST /saves/:productId`, `DELETE /saves/:productId`, `GET /saves/:productId/status` | Bearer |
| `POST /orders`, `GET /orders`, `GET /orders/:id` | Bearer |
| `POST /reconciliation/issues` | Bearer — create a support ticket / issue |
| `POST /reconciliation/price-disputes` | Bearer |
| `GET /reconciliation/my-issues`, `GET /reconciliation/my-issues/:id` | Bearer |
| `GET /payments/methods` | None (recommended before checkout) |
| `POST /payments/initialize`, `POST /payments/paypal/capture` | Bearer |
| `GET /admin/*`, `PATCH /admin/*`, `POST /admin/scrape-preview` | Bearer + `ADMIN_SUPER` or `ADMIN_STAFF` |
| `GET /admin/shipping-rates`, `PATCH /admin/shipping-rates` | Bearer + `ADMIN_SUPER` or `ADMIN_STAFF` |
| `POST /admin/reconciliation/*`, `GET /admin/reconciliation/*`, `PATCH /admin/reconciliation/*` | Bearer + `ADMIN_SUPER` or `ADMIN_STAFF` |

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

**Email normalization:** the server lowercases and trims the email before storing it. `User@Example.com` and `user@example.com` are treated as the same account. Send any case; the stored value will be lowercase.

**Errors:** `400` validation; `409` if email already registered (including case variants of the same address).

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

After login or verify-email, **`GET /me`** includes **`emailVerified`** (`boolean`) so settings UIs can show verification state without guessing from errors. It also includes **`twoFactor: { enabled, setupPending }`** for security / 2FA settings screens (see **[User profile](#user-profile)**).

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

`localCart` is optional. When present and non-empty, the response includes **`cart`** alongside **`accessToken`**, **`refreshToken`**, and **`expiresIn`** — **unless** the account has **2FA** enabled. In that case the first step returns **`requiresTwoFactor`**, **`preAuthToken`**, etc. (no tokens). Send **`localCart`** on **`POST /auth/login/2fa`** to merge the guest cart after the TOTP step. See **[Two-factor authentication (TOTP)](#two-factor-authentication-totp)**.

**Unverified email:** valid password but email not confirmed → **`403`** with **`code`: `"EMAIL_NOT_VERIFIED"`** (see **[Email verification (frontend integration)](#email-verification-frontend-integration)** — §4).

**Two-step login (2FA):** if the response has **`requiresTwoFactor: true`**, do not store partial tokens. Show an authenticator code field and call **`POST /auth/login/2fa`** with **`preAuthToken`** and **`code`**. See the **Two-factor authentication (TOTP)** subsection under [Authentication (JWT)](#authentication-jwt).

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

Typical JSON includes:

- **`emailVerified`** (`boolean`) — so the UI can show verification state without inferring it from errors.
- **`twoFactor`** — `{ "enabled": <boolean>, "setupPending": <boolean> }`. Use this on a **Settings / Security** screen: show “2FA on”, “Complete setup” (if `setupPending` and not `enabled`), or prompts to enable.

### Two-factor (TOTP) — settings

Authenticator-app 2FA is optional. Full login flow is documented under **[Two-factor authentication (TOTP)](#two-factor-authentication-totp)** in the Authentication section.

| Action | Request | Rate limit |
|--------|---------|------------|
| Status only | `GET /me/2fa` — `{ "enabled", "setupPending" }` | — |
| Start setup (QR + secret) | `POST /me/2fa/setup` — returns **`qrCodeDataUrl`**, **`otpauthUrl`**, **`secret`**, **`issuer`**. Replaces any previous pending setup. | 5 / min |
| Complete setup (turn 2FA on) | `POST /me/2fa/enable` — `{ "code": "123456" }` (code from the app after scanning) | 5 / min |
| Cancel pending setup | `POST /me/2fa/setup/cancel` — clears enrollment if the user did not finish | — |
| Turn 2FA off | `POST /me/2fa/disable` — `{ "password": "...", "code": "..." }` (password + current TOTP). **All refresh sessions are revoked**; user must sign in again on this device. | 5 / min |

All of the above require **Bearer** (user must be logged in), except 2FA is configured **before** it affects login: enable flows run while authenticated; login then requires TOTP for future sessions.

**`otpauthUrl` label format:** the URI uses `issuer:email` as the label (e.g. `otpauth://totp/My%20Store:user@example.com?...`). This is the format required by Google Authenticator and most authenticator apps to display the service name alongside the account. No client-side parsing is needed — just render the `qrCodeDataUrl` as an `<img>` and offer `otpauthUrl` as a deep link for apps that support it.

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

### Currency conversion (`displayCurrency`)

Both `GET /products` and `GET /products/:idOrSlug` accept an optional `?displayCurrency=` query parameter (3-letter ISO 4217 code, e.g. `NGN`, `EUR`, `GBP`). When supplied, the API converts `originalPrice`, `salePrice`, and every `configurationPrices[].originalPrice` / `salePrice` into the target currency using live exchange rates cached hourly. Prices stored in the DB remain USD; the conversion is applied on the response only.

```http
GET /products?displayCurrency=NGN
GET /products/iphone-air-256gb-light-gold?displayCurrency=EUR
```

- If the code is not a valid 3-letter uppercase string, the API returns **`400`**.
- The `currency` field on the response will reflect the converted currency code.
- When conversion fails (rate unavailable), the server falls back to the original USD prices and logs a warning — always guard against unexpected currency values in the UI.
- **Do not send `displayCurrency` in cart or order calls** — those are always stored and transacted in USD. Use conversion only for display.

### Get product (public)

`GET /products/:idOrSlug` — pass either the product **`id`** (UUID) or the human-readable **`slug`** (same value as in JSON responses). Use **`slug`** in storefront URLs for readable paths (e.g. `/products/iphone-air-256gb-light-gold`); cart and orders still use **`productId`** = UUID.

Typical product fields include: `id`, `slug`, `sourceUrl`, `scrapeUrl` (same value as `sourceUrl`, the normalized URL used for scrapes and future periodic rescrapes), `rescrapeEnabled` (default `true`; set `false` to exclude from cron rescrape jobs), `source`, `title`, `description`, `brand`, `originalPrice`, `salePrice`, `currency`, `markupPercent`, `images`, `variants`, `availability`, `stockQuantity` (`null` = unlimited), `lastScrapedAt`, `lastVerifiedAt`, timestamps. **`description`** is assembled from scraper output: e.g. **Apple** may include JSON-LD excerpt, an optional configuration **price range**, and **Configurations:** lines from the matrix; **Amazon** may append a **retailer list price** sentence when the PDP shows a markdown (there is no separate `compareAtPrice` field on the product JSON). **`configurationPrices`** lists per-option supplier prices as `originalPrice` plus your storefront **`salePrice`** (from `markupPercent`). Rows may include **`variantAxis`** (e.g. `Size`, `Color`) and **`optionValue`** so you can match **`variants[].options`** and render retailer-style selectors; optional **`displayLabel`**, **`currency`**, **`available`**, **`metadata`** (store-specific). **Apple** uses metrics SKUs (`partNumber` / `sku`); **GOAT** / **Zara** / **Converse** adapters populate axis + option when the scrape exposes them. **`availability`** is sometimes set to human-readable strings (e.g. Amazon **In stock** / **Out of stock**).

**Frontend layout:** see **`PRODUCT_PAGE_UI_GUIDE.md`**. For a **single PDP implementation** across retailers, follow **[Store-agnostic product details](#store-agnostic-product-details-frontend)** below.

### Store-agnostic product details (frontend)

Use one product detail screen (and cart line logic) that **never assumes** every store fills the same optional fields. Treat **`GET /products/:idOrSlug`** (and the embedded **`product`** on import completion) as a **union**: core fields are always meaningful; everything else is **best-effort** per `source` / scraper.

#### 1. Core vs optional fields

| Always use | Meaning |
|------------|---------|
| `id`, `slug` | Identity; cart and orders use **`productId`** = UUID. |
| `title`, `images[]` | Headline and gallery (may be empty in edge failures — guard UI). |
| `originalPrice`, `salePrice`, `currency` | Storefront line price **before** picking a priced configuration. |
| `source` | Retailer enum (e.g. `amazon`, `apple`, `ebay`, `goat`, `stockx`, `generic`, …). Use for **badges**, analytics, or thin styling — not as the only key for business logic. |

| Use when present | Meaning |
|------------------|---------|
| `variants[]` | `Array<{ name: string; options: string[] }>`. Each **`name`** is an axis label (**`Size`**, **`Color`**, …). **`options`** are the selectable values for that axis. |
| `configurationPrices[]` | Per-option (or per-SKU) **supplier** `originalPrice` plus API-computed **`salePrice`**. Structured rows link options to prices when **`variantAxis`** + **`optionValue`** are set. |
| `description` | Long, unstructured copy (matrix text, legal, retailer notes). Show in body / accordion; do not parse as JSON. |
| `brand`, `availability`, `stockQuantity` | Optional merchandising / stock (`stockQuantity` **`null`** = unlimited / not enforced). |
| `metadata` (on `configurationPrices` rows) | Opaque object for **store-specific** UI (e.g. GOAT `sizeValue`). Safe to ignore if you do not need it. |

#### 2. Rendering variant selectors

1. If **`variants.length === 0`**, show no selectors; use product-level **`salePrice`** only.
2. For each **`variants[i]`**, render one control (dropdown, swatch row, etc.):
   - **Label** = **`variants[i].name`** (this string is the **key** in **`variantSelection`** for cart APIs).
   - **Values** = **`variants[i].options`**.
3. **Cart / sync:** `POST /cart/items` and **`localCart`** use **`variantSelection`** shaped like `{ [axisName]: chosenOption }`, e.g. `{ "Size": "10", "Color": "Black" }`. Keys **must match** `variants[].name` exactly for that product.

#### 3. Resolving price for the current selection (`configurationPrices`)

Many retailers expose **different prices per size or color**; others only expose a single PDP price.

**Recommended algorithm:**

1. Build the current map **`selection`**: `{ [variants[j].name]: chosenOption }` from user input (omit axes not yet chosen if you use a stepped UI).
2. If **`configurationPrices`** is empty → use product **`salePrice`** (and **`originalPrice`** if you show strike/compare).
3. Otherwise, find rows where **`variantAxis`** and **`optionValue`** are set:
   - **Single-axis products (e.g. GOAT sizes):** pick the row with **`variantAxis`** matching the size axis and **`optionValue`** equal to the selected size string.
   - **Multi-axis products:** if the API only provides one row per combination, match on **all** axes you have rows for; if rows only tag one axis (e.g. Zara **Color** with flat price), match that axis and use the row’s prices for the whole line.
4. If no row matches but **`configurationPrices.length > 0`** → fall back to product-level **`salePrice`** (or the cheapest **`salePrice`** among rows if you prefer a “from” display — product policy choice).
5. For display copy, prefer **`displayLabel`** when present; otherwise format from **`optionValue`** + **`salePrice`** / **`originalPrice`**.
6. If **`available === false`** on the matched row, disable the add-to-cart control or show OOS for that combination.

**`configurationPrices` row shape (API):**

```json
{
  "label": "Size 10",
  "originalPrice": "425.00",
  "salePrice": "467.50",
  "variantAxis": "Size",
  "optionValue": "10",
  "currency": "USD",
  "available": true,
  "displayLabel": "10 — from USD 425.00",
  "partNumber": "optional-apple-sku",
  "sku": "optional",
  "metadata": { "source": "goat", "sizeValue": 10 }
}
```

Not every row includes every field; **`partNumber` / `sku`** are typical for **Apple**-style matrices.

#### 4. Store differences without forking the whole page

- **Prefer** `variants` + `configurationPrices` + **`variantAxis` / `optionValue`** for behavior; use **`source`** only for cosmetic or analytics branches.
- Put retailer-specific extras in **`metadata`** on configuration rows (or future extensions) instead of hard-coding URLs to `source` in dozens of places.
- **`description`** will **differ wildly** in length and format — always treat as **rich text / pre-wrap** content, not a fixed template.

#### 5. Product cards (list view)

**`GET /products`** returns the same object shape. For cards, use **`title`**, first **`images[0]`**, **`salePrice`**, **`currency`**, optional **`availability`**. Avoid relying on **`variants`** on list unless you show a “from” badge; detail view is the place for full option/price resolution.

### List recent products (public)

`GET /products` — no auth. Returns the newest products first (same object shape as **`GET /products/:idOrSlug`**).

**Query:** `limit` (optional, integer) — default **24**, maximum **100** (values below 1 are treated as 1).

**Admin:** For a longer internal list (up to **500** rows), use **`GET /admin/products`** with Bearer + admin role.

---

## Shipping & Landed Cost

Two endpoints cover pricing before checkout. Use **`POST /landed-cost/quote`** for all normal checkout flows — it returns the complete price breakdown the user sees before they pay. Use **`POST /shipping/quote`** only when you need a standalone Kingz-only quote (e.g. an admin freight calculator).

### Landed cost quote (public) — use this for checkout

`POST /landed-cost/quote` — no auth required. Returns an itemised breakdown of every cost component: marketplace tax, domestic shipping (marketplace → warehouse), warehouse handling, Kingz international shipping (warehouse → customer), Nigeria customs, FX and risk buffers, and your service charge.

**Mode A — by product ID (price fetched from DB):**

```json
{
  "productId": "550e8400-e29b-41d4-a716-446655440000",
  "quantity": 1,
  "destination": "lagos",
  "shippingService": "air",
  "category": "sneakers",
  "displayCurrency": "NGN"
}
```

**Mode B — raw inputs:**

```json
{
  "productPriceUsd": 220.00,
  "marketplace": "stockx",
  "category": "sneakers",
  "quantity": 1,
  "destination": "lagos",
  "shippingService": "air",
  "displayCurrency": "NGN"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `productId` | Mode A | UUID of an already-imported product. Overrides `productPriceUsd` and `marketplace`. |
| `productPriceUsd` | Mode B | Product price in USD. Required when `productId` is omitted. |
| `marketplace` | Mode B | Source marketplace enum (see below). Required when `productId` is omitted. |
| `category` | No | Product category for weight + customs estimation. Defaults to `"generic"`. |
| `quantity` | Yes | Number of units (min 1). |
| `weightLbs` | No | Known actual weight in lbs. Overrides the category default. |
| `dimensions` | No | `{ "lengthIn", "widthIn", "heightIn" }` — overrides the category default. |
| `destination` | Yes | `"lagos"` or `"outside_lagos"` |
| `shippingService` | Yes | `"air"` or `"ocean_small"` |
| `displayCurrency` | No | ISO 4217 code (e.g. `"NGN"`, `"GBP"`). Converts `totalDisplay`. Defaults to `"USD"`. |

**`category` values:** `sneakers` · `clothing` · `phone` · `laptop` · `tablet` · `tv` · `electronics_small` · `electronics_large` · `accessories` · `books` · `generic`

**`marketplace` values:** `amazon` · `apple` · `nike` · `converse` · `zara` · `stockx` · `goat` · `ebay` · `shein` · `jumia` · `generic`

**Response:**

```json
{
  "marketplace": "stockx",
  "category": "sneakers",
  "quantity": 1,
  "estimatedWeightLbs": 2.5,
  "marketplaceConfidence": "high",

  "productSubtotalUsd": 220.00,
  "marketplaceTaxUsd": 0.00,
  "marketplaceShippingUsd": 13.95,
  "domesticHandlingUsd": 10.00,
  "internationalShippingUsd": 75.00,

  "customsDutyUsd": 63.79,
  "customsVatUsd": 27.81,
  "customsClearingFeeUsd": 25.00,

  "fxBufferUsd": 10.89,
  "riskBufferUsd": 26.13,

  "serviceChargeUsd": 44.00,
  "discountUsd": 0.00,

  "totalUsd": 516.57,
  "displayCurrency": "NGN",
  "totalDisplay": 803407.65,

  "breakdown": [
    "Product subtotal: $220.00",
    "Domestic (marketplace → warehouse): $13.95",
    "Warehouse handling: $10.00",
    "International shipping (Kingz):",
    "  2.50 billable lbs × $5.00/lb = $12.50",
    "  ...",
    "Nigeria customs duty: $63.79",
    "Nigeria VAT: $27.81",
    "Customs clearing fee: $25.00",
    "FX buffer (2.5%): $10.89",
    "Risk buffer (6%): $26.13",
    "Service charge (20%): $44.00",
    "─────────────────────────────",
    "Estimated total (USD): $516.57",
    "Estimated total (NGN): 803407.65"
  ]
}
```

**Field meanings:**

| Field | What it covers |
|-------|----------------|
| `marketplaceTaxUsd` | Estimated US sales tax at the source marketplace. `0` for marketplaces that ship to our Delaware warehouse (no sales tax state) or handle tax separately (StockX, GOAT). |
| `marketplaceShippingUsd` | Shipping cost from the source marketplace/seller **to our warehouse** (e.g. $13.95 for StockX, $0 for Nike/Apple free shipping). |
| `domesticHandlingUsd` | Our warehouse receiving and processing fee ($10 flat per order). |
| `internationalShippingUsd` | Kingz International Logistics: **our warehouse → customer** in Nigeria. Calculated using Kingz rates from the DB, dimensional weight, and the category's estimated package size. |
| `customsDutyUsd` | Nigeria import duty on CIF value (product + tax + domestic shipping + warehouse handling + Kingz). Rates: 5% electronics, 20% clothing/sneakers/TV, 15% accessories, 0% books. |
| `customsVatUsd` | Nigeria VAT (7.5%) on (CIF + duty). |
| `customsClearingFeeUsd` | Flat customs agent fee per category ($20–$80). |
| `fxBufferUsd` | 2.5% buffer on total cost to absorb exchange-rate movement between quote and purchase. |
| `riskBufferUsd` | 6% operational buffer covering seller price changes, cart expiry, and carrier fluctuations. |
| `serviceChargeUsd` | Our 20% service charge on the product subtotal. |
| `discountUsd` | 20% loyalty discount when `productSubtotalUsd > $1000`. Subtracted from total. |
| `marketplaceConfidence` | How reliable the tax + domestic-shipping estimate is: `high` (we have hard data), `medium` (approximated), `low` (generic fallback). Show a disclaimer in the UI when `low`. |

**UI guidance:**

- Show the `breakdown` array line-by-line on an "Estimated cost" accordion or modal before the user places the order.
- Label `totalDisplay` in the user's preferred currency. Always label it "Estimated total" — confirmed totals come from the order after checkout.
- When `marketplaceConfidence` is `"low"`, add a note: "Marketplace estimates are approximate. Final cost may vary slightly."
- The `landedCost` object you send to `POST /orders` must use the **same** `destination`, `shippingService`, and `category` values shown in this quote.

---

### Kingz-only shipping quote (public)

`POST /shipping/quote` — no auth required. Use for a standalone freight estimate (e.g. admin freight calculator, or when you already know the exact package weight). **Does not include** marketplace tax, customs, or service charge — use `POST /landed-cost/quote` for the full buyer-facing price.

```json
{
  "weight": 2.5,
  "length": 12,
  "width": 8,
  "height": 6,
  "destination": "lagos",
  "service": "air",
  "bulkCommercial": false,
  "isTV": false
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `weight` | Yes | Actual weight in **lbs** (min 0.1) |
| `length`, `width`, `height` | No | Dimensions in **inches** for dimensional weight; omit if unknown |
| `destination` | Yes | `"lagos"` or `"outside_lagos"` |
| `service` | Yes | `"air"` or `"ocean_small"` |
| `bulkCommercial` | No | Adds a bulk/commercial surcharge |
| `isTV` | No | Adds a TV clearing fee |

**Response:**

```json
{
  "actualWeight": 2.5,
  "dimWeight": 3.47,
  "billableWeight": 3.47,
  "baseRate": 17.35,
  "tvFee": 0,
  "bulkSurcharge": 0,
  "total": 17.35,
  "breakdown": [
    "3.47 billable lbs × $5.00/lb = $17.35",
    "Dimensional weight used: (12×8×6) / 166 = 3.47 lbs > actual 2.5 lbs",
    "Total: $17.35"
  ]
}
```

---

## Saves

All routes require Bearer. Saves are a per-user wishlist of products.

### List saved products

`GET /saves`

Returns all of the current user's saved products, newest first. Each entry includes the full nested `product` object (same shape as `GET /products/:idOrSlug`).

### Save a product

`POST /saves/:productId`

- `:productId` — UUID of the product to save.
- Returns the new save record with nested `product`.
- Returns **`409`** if the product is already saved.

### Unsave a product

`DELETE /saves/:productId`

- Returns **`404`** if the product is not in the user's saves.

### Check save status

`GET /saves/:productId/status`

```json
{ "saved": true }
```

Use this to drive a heart / bookmark toggle on product cards or detail pages without fetching the full saves list.

---

## User reconciliation

Bearer required. These routes let a logged-in buyer open a support ticket and view their own issue history.

### Submit an issue (recommended for most cases)

`POST /reconciliation/issues`

Use this to create any type of support ticket: refund requests, item not received, wrong item, billing errors, or other questions.

```json
{
  "orderId": "optional-uuid-of-related-order",
  "type": "REFUND_REQUEST",
  "subject": "Never received my order",
  "description": "I placed order #1234 two weeks ago and tracking shows it was delivered but I never received it."
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `orderId` | No | UUID of the related order (omit for account-level issues) |
| `type` | Yes | Issue type enum (see below) |
| `subject` | Yes | Short title (max 256 chars) |
| `description` | Yes | Full details (max 4096 chars) |

**Issue types:**
- `PAYMENT_DISPUTE` — Chargeback or payment query
- `REFUND_REQUEST` — Requesting money back
- `ITEM_NOT_RECEIVED` — Tracking shows delivered but customer didn't receive
- `WRONG_ITEM` — Received different product than ordered
- `DAMAGED_ITEM` — Item arrived damaged
- `BILLING_ERROR` — Wrong price or duplicate charge
- `OTHER` — Any other issue

**Response:** the created issue object with `id`, `status: "OPEN"`, `type`, timestamps, etc.

**Status lifecycle:** Issues start as `OPEN` ("Pending"). Admins can move them to `IN_PROGRESS` ("Working"), `AWAITING_CUSTOMER`, `RESOLVED`, or `CLOSED`.

---

### Request a price dispute (specialized)

`POST /reconciliation/price-disputes`

Use **only** when a buyer believes the charged amount was incorrect (e.g. wrong variant price was applied). For general support tickets, **prefer `POST /reconciliation/issues`** above.

```json
{
  "orderId": "uuid",
  "expectedTotal": 299.99,
  "reason": "I selected the 256 GB model but was charged the 512 GB price."
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `orderId` | Yes | UUID of the order to dispute |
| `expectedTotal` | No | Amount the customer expected to pay |
| `reason` | No | Customer context (max 2048 chars) |

**Response:** the created issue object (`id`, `status: "OPEN"`, `type: "PAYMENT_DISPUTE"`, timestamps, etc.).

### List my issues

`GET /reconciliation/my-issues`

Optional query params: `?status=OPEN`, `?orderId=<uuid>`, `?limit=20` (max 100), `?offset=0`.

**Response:** paginated array of the user's own issue tickets.

### Get one of my issues

`GET /reconciliation/my-issues/:id`

Returns **`404`** if the issue does not belong to the requesting user.

---

## Cart

All routes require Bearer.

### Get cart

`GET /cart`

Response includes server-computed pricing fields:

- `subtotal`
- `serviceCharge` (20% of subtotal)
- `discount` (20% of subtotal when subtotal > `1000`; `"0.00"` otherwise)
- `fees` (`serviceCharge` — the discount is **not** subtracted from `fees`; it is subtracted in `total`)
- `total` (`subtotal + fees - discount`)
- `currency`

> **Cart vs order pricing:** The cart total is a **simplified preview** (subtotal + service charge − discount). The **order total** is the full landed cost — it adds marketplace tax, domestic shipping, warehouse handling, Kingz international shipping, customs, and buffers on top. Always show `POST /landed-cost/quote` to the user before they check out so they see the real number before committing.

Plus `id` and `items[]` with `id`, `quantity`, `variantSelection`, and nested `product` (or minimal `{ id }` if relation missing).

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
  },
  "landedCost": {
    "destination": "lagos",
    "shippingService": "air",
    "category": "sneakers"
  }
}
```

Omit `shippingAddress` only if the user profile has `defaultShippingAddress` set. **`landedCost` is required.**

**`landedCost` fields:**

| Field | Required | Notes |
|-------|----------|-------|
| `destination` | Yes | `"lagos"` or `"outside_lagos"` |
| `shippingService` | Yes | `"air"` or `"ocean_small"` |
| `category` | No | Product category for weight + customs estimation. Defaults to `"generic"`. Use the same value you passed to `POST /landed-cost/quote`. |

**Use `POST /landed-cost/quote` before this call** to show the user an itemised cost breakdown and confirm their `destination`, `shippingService`, and `category` choices before they commit.

**Behavior:** re-scrapes each cart line to refresh price, runs the full landed cost calculation (marketplace tax, domestic shipping, Kingz international shipping, customs, buffers, service charge), checks **stock** when `stockQuantity` is set on products, creates the order as `PENDING`, snapshots line items, clears the cart, and may enqueue a confirmation email.

### List my orders

`GET /orders`

**Optional filter:** `GET /orders?status=PENDING` — returns only orders in that state (e.g. all **unpaid** orders). `status` must be a full enum value: `PENDING`, `PAID`, `PROCESSING`, `ORDERED_FROM_SUPPLIER`, `SHIPPED`, `DELIVERED`, `CANCELLED`, `REFUNDED`, `DISPUTED`. Invalid values return **400**.

### Pending payment (single order for the “stuck” checkout UX)

`GET /orders/pending-payment`

**Bearer required.** Returns the user’s **most recent** `PENDING` order in the same shape as **`GET /orders/:id`**, or **`{ "order": null }`** if there is none.

Use this to drive a **global or cart banner** after payment fails (cart is already empty but money was never taken). Example: on app or cart load, if `order` is non-null, show **“You have an unpaid order — pay now”** and navigate to your payment step with `order.id` (or link to an order page that reads `checkout.nextStep`).

This avoids scanning **`GET /orders`** on the client, though filtering with **`?status=PENDING`** is still available if you need the full list.

### Get one order

`GET /orders/:id`

**Order response highlights:**

- `status` — `PENDING` | `PAID` | `PROCESSING` | `ORDERED_FROM_SUPPLIER` | `SHIPPED` | `DELIVERED` | `CANCELLED` | `REFUNDED` | `DISPUTED`
- **`displaySummary`** — pre-computed 3-line breakdown for the order summary screen. **Use this for the main UI — do not compute totals yourself from individual fields.**

```json
{
  "displaySummary": {
    "product": "254.02",
    "importAndDelivery": "81.10",
    "serviceFee": "25.40",
    "discount": "0.00",
    "total": "360.52",
    "currency": "USD"
  }
}
```

`importAndDelivery` bundles: marketplace tax + marketplace shipping + warehouse handling + international cargo + customs & duties + FX buffer + risk buffer. Show it as a single line. Offer a "View breakdown" toggle that reveals `pricingBreakdown[]` for users who want the detail.

- **Granular pricing fields** — all decimal strings in `currency` (USD). Only needed for the breakdown drawer or admin views:

| Field | What it is |
|-------|-----------|
| `subtotal` | Product price × quantity (sum across all cart lines) |
| `marketplaceTax` | Estimated tax at the source marketplace checkout |
| `marketplaceShipping` | Estimated shipping from the marketplace/seller to our warehouse |
| `domesticHandling` | Warehouse receiving fee ($8 flat) |
| `shippingFee` | Cargo estimate: warehouse → customer (weight-band rate) |
| `customsTotal` | Nigeria import duties + clearing (combined rate on product subtotal) |
| `fxBuffer` | 2.5% exchange-rate cushion on product subtotal |
| `riskBuffer` | 4% operational risk buffer on product subtotal |
| `fees` / `serviceCharge` | 10% service charge on `subtotal` |
| `discount` | 20% loyalty discount when `subtotal > $1000` (else `"0.00"`) |
| `total` | Grand total |

- `pricingBreakdown` — array of human-readable strings. Render line-by-line in a "View breakdown" accordion/drawer.
- `checkout` — **machine-readable next action** (on every order response):
  - `canInitializePayment` — `true` when `status === "PENDING"` (user may call **`POST /payments/initialize`**)
  - `nextStep` — `initialize_payment` when unpaid, or `none` when not awaiting payment. Use to show a **Pay / Complete checkout** CTA and route to a payment page that uses **`id`**.
- `items[]` — snapshots: `title`, `price`, `currency`, `quantity`, `images`, `variant`, etc.
- `payment` — tracks the selected provider and checkout/session ids (even while the order is still `PENDING` and after **`POST /payments/initialize`**):
  - `provider` — `paystack` | `stripe` | `paypal` | `myaza` (when set)
  - `methodDetails` — provider-specific snapshot; always look for:
    - **`checkoutId`** — unified id for the active payment attempt (Paystack reference, Stripe Checkout session id, PayPal order id, or Myaza session/payment id). Use this to correlate UI, support, and webhooks with **`order.id`**.
    - **`checkoutProvider`** — same as `provider` when checkout metadata was stored
  - `paystackReference`, `stripeCheckoutSessionId`, `stripePaymentIntentId` as applicable
  - After **payment completes**, `methodDetails` may also include card/last4/PayPal/crypto fields depending on provider (see Swagger / server types).
- `tracking[]` — append-only shipment event log. Each entry:
  - `id` — UUID
  - `carrier` — string or `null` (nullable; a status-only update need not change the carrier)
  - `trackingNumber` — string or `null` (nullable for same reason)
  - `status` — lifecycle label string: `UPDATED` | `IN_TRANSIT` | `OUT_FOR_DELIVERY` | `DELIVERED` | `EXCEPTION` (custom values possible)
  - `message` — optional human-readable note for the customer (e.g. `"Arrived at local hub"`) or `null`
  - `createdAt` — ISO timestamp of when this event was recorded (the column was historically called `updatedAt` in older API versions — use `createdAt`)

**Retrying payment (no extra endpoint):** The same **`GET /orders/:id`** response is enough to **display** the order and to **call `POST /payments/initialize` again** while the order is unpaid.

| Need | Source on `GET /orders/:id` |
|------|-----------------------------|
| `orderId` for `POST /payments/initialize` | **`id`** |
| Show “Pay now” CTA? | **`checkout.canInitializePayment`** or **`checkout.nextStep === "initialize_payment"`** (same as `status === "PENDING"`) |
| Is payment allowed? | **`status === "PENDING"`** — otherwise do not call `initialize` (show a read-only or appropriate state) |
| Order summary UI (3-line totals) | **`displaySummary`** — `product`, `importAndDelivery`, `serviceFee`, `discount`, `total`, `currency` |
| Breakdown drawer / accordion | **`pricingBreakdown[]`** — render each string as one line |
| Line items | **`items[]`**, **`shippingAddress`** |
| Which providers the server will accept right now | **`GET /payments/methods`** — only show `available: true` |
| Pre-select last chosen provider (optional) | **`payment.provider`** if set (see below) |
| Correlation / deep links after a *successful* `initialize` | **`payment.methodDetails.checkoutId`**, `paystackReference`, `stripeCheckoutSessionId`, etc. |

**If `POST /payments/initialize` failed** (HTTP 4xx, network, etc.): the order row may not have been updated yet, so **`payment.provider` can still be `null`**. The user should pick a provider again from **`GET /payments/methods`**, then call **`initialize`** with the same body shape as a first attempt (`orderId: <order.id>`, `provider`, plus optional return URLs for Stripe/PayPal/Myaza). You may call **`initialize` multiple times** for the same pending order; the latest successful response updates **`payment`**.

**Cart vs order:** `POST /orders` **deletes all cart line items** when the order is created. The cart will look **empty** even though checkout is not finished. After order creation, treat checkout as **order-based**: use the **`POST /orders` response** or **`GET /orders/:id`**, not **`GET /cart`**, for step 2 (payment) UI.

**Suggested client behavior when the user is “stuck” after a failed `initialize`:**

1. **Persist `orderId`** when `POST /orders` succeeds (React state + **`sessionStorage`**, e.g. `pendingCheckoutOrderId`) until **`GET /orders/:id`** returns **`status: "PAID"`** (then clear it).
2. **Payment step UI** should load **`GET /orders/:id`** (or use the in-memory create response) for line items and totals—**not** the cart.
3. **On `initialize` error**, show the message and a primary action: **“Retry payment”** (same `orderId` + provider) and/or **“View order”** (navigate to a route that loads **`GET /orders/:id`**).
4. **Empty cart or home:** on load, call **`GET /orders/pending-payment`**. If **`order` is not null** (or if **`order.checkout.nextStep === "initialize_payment"`** on any screen), show a prominent **“Complete payment”** that routes to a payment or order page for **`order.id`**. To list all unpaid orders, use **`GET /orders?status=PENDING`**. Optionally combine with **`sessionStorage`** for the last in-progress `orderId` after refresh.
5. **Do not** send users who failed payment back to a cart-only step without explaining that the cart was already converted; link them to **orders** or in-app “complete payment” instead.

---

## Payments

Bearer required for initialization only.

### Available methods

`GET /payments/methods`

Use this before rendering checkout payment options. Response includes all known providers and whether each is currently available.

```json
{
  "methods": [
    { "provider": "paystack", "available": true, "reason": null },
    { "provider": "stripe", "available": false, "reason": "temporarily_disabled" },
    { "provider": "paypal", "available": true, "reason": null },
    { "provider": "myaza", "available": false, "reason": "not_configured" }
  ],
  "updatedAt": "2026-04-15T12:34:56.000Z"
}
```

`reason` values:
- `not_configured` — provider keys/settings are missing on server
- `temporarily_disabled` — provider was manually disabled by ops/env flag

Frontend should only show methods where `available === true`.

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

or

```json
{
  "orderId": "uuid",
  "provider": "paypal",
  "paypalReturnUrl": "https://app.example/checkout/paypal/success",
  "paypalCancelUrl": "https://app.example/checkout/paypal/cancel"
}
```

or

```json
{
  "orderId": "uuid",
  "provider": "myaza",
  "myazaReturnUrl": "https://app.example/checkout/myaza/success",
  "myazaCancelUrl": "https://app.example/checkout/myaza/cancel"
}
```

**`provider` values:** `paystack` | `stripe` | `paypal` | `myaza` (lowercase strings).

**Order record after `initialize`:** On success, the API updates the **order** row with the chosen provider, the provider-specific reference (e.g. Paystack reference, Stripe session id), and **`payment.methodDetails.checkoutId`** + **`checkoutProvider`** so the full cart checkout is always traceable to one payment id before the user finishes paying. Refetch **`GET /orders/:id`** if you need the latest ids for UI state or deep links.

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

**PayPal initialize response:**

```json
{
  "provider": "paypal",
  "paypalOrderId": "2GG279541U471931P",
  "approvalUrl": "https://www.paypal.com/checkoutnow?token=2GG279541U471931P"
}
```

Redirect to `approvalUrl`. After buyer approval, call:

`POST /payments/paypal/capture`

```json
{
  "orderId": "uuid",
  "paypalOrderId": "2GG279541U471931P"
}
```

On success the API captures PayPal payment and marks order status as `PAID`.

**Server env (PayPal):** the backend first calls PayPal’s **`/v1/oauth2/token`**. A **401** there means the Client ID / secret pair is wrong, or the **mode** does not match: use **`PAYPAL_MODE=sandbox`** (or omit) with **Sandbox** app credentials, or **`PAYPAL_MODE=live`** (also **`production`** / **`prod`**) with **Live** app credentials. Set **`PAYPAL_SECRET_KEY`** or **`PAYPAL_CLIENT_SECRET`** (same value PayPal shows as the secret). Sandbox and live keys are not interchangeable.

**Myaza initialize response:**

```json
{
  "provider": "myaza",
  "paymentId": "sess_123",
  "sessionId": "sess_123",
  "checkoutUrl": "https://checkout.myaza.io/...",
  "depositAddress": "0x1A2B3C4D5E6F...",
  "qrCode": "data:image/png;base64,...",
  "chain": "polygon",
  "token": "USDC",
  "amount": "100.00",
  "status": "pending",
  "expiresAt": "2026-04-15T12:45:00.000Z"
}
```

**Server env (unified-commerce → Myaza):** `MYAZA_API_KEY` is always the credential. By default the backend sends it as **`X-API-Key`**. If your Myaza instance returns **401** and a message like **“No auth token”**, set **`MYAZA_AUTH_MODE=bearer`** so the same value is sent as `Authorization: Bearer` + the API key. That is separate from the JSON body field `token` (e.g. USDC), which comes from **`MYAZA_TOKEN`**.

Render `depositAddress` / `qrCode` for wallet transfer UX (and optionally open `checkoutUrl` if present). Myaza should call `POST /payments/webhooks/myaza` after on-chain confirmation (e.g. `status: "delivered"`); then order status becomes `PAID`. Frontend should poll `GET /orders/:id` while waiting.

**Frontend keys:** You may use **Paystack public key** or **Stripe publishable key** only if you build a custom client-side flow. This API’s default flows are **redirect-based** (Paystack URL / Stripe Checkout URL) after `initialize`.

### Payment confirmation flow

After `POST /payments/initialize` succeeds, the browser leaves your app to complete payment on the provider’s page. What happens next differs by provider — but in every case the final signal you should react to is the **`order.updated` Socket.IO event** (or a poll of `GET /orders/:id` as a fallback).

#### 1. Connect the socket before redirecting

Connect the socket **before** you redirect the user so you don’t miss the confirmation event while they’re away:

```ts
import { io, Socket } from ‘socket.io-client’;

let socket: Socket | null = null;

function connectPaymentSocket(accessToken: string, orderId: string, onPaid: () => void) {
  socket = io(`${API_BASE_URL}/realtime`, {
    path: ‘/socket.io’,
    auth: { token: accessToken },
  });

  socket.on(‘connect’, () => {
    console.log(‘[socket] connected, watching order’, orderId);
  });

  socket.on(‘order.updated’, (payload: { orderId: string; status: string }) => {
    if (payload.orderId === orderId && payload.status === ‘PAID’) {
      onPaid();
      socket?.disconnect();
    }
  });

  socket.on(‘connect_error’, (err) => {
    console.warn(‘[socket] connection error — falling back to poll’, err.message);
  });
}
```

The socket joins your `user:<userId>` room automatically when the JWT is valid. You do **not** need to emit anything for orders — events are pushed by the server.

#### 2. Stripe

```
POST /payments/initialize  →  response.url (Stripe Checkout URL)
     ↓
Redirect browser to Stripe Checkout
     ↓
User pays on Stripe’s page
     ↓
Stripe sends checkout.session.completed to POST /payments/webhooks/stripe  (server-to-server)
     ↓
Server marks order PAID and emits order.updated via Socket.IO
     ↓
Frontend receives order.updated { orderId, status: "PAID" }
```

**Success URL** (`stripeSuccessUrl`) must contain `{CHECKOUT_SESSION_ID}` — Stripe replaces it on redirect:

```
https://app.example/checkout/success?session_id={CHECKOUT_SESSION_ID}
```

On your success page, the socket event is the primary signal. If the socket is not yet connected (e.g. the user was away too long and the token expired), poll:

```ts
async function pollUntilPaid(orderId: string, accessToken: string, maxAttempts = 12) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000)); // wait 3 s between polls
    const res = await fetch(`${API_BASE_URL}/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const order = await res.json();
    if (order.status === ‘PAID’) return order;
  }
  throw new Error(‘Payment not confirmed after polling — ask user to refresh’);
}
```

#### 3. PayPal

PayPal uses a **redirect-and-capture** pattern — the server does not receive a webhook for the initial approval. Your frontend **must** call capture.

```
POST /payments/initialize  →  response.approvalUrl
     ↓
Redirect browser to PayPal approval page
     ↓
User approves on PayPal
     ↓
PayPal redirects to PAYPAL_RETURN_URL
  e.g. https://app.example/checkout/paypal/success?token=<paypalOrderId>&PayerID=<id>
     ↓
Frontend reads ?token= from query string (this is paypalOrderId)
     ↓
POST /payments/paypal/capture  { orderId, paypalOrderId }
     ↓
Server captures the PayPal order, marks order PAID, emits order.updated
     ↓
Frontend receives order.updated { orderId, status: "PAID" }  (or check capture response)
```

**Your PayPal return page** should:

```ts
// /checkout/paypal/success
const params = new URLSearchParams(window.location.search);
const paypalOrderId = params.get(‘token’); // PayPal always puts the order id in ?token=
const orderId = localStorage.getItem(‘pendingOrderId’); // saved before redirect

if (!paypalOrderId || !orderId) {
  showError(‘Missing PayPal confirmation. Please check your orders.’);
  return;
}

const res = await fetch(`${API_BASE_URL}/payments/paypal/capture`, {
  method: ‘POST’,
  headers: {
    ‘Content-Type’: ‘application/json’,
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({ orderId, paypalOrderId }),
});

if (!res.ok) {
  showError(‘Capture failed — your payment may already be confirmed. Check your orders.’);
  return;
}

const result = await res.json(); // { orderId, paypalOrderId, paypalCaptureId, status: "PAID" }
showSuccess(result);
```

**PayPal cancel URL** — set `paypalCancelUrl` to a page that shows a "Payment cancelled — go back to checkout" screen and surfaces the same `orderId` for retry via `POST /payments/initialize` again (same `orderId`, order stays `PENDING`).

#### 4. Myaza (crypto)

```
POST /payments/initialize  →  response.depositAddress + response.qrCode + response.checkoutUrl
     ↓
Show QR code and deposit address for wallet transfer
     ↓
User sends crypto on-chain
     ↓
Myaza detects on-chain confirmation and calls POST /payments/webhooks/myaza  (server-to-server)
     ↓
Server marks order PAID and emits order.updated via Socket.IO
```

Keep the socket open while the QR screen is visible. Also show an `expiresAt` countdown — if the session expires before payment, the user needs to re-initialize. Poll `GET /orders/:id` every 10 s as a fallback since on-chain confirmation can take minutes.

#### 5. Order status reference

| `status`    | Meaning                                          | Next action                              |
|-------------|--------------------------------------------------|------------------------------------------|
| `PENDING`   | Order created, payment not started or failed     | Show payment options, allow retry        |
| `PAID`      | Payment confirmed by provider webhook / capture  | Show confirmation screen                 |
| `PROCESSING`| Ops team is fulfilling the order                 | Show tracking info when available        |
| `SHIPPED`   | Handed to carrier                                | Show `trackingNumber` + `carrier`        |
| `DELIVERED` | Marked delivered                                 | Prompt review / reconciliation           |
| `REFUNDED`  | Full refund issued                               | Show refund note                         |
| `DISPUTED`  | Chargeback / dispute opened                      | Contact support                          |

#### 6. Retry / failure handling

If `POST /payments/initialize` returns an error, or if the user cancels on the provider page:
- The order stays `PENDING` — no new order needed
- Show a retry button that calls `POST /payments/initialize` again with the **same `orderId`**
- Offer a way to get back to this screen from the order list (`GET /orders` or `GET /orders/pending-payment`)

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
  "trackingStatus": "IN_TRANSIT",
  "trackingMessage": "Arrived at local hub"
}
```

All fields optional. When `carrier` and `trackingNumber` are both sent **and at least one differs from the previous value**, a tracking event row is appended and an email + real-time notification may be sent. `trackingMessage` (max 512 chars) is the human-readable note shown to the customer on that event; omit it for a silent status change.

### List products (admin)

`GET /admin/products`

### Shipping rates (admin)

`GET /admin/shipping-rates` — returns the active Kingz International Logistics rate row from the database (or `null` if the defaults are still in use).

`PATCH /admin/shipping-rates` — update one or more rate fields. All fields are optional; only supplied fields are changed.

```json
{
  "airRateLagosPerLb": 5.5,
  "airRateOutsideLagosPerLb": 6.5,
  "airMinimumLagos": 80,
  "airMinimumOutsideLagos": 110,
  "minWeightLbs": 15,
  "bulkCommercialSurcharge": 110,
  "tvClearingFee": 320,
  "oceanSmallBoxRate": 105,
  "dimDivisor": 166
}
```

Rate changes take effect immediately for new `POST /shipping/quote` calls and new orders.

### Scrape preview (debug only)

`POST /admin/scrape-preview`

```json
{ "url": "https://..." }
```

Runs **Playwright in the HTTP request** (no import row, no queue). Returns `{ url, detectedSource, scraped }` in **`ScrapedProduct`** shape. **Throttled** (e.g. 5/min). **Does not update the catalog:** there is no `products` row write. Use **`POST /products/import`** (queued worker) so results are saved and **`GET /products/:idOrSlug`** reflects adapter changes after you deploy new scraper code. See **`docs/SCRAPER_ARCHITECTURE.md`** for the scrape stack overview.

---

## Reconciliation (admin only)

Bearer + role `ADMIN_STAFF` or `ADMIN_SUPER`. All routes are under `/admin/reconciliation`.

Reconciliation covers **refunds** (triggering provider refund APIs) and **customer issues** (support tickets). Both are append-only audit trails — nothing is deleted.

### Refunds

#### Create refund — `POST /admin/reconciliation/refunds`

```json
{
  "orderId": "uuid",
  "amount": "49.99",
  "reason": "Customer received wrong item",
  "internalNote": "Verified via CS ticket #123",
  "initiatedBy": "admin-user-uuid"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `orderId` | Yes | UUID of the order to refund |
| `amount` | Yes | Decimal string (e.g. `"49.99"`) — must not exceed order total |
| `reason` | No | Customer-visible reason (max 512 chars) |
| `internalNote` | No | Staff-only note (max 1024 chars) |
| `initiatedBy` | No | Admin user UUID for audit trail |

**Response:** the created refund object. `status` starts as `PENDING`, transitions to `PROCESSING` → `SUCCEEDED` or `FAILED` as the provider responds. `MANUAL_REQUIRED` means the payment provider (e.g. crypto/Myaza) has no refund API — handle manually.

**Refund status values:** `PENDING` | `PROCESSING` | `SUCCEEDED` | `FAILED` | `MANUAL_REQUIRED`

When a full refund succeeds the order `status` is automatically updated to `REFUNDED`.

#### List refunds — `GET /admin/reconciliation/refunds`

Returns all refund records newest-first. Optional query: `?orderId=<uuid>` to filter by order.

#### Get refund — `GET /admin/reconciliation/refunds/:id`

---

### Customer issues

#### Create issue — `POST /admin/reconciliation/issues`

```json
{
  "userId": "uuid",
  "orderId": "uuid",
  "type": "REFUND_REQUEST",
  "priority": "HIGH",
  "subject": "Item not received after 3 weeks",
  "description": "Customer reports DHL tracking shows delivered but parcel never arrived.",
  "internalNote": "Opened by CS agent Jane",
  "assignedTo": "admin-user-uuid"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `userId` | Yes | UUID of the affected customer |
| `orderId` | No | Linked order UUID (nullable — some issues are account-level) |
| `type` | No | `PAYMENT_DISPUTE` \| `REFUND_REQUEST` \| `ITEM_NOT_RECEIVED` \| `WRONG_ITEM` \| `DAMAGED_ITEM` \| `BILLING_ERROR` \| `OTHER` (default `OTHER`) |
| `priority` | No | `LOW` \| `MEDIUM` \| `HIGH` \| `CRITICAL` (default `MEDIUM`) |
| `subject` | Yes | Short title (max 256 chars) |
| `description` | Yes | Full description |
| `internalNote` | No | Staff-only note |
| `assignedTo` | No | Admin user UUID |

**Issue status values:** `OPEN` | `IN_PROGRESS` | `AWAITING_CUSTOMER` | `RESOLVED` | `CLOSED`

**Frontend → API status mapping:**
| Frontend label | API enum value | Meaning |
|----------------|----------------|---------|
| Pending | `OPEN` | Newly submitted, not yet reviewed |
| Working | `IN_PROGRESS` | Staff is actively investigating |
| (Awaiting customer) | `AWAITING_CUSTOMER` | Waiting for reply from the customer |
| (Resolved) | `RESOLVED` | Issue has been resolved (refund sent, replacement shipped, etc.) |
| Closed | `CLOSED` | Ticket is complete and archived |

#### List issues — `GET /admin/reconciliation/issues`

Optional query params: `?status=OPEN`, `?userId=<uuid>`, `?orderId=<uuid>`, `?type=REFUND_REQUEST`, `?priority=HIGH`.

#### Get issue — `GET /admin/reconciliation/issues/:id`

#### Update issue — `PATCH /admin/reconciliation/issues/:id`

```json
{
  "status": "IN_PROGRESS",
  "priority": "CRITICAL",
  "assignedTo": "admin-uuid",
  "resolutionNote": "Replacement shipped, tracking DHL 1Z999...",
  "internalNote": "Updated after call with customer"
}
```

All fields optional.

#### Resolve with refund — `POST /admin/reconciliation/issues/:id/resolve-with-refund`

Convenience endpoint that creates a refund **and** closes the issue in one call.

```json
{
  "amount": "49.99",
  "reason": "Refund issued for item not received",
  "internalNote": "Auto-closed via resolve-with-refund",
  "resolutionNote": "We have issued a full refund. Please allow 3–5 business days.",
  "initiatedBy": "admin-uuid"
}
```

**Response:** `{ "issue": { ... }, "refund": { ... } }` — both the updated issue (status `RESOLVED`) and the newly created refund object.

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

With a **valid** JWT (`auth.token` or `?token=`), the server joins the socket to **`user:<userId>`** for order notifications. The server emits `order.updated` in two situations:

1. **Order created** — right after `POST /orders` succeeds (`status: "PENDING"`)
2. **Payment confirmed** — after the provider webhook fires or `POST /payments/paypal/capture` succeeds (`status: "PAID"`)

```ts
const socket = io(`${API_BASE_URL}/realtime`, {
  path: '/socket.io',
  auth: { token: accessToken },
});

socket.on('order.updated', (payload: { orderId: string; status: string }) => {
  if (payload.status === 'PAID') {
    // payment confirmed — navigate to success screen or refetch order
    fetchOrder(payload.orderId).then(showSuccessScreen);
  } else {
    // order created or status changed — update local state
    updateOrderInStore(payload.orderId, payload.status);
  }
});
```

**Token refresh on reconnect:** if the access token expires mid-checkout the socket stays connected but loses its user room (order events stop). Reconnect with a fresh token after `POST /auth/refresh`:

```ts
async function reconnectSocket() {
  const { accessToken } = await refreshTokens(); // POST /auth/refresh
  socket.auth = { token: accessToken };
  socket.disconnect().connect();
}
```

**Invalid or expired JWT** does **not** disconnect the socket; you still get import events, but not order pushes until you reconnect with a fresh token.

**Polling fallback:** if the socket cannot connect (network issue, token expired on return from payment provider), poll `GET /orders/:id` every 3 s until `status === "PAID"` (cap at ~12 attempts / ~36 s) then show a "taking longer than expected" message and a manual refresh button.

---

## Error handling

- **`401 Unauthorized`** — missing/invalid/expired access token (try refresh once, then login), or **wrong TOTP** / bad **`preAuthToken`** on **`POST /auth/login/2fa`**.
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
2. **Checkout:** `POST /cart/items` … → render cart totals from API (simple preview: `subtotal`, `serviceCharge`, `discount`, `fees`, `total`) → **before** the user confirms, show a full landed cost estimate: call **`POST /landed-cost/quote`** with their chosen `destination`, `shippingService`, and `category` (use `productId` per cart line for Mode A, or pass the scraped `productPriceUsd` + `marketplace` for Mode B; for multi-item carts you can quote the highest-value product or quote all and sum — the order endpoint calculates the real total) → show the `breakdown` array and `totalDisplay` in an "Estimated total" panel; note `marketplaceConfidence` and show a disclaimer when `"low"` → user confirms → **`POST /orders`** with `landedCost: { destination, shippingService, category }` (this **clears the cart**, re-scrapes prices, recomputes the full landed cost server-side, and returns the order; save **`order.id`**) → from this point, **do not** rely on `GET /cart` for payment UI; use the order or **`GET /orders/:id`** for line items and the full breakdown (`pricingBreakdown`, individual cost fields) → `GET /payments/methods` (only show `available` providers) → **connect Socket.IO** with your JWT before redirecting (so you don't miss the `order.updated` event while the user is on the provider's page) → **`POST /payments/initialize`** → redirect to Stripe / PayPal approval URL (or show Myaza QR) → on return: for **PayPal** call `POST /payments/paypal/capture`; for **Stripe** and **Myaza** wait for the `order.updated { status: "PAID" }` socket event or poll `GET /orders/:id` as a fallback. See **Payments → Payment confirmation flow** for per-provider code. If **`initialize` fails**, keep the user on an **order-based** screen, offer **retry** (same `orderId`), and show a path to **pending orders**.
3. **Account:** register → verify email (`POST /auth/verify-email` or link from inbox) → login. If login returns **`requiresTwoFactor`**, show TOTP step and **`POST /auth/login/2fa`** (send **`localCart`** here if you need guest cart merge). Handle login **`403`** + **`EMAIL_NOT_VERIFIED`** with resend. **`GET /me` / `PATCH /me`**; optional **`GET/POST /me/2fa/*`** for Settings → 2FA. Keep cart and orders behind auth.
4. **Admin:** gate routes on `role`; use `/admin/*` (e.g. **`GET /admin/products`** for the full catalog). Storefront home can use public **`GET /products?limit=…`** for recent items. For refund and support ticket workflows, use **`/admin/reconciliation/*`** (see [Reconciliation](#reconciliation-admin-only)).
5. **Order status display:** handle `REFUNDED` and `DISPUTED` in your status badge/copy alongside the existing values. `REFUNDED` is set automatically by the reconciliation service when a full provider refund succeeds; `DISPUTED` is set manually by admin when a chargeback or payment dispute is opened.

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
| POST | `/auth/login/2fa` | — |
| POST | `/auth/passkey/login/start` | — |
| POST | `/auth/passkey/login/finish` | — |
| POST | `/auth/passkey/register/start` | Bearer |
| POST | `/auth/passkey/register/finish` | Bearer |
| GET | `/auth/passkey/credentials` | Bearer |
| PATCH | `/auth/passkey/credentials/:id` | Bearer |
| DELETE | `/auth/passkey/credentials/:id` | Bearer |
| POST | `/auth/refresh` | — |
| POST | `/auth/forgot-password` | — |
| POST | `/auth/reset-password` | — |
| GET | `/me` | Bearer |
| PATCH | `/me` | Bearer |
| GET | `/me/2fa` | Bearer |
| POST | `/me/2fa/setup` | Bearer |
| POST | `/me/2fa/enable` | Bearer |
| POST | `/me/2fa/setup/cancel` | Bearer |
| POST | `/me/2fa/disable` | Bearer |
| POST | `/products/import` | — |
| GET | `/products/import/:importId` | — |
| GET | `/products` | — (optional `?displayCurrency=`) |
| GET | `/products/:idOrSlug` | — (optional `?displayCurrency=`) |
| POST | `/shipping/quote` | — — Kingz-only freight estimate |
| POST | `/landed-cost/quote` | — — full landed cost (tax + shipping + customs + buffers + margin) |
| GET | `/saves` | Bearer |
| POST | `/saves/:productId` | Bearer |
| DELETE | `/saves/:productId` | Bearer |
| GET | `/saves/:productId/status` | Bearer |
| GET | `/cart` | Bearer |
| POST | `/cart/sync` | Bearer |
| POST | `/cart/items` | Bearer |
| PATCH | `/cart/items/:itemId` | Bearer |
| DELETE | `/cart/items/:itemId` | Bearer |
| POST | `/orders` | Bearer — requires `landedCost: { destination, shippingService, category? }` |
| GET | `/orders` | Bearer — optional `?status=PENDING` (etc.) |
| GET | `/orders/pending-payment` | Bearer — most recent unpaid order for banners |
| GET | `/orders/:id` | Bearer |
| POST | `/reconciliation/issues` | Bearer |
| POST | `/reconciliation/price-disputes` | Bearer |
| GET | `/reconciliation/my-issues` | Bearer |
| GET | `/reconciliation/my-issues/:id` | Bearer |
| GET | `/payments/methods` | — |
| POST | `/payments/initialize` | Bearer |
| POST | `/payments/paypal/capture` | Bearer — call on return from PayPal approval URL |
| POST | `/payments/webhooks/stripe` | Server-to-server — Stripe signs with `stripe-signature` |
| POST | `/payments/webhooks/paystack` | Server-to-server — Paystack signs with `x-paystack-signature` |
| POST | `/payments/webhooks/myaza` | Server-to-server — optional `x-myaza-signature` |
| GET | `/admin/orders` | Bearer admin |
| PATCH | `/admin/orders/:id` | Bearer admin |
| GET | `/admin/products` | Bearer admin |
| POST | `/admin/scrape-preview` | Bearer admin |
| GET | `/admin/shipping-rates` | Bearer admin |
| PATCH | `/admin/shipping-rates` | Bearer admin |
| POST | `/admin/reconciliation/refunds` | Bearer admin |
| GET | `/admin/reconciliation/refunds` | Bearer admin |
| GET | `/admin/reconciliation/refunds/:id` | Bearer admin |
| POST | `/admin/reconciliation/issues` | Bearer admin |
| GET | `/admin/reconciliation/issues` | Bearer admin |
| GET | `/admin/reconciliation/issues/:id` | Bearer admin |
| PATCH | `/admin/reconciliation/issues/:id` | Bearer admin |
| POST | `/admin/reconciliation/issues/:id/resolve-with-refund` | Bearer admin |
| Socket.IO | `/realtime` | — for import events; optional JWT for `order.updated` |
