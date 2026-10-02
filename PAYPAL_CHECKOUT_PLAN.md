# Checkout Payment Expansion

## Current checkout

The customer checkout now supports a professional payment selection UI with:

- M-Pesa
- Card via the existing Paystack flow
- PayPal as a reserved payment rail, visibly marked as unavailable until merchant credentials and server-side endpoints are configured

PayPal is deliberately not treated as successful merely because a customer selected it.

## PayPal production path

When enabled, use PayPal's current JavaScript SDK and a server-side create/capture flow. The browser must never receive the PayPal client secret.

Required server configuration should be environment variables, not source code:

- PAYPAL_CLIENT_ID
- PAYPAL_CLIENT_SECRET
- PAYPAL_ENVIRONMENT=sandbox|live

The backend should expose purpose-bound endpoints such as:

- POST /api/payments/paypal/create
- POST /api/payments/paypal/capture

The server must derive the payable amount from the authoritative order/quote rather than trusting a browser-supplied amount.

Payment state should only become PAID after server-side verification/capture succeeds.

PayPal's current documentation recommends JavaScript SDK v6 for new integrations. The PayPal client ID is browser-safe; the client secret must remain server-side.

## Multi-tenant consideration

Because this is a restaurant platform, PayPal must not be wired as one global merchant account without deciding the commercial model first.

If restaurants receive payments directly, the platform needs the appropriate PayPal partner/multiparty onboarding model and seller accounts. If the platform receives merchant funds centrally, the contractual, tax, settlement and regulatory implications need to be reviewed before implementation.

## Checkout UX

The checkout should never expose a fake or non-functional PayPal success state. Until credentials and the server flow are configured, the PayPal option remains disabled and clearly labelled.
