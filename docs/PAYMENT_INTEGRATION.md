# Payment Integration Guide

This document covers every payment flow the frontend needs to implement: standard checkout (Stripe Checkout page, PayPal redirect), confirming a payment after the user returns, saving cards/PayPal accounts for future use, and paying with a saved method without leaving the app.

All paths are relative to your API base URL. Every protected endpoint requires `Authorization: Bearer <accessToken>`.

---

## Table of Contents

1. [Confirming Stripe Payments](#1-confirming-stripe-payments)
2. [Confirming PayPal Payments](#2-confirming-paypal-payments)
3. [Saved Payment Methods Overview](#3-saved-payment-methods-overview)
4. [Saving a Stripe Card](#4-saving-a-stripe-card)
5. [Saving a PayPal Account](#5-saving-a-paypal-account)
6. [Listing Saved Methods](#6-listing-saved-methods)
7. [Paying with a Saved Method](#7-paying-with-a-saved-method)
8. [Managing Saved Methods](#8-managing-saved-methods)
9. [API Reference](#9-api-reference)
10. [Error Handling](#10-error-handling)

---

## 1. Confirming Stripe Payments

Stripe uses a **hosted Checkout page**. The user leaves your app, pays on Stripe's domain, then returns to your success URL.

### Flow

```
Your app → POST /payments/initialize → Stripe URL
  → redirect user to session.url
  → Stripe collects payment
  → user lands on your STRIPE_CHECKOUT_SUCCESS_URL
  → Stripe fires checkout.session.completed webhook → order marked PAID
```

### Step 1 — Initialize

```http
POST /payments/initialize
Authorization: Bearer <token>
Content-Type: application/json

{
  "orderId": "uuid-of-pending-order",
  "provider": "stripe"
}
```

Response:

```json
{
  "provider": "stripe",
  "sessionId": "cs_test_...",
  "url": "https://checkout.stripe.com/c/pay/cs_test_...",
  "paymentMethodTypes": null
}
```

### Step 2 — Redirect

```js
window.location.href = response.url;
```

### Step 3 — Handle the return

Your `STRIPE_CHECKOUT_SUCCESS_URL` must contain the literal placeholder `{CHECKOUT_SESSION_ID}`:

```
https://yourapp.com/checkout/success?session_id={CHECKOUT_SESSION_ID}
```

Stripe replaces it before redirecting. When the user lands on that page:

```js
const params = new URLSearchParams(window.location.search);
const sessionId = params.get('session_id');
// Stripe has already fired the webhook at this point.
// Just show a success screen and let the user know their order is confirmed.
// Optionally poll GET /orders/:orderId to confirm status === 'PAID'.
```

> **No extra API call is needed to confirm.** The webhook does it server-side automatically. The `{CHECKOUT_SESSION_ID}` in the URL is available for your analytics/display only.

---

## 2. Confirming PayPal Payments

PayPal uses a **redirect flow** for new (non-vaulted) orders.

### Flow

```
Your app → POST /payments/initialize → PayPal approval URL
  → redirect user to approvalUrl
  → user approves on PayPal
  → PayPal redirects to your PAYPAL_RETURN_URL with token & PayerID query params
  → Your page calls POST /payments/paypal/capture
  → order marked PAID
```

### Step 1 — Initialize

```http
POST /payments/initialize
Authorization: Bearer <token>
Content-Type: application/json

{
  "orderId": "uuid-of-pending-order",
  "provider": "paypal"
}
```

Response:

```json
{
  "provider": "paypal",
  "paypalOrderId": "5O190127TN364715T",
  "approvalUrl": "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T"
}
```

### Step 2 — Redirect

```js
window.location.href = response.approvalUrl;
```

### Step 3 — Capture on return

After approval PayPal sends the user to `PAYPAL_RETURN_URL` with:

```
https://yourapp.com/checkout/paypal-return?token=5O190127TN364715T&PayerID=XXXXXXXXX
```

Read the `token` (= PayPal order ID) from the URL and call:

```http
POST /payments/paypal/capture
Authorization: Bearer <token>
Content-Type: application/json

{
  "orderId": "uuid-of-pending-order",
  "paypalOrderId": "5O190127TN364715T"
}
```

Response on success:

```json
{
  "provider": "paypal",
  "orderId": "uuid-of-pending-order",
  "paypalOrderId": "5O190127TN364715T",
  "paypalCaptureId": "3C679366HH908993F",
  "status": "PAID"
}
```

Show a success screen.

---

## 3. Saved Payment Methods Overview

Users can save a card (via Stripe) or their PayPal account once, then pay future orders in one click — no redirect, no re-entering card details.

**SavedPaymentMethod object** (returned by the API):

```json
{
  "id": "uuid",
  "provider": "stripe",
  "type": "card",
  "label": "Visa ···4242",
  "brand": "visa",
  "last4": "4242",
  "expiryMonth": 12,
  "expiryYear": 2027,
  "stripePaymentMethodId": "pm_...",
  "stripeCustomerId": "cus_...",
  "paypalPaymentTokenId": null,
  "paypalEmail": null,
  "isDefault": true,
  "createdAt": "2026-06-20T10:00:00.000Z",
  "updatedAt": "2026-06-20T10:00:00.000Z"
}
```

For a PayPal account:

```json
{
  "id": "uuid",
  "provider": "paypal",
  "type": "paypal",
  "label": "PayPal (user@example.com)",
  "brand": null,
  "last4": null,
  "expiryMonth": null,
  "expiryYear": null,
  "stripePaymentMethodId": null,
  "stripeCustomerId": null,
  "paypalPaymentTokenId": "8KL12345XY678901A",
  "paypalEmail": "user@example.com",
  "isDefault": false,
  "createdAt": "2026-06-20T10:00:00.000Z",
  "updatedAt": "2026-06-20T10:00:00.000Z"
}
```

---

## 4. Saving a Stripe Card

You need **Stripe.js** loaded on the page. Install it:

```bash
npm install @stripe/stripe-js
# or for React:
npm install @stripe/react-stripe-js @stripe/stripe-js
```

### Flow

```
POST /payments/saved-methods/stripe/setup-intent  →  clientSecret
  → render Stripe card form with clientSecret
  → stripe.confirmSetup()  →  SetupIntent succeeds
POST /payments/saved-methods/stripe/confirm { setupIntentId }  →  SavedPaymentMethod
```

### Step 1 — Get a SetupIntent

```http
POST /payments/saved-methods/stripe/setup-intent
Authorization: Bearer <token>
```

Response:

```json
{
  "clientSecret": "seti_1ABC...._secret_XYZ..."
}
```

### Step 2 — Render the card form and confirm

```js
import { loadStripe } from '@stripe/stripe-js';

const stripe = await loadStripe('pk_test_...');  // your Stripe publishable key

const elements = stripe.elements({ clientSecret });

// Mount a Payment Element (recommended — handles all card types + 3DS)
const paymentElement = elements.create('payment');
paymentElement.mount('#payment-element');

// On form submit:
const { error, setupIntent } = await stripe.confirmSetup({
  elements,
  redirect: 'if_required',        // avoid full-page redirect when not needed
  confirmParams: {
    return_url: 'https://yourapp.com/settings/payment-methods',
  },
});

if (error) {
  // Show error.message to the user
} else if (setupIntent.status === 'succeeded') {
  await saveCardToBackend(setupIntent.id);
}
```

> If `redirect: 'if_required'` triggers a full-page redirect (e.g. for 3DS), Stripe will redirect back to `return_url` with `?setup_intent=si_...&setup_intent_client_secret=...` in the URL. Read `setup_intent` from the query string and call Step 3 on page load.

### Step 3 — Confirm with the backend

```http
POST /payments/saved-methods/stripe/confirm
Authorization: Bearer <token>
Content-Type: application/json

{
  "setupIntentId": "seti_1ABC..."
}
```

Response: a `SavedPaymentMethod` object (see Section 3).

```js
// After redirect-based confirmation, read from URL:
const params = new URLSearchParams(window.location.search);
const setupIntentId = params.get('setup_intent');
if (setupIntentId) {
  const res = await fetch('/payments/saved-methods/stripe/confirm', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ setupIntentId }),
  });
  const saved = await res.json();
  // saved.label → "Visa ···4242"
}
```

This endpoint is **idempotent**: calling it twice with the same `setupIntentId` returns the existing record without creating a duplicate.

---

## 5. Saving a PayPal Account

No external SDK is needed. The user is redirected to PayPal's site to approve the vault, then returned to your app.

### Flow

```
POST /payments/saved-methods/paypal/setup-token  →  { setupTokenId, approvalUrl }
  → redirect user to approvalUrl
  → user approves on PayPal
  → PayPal redirects to your PAYPAL_VAULT_RETURN_URL with token query param
POST /payments/saved-methods/paypal/confirm { setupTokenId }  →  SavedPaymentMethod
```

### Step 1 — Get a setup token

```http
POST /payments/saved-methods/paypal/setup-token
Authorization: Bearer <token>
Content-Type: application/json

{
  "returnUrl": "https://yourapp.com/settings/payment-methods/paypal-return",
  "cancelUrl": "https://yourapp.com/settings/payment-methods"
}
```

`returnUrl` and `cancelUrl` are optional if `PAYPAL_VAULT_RETURN_URL` and `PAYPAL_VAULT_CANCEL_URL` are set in the server environment.

Response:

```json
{
  "setupTokenId": "6JV12345AB678901C",
  "approvalUrl": "https://www.sandbox.paypal.com/agreements/approve?approval_session_id=..."
}
```

### Step 2 — Redirect and handle return

```js
window.location.href = response.approvalUrl;
```

PayPal returns the user to your `returnUrl` with a `token` query param:

```
https://yourapp.com/settings/payment-methods/paypal-return?token=6JV12345AB678901C
```

Read the token and confirm:

### Step 3 — Confirm with the backend

```http
POST /payments/saved-methods/paypal/confirm
Authorization: Bearer <token>
Content-Type: application/json

{
  "setupTokenId": "6JV12345AB678901C"
}
```

Response: a `SavedPaymentMethod` object (see Section 3).

```js
const params = new URLSearchParams(window.location.search);
const setupTokenId = params.get('token');

const res = await fetch('/payments/saved-methods/paypal/confirm', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ setupTokenId }),
});
const saved = await res.json();
// saved.label → "PayPal (user@example.com)"
```

This endpoint is also **idempotent**.

---

## 6. Listing Saved Methods

```http
GET /payments/saved-methods
Authorization: Bearer <token>
```

Response: array of `SavedPaymentMethod` objects sorted by default first, then oldest first.

```json
[
  {
    "id": "uuid-1",
    "provider": "stripe",
    "label": "Visa ···4242",
    "isDefault": true,
    ...
  },
  {
    "id": "uuid-2",
    "provider": "paypal",
    "label": "PayPal (user@example.com)",
    "isDefault": false,
    ...
  }
]
```

Use this to render the payment method selector on the checkout page and in the user's account settings.

---

## 7. Paying with a Saved Method

Pass the saved method's `id` as `savedMethodId` in the standard `POST /payments/initialize` call. The response shape differs depending on provider.

### 7a — Stripe saved card

```http
POST /payments/initialize
Authorization: Bearer <token>
Content-Type: application/json

{
  "orderId": "uuid-of-pending-order",
  "provider": "stripe",
  "savedMethodId": "uuid-of-saved-method"
}
```

Response:

```json
{
  "provider": "stripe",
  "paymentIntentId": "pi_3ABC...",
  "clientSecret": "pi_3ABC..._secret_XYZ..."
}
```

Unlike the standard Checkout flow, this **does not redirect**. You confirm the PaymentIntent in Stripe.js:

```js
const stripe = await loadStripe('pk_test_...');

const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret);

if (error) {
  // e.g. card declined, expired — show error.message
} else if (paymentIntent.status === 'succeeded') {
  // Payment complete. The webhook fires payment_intent.succeeded
  // and marks the order PAID server-side.
  // Navigate to your order confirmation page.
}
```

> `confirmCardPayment` handles 3D Secure automatically. If the card requires 3DS, Stripe opens a modal — no redirect leaves the page.

### 7b — PayPal saved account

```http
POST /payments/initialize
Authorization: Bearer <token>
Content-Type: application/json

{
  "orderId": "uuid-of-pending-order",
  "provider": "paypal",
  "savedMethodId": "uuid-of-saved-method"
}
```

Response — the order is **already captured** server-side:

```json
{
  "provider": "paypal",
  "orderId": "uuid-of-pending-order",
  "paypalOrderId": "5O190127TN364715T",
  "paypalCaptureId": "3C679366HH908993F",
  "status": "PAID"
}
```

No redirect, no extra step. Navigate straight to the confirmation screen.

---

## 8. Managing Saved Methods

### Set as default

```http
PATCH /payments/saved-methods/:id/default
Authorization: Bearer <token>
```

Response: updated `SavedPaymentMethod` with `isDefault: true`. All other methods for this user are automatically unset.

### Remove a saved method

```http
DELETE /payments/saved-methods/:id
Authorization: Bearer <token>
```

Response: `204 No Content`.

This detaches the method from Stripe/PayPal in addition to deleting the local record. Show an optimistic UI update and refresh the list.

---

## 9. API Reference

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| `POST` | `/payments/initialize` | ✓ | `InitializePaymentDto` | Start checkout (all providers). Add `savedMethodId` to pay with a saved method. |
| `POST` | `/payments/paypal/capture` | ✓ | `{ orderId, paypalOrderId }` | Capture PayPal order after user approves (standard flow only). |
| `GET` | `/payments/methods` | — | — | List available payment providers. |
| `GET` | `/payments/saved-methods` | ✓ | — | List user's saved payment methods. |
| `POST` | `/payments/saved-methods/stripe/setup-intent` | ✓ | — | Get Stripe SetupIntent `clientSecret`. |
| `POST` | `/payments/saved-methods/stripe/confirm` | ✓ | `{ setupIntentId }` | Save card after Stripe.js confirms the SetupIntent. |
| `POST` | `/payments/saved-methods/paypal/setup-token` | ✓ | `{ returnUrl?, cancelUrl? }` | Get PayPal vault `setupTokenId` + `approvalUrl`. |
| `POST` | `/payments/saved-methods/paypal/confirm` | ✓ | `{ setupTokenId }` | Convert PayPal setup token to vault token and save. |
| `PATCH` | `/payments/saved-methods/:id/default` | ✓ | — | Set a saved method as default. |
| `DELETE` | `/payments/saved-methods/:id` | ✓ | — | Remove a saved method (204). |
| `POST` | `/payments/webhooks/stripe` | — | Raw body | Stripe server-to-server webhook (do not call from frontend). |
| `POST` | `/payments/webhooks/paystack` | — | Raw body | Paystack server-to-server webhook (do not call from frontend). |
| `POST` | `/payments/webhooks/myaza` | — | Raw body | Myaza server-to-server webhook (do not call from frontend). |

### `InitializePaymentDto` fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `orderId` | UUID | ✓ | ID of a `PENDING` order |
| `provider` | `stripe` \| `paypal` \| `paystack` \| `myaza` | ✓ | Payment provider |
| `savedMethodId` | UUID | — | Saved method ID — skips redirect flow |
| `stripeSuccessUrl` | URL | — | Override `STRIPE_CHECKOUT_SUCCESS_URL` |
| `stripeCancelUrl` | URL | — | Override `STRIPE_CHECKOUT_CANCEL_URL` |
| `paypalReturnUrl` | URL | — | Override `PAYPAL_RETURN_URL` |
| `paypalCancelUrl` | URL | — | Override `PAYPAL_CANCEL_URL` |
| `stripePaymentMethodTypes` | string[] | — | Restrict Stripe PM types |
| `paystackChannels` | string[] | — | Restrict Paystack channels |

---

## 10. Error Handling

All errors follow NestJS's default shape:

```json
{
  "statusCode": 400,
  "message": "Human-readable reason",
  "error": "Bad Request"
}
```

Common cases:

| Status | Cause | Action |
|--------|-------|--------|
| `400` | Order is not `PENDING` (already paid or cancelled) | Redirect to order detail page |
| `400` | `savedMethodId` not found or belongs to another user | Refresh the saved methods list and retry |
| `400` | SetupIntent not `succeeded` | Ask user to retry the card save flow |
| `400` | PayPal vault token creation failed | Ask user to re-approve via PayPal |
| `400` | Stripe or PayPal not configured | Show a "payment method unavailable" message |
| `401` | Missing or expired JWT | Redirect to login |
| `404` | Saved method not found | Refresh the list |

### Detecting which `provider` was used

All `POST /payments/initialize` responses include a `provider` field. Use it to decide whether to show a Stripe.js confirmation step, a PayPal redirect, or a direct success screen:

```js
const res = await fetch('/payments/initialize', { ... });
const data = await res.json();

switch (data.provider) {
  case 'stripe':
    if (data.clientSecret) {
      // Saved card: confirm in-page with stripe.confirmCardPayment(data.clientSecret)
    } else {
      // Standard: redirect to data.url
      window.location.href = data.url;
    }
    break;

  case 'paypal':
    if (data.status === 'PAID') {
      // Saved PayPal: already captured — show confirmation
    } else {
      // Standard: redirect to data.approvalUrl
      window.location.href = data.approvalUrl;
    }
    break;

  case 'paystack':
    window.location.href = data.authorizationUrl;
    break;
}
```

---

## Environment variables (backend — for reference)

These need to be set on the server before any payment features work:

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_...` or `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |
| `STRIPE_CHECKOUT_SUCCESS_URL` | Must contain `{CHECKOUT_SESSION_ID}` |
| `STRIPE_CHECKOUT_CANCEL_URL` | Where to send users who cancel Stripe Checkout |
| `PAYPAL_CLIENT_ID` | PayPal app client ID |
| `PAYPAL_SECRET_KEY` | PayPal app client secret |
| `PAYPAL_MODE` | `sandbox` (default) or `live` |
| `PAYPAL_RETURN_URL` | Return URL after PayPal standard approval |
| `PAYPAL_CANCEL_URL` | Cancel URL for PayPal standard flow |
| `PAYPAL_VAULT_RETURN_URL` | Return URL after PayPal vault approval |
| `PAYPAL_VAULT_CANCEL_URL` | Cancel URL for PayPal vault flow |
