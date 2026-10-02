# Direct Ordering Engine — Digital ordering platform

A reusable ordering engine designed to plug into custom-designed business websites.

## Digital ordering platform flow

Customer website → product/menu → product options → cart → checkout → simulated payment → order tracking.

The demo also includes a small restaurant dashboard so we can see how a business receives and updates orders.

## Architecture

- Vanilla HTML/CSS/JavaScript for the demo frontend
- A reusable `order-system.js` integration layer
- Browser storage for prototype persistence
- Product data exposed through the demo catalog
- Simulated M-Pesa, card, and PayPal choices

The storage layer will later be replaced by a real API/database without changing the customer-facing integration concept.

## Integration idea

A custom website can mark an orderable product with:

```html
<button data-order-product="classic-burger">Order</button>
```

The reusable integration script detects the action and opens the product configuration flow. A product can therefore be ordered from a homepage card, special offer, blog section, or menu — not only from a dedicated Order page.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Commercial-launch status

The repository now contains a production-oriented ordering API, security hardening and a technical compliance foundation. Legal/compliance documents are launch drafts until the correct legal entity, restaurant-specific details, processor/transfer information and final counsel review are completed.

Do not treat the repository alone as legal compliance or as a guarantee against claims, complaints or regulatory action. Use `COMMERCIAL_LAUNCH_COMPLIANCE.md` as the pre-launch gate.

Payments in the current production architecture use Paystack when the required Render environment variables are configured.

## Current architecture

This repository now contains the reusable customer ordering flow, Manager Dashboard, Rider Dashboard, Platform Control Centre, tenant branding, package entitlements, delivery operations, payment reconciliation protections, compliance foundations, and security regression tests.

### Package authority

The commercial package system is **STARTER / GROWTH / PRO**. Runtime authorization is derived from `businesses.plan_key` and `platform_packages.features`. The legacy `package_type` field is migration-only and must not be used for authorization.

See `docs/PACKAGE_ENTITLEMENTS.md` for the capability matrix and enforcement rules.

### Production readiness

Before commercial launch, run the migration/constraint validation and complete the end-to-end matrix in `docs/PRODUCTION_SMOKE_MATRIX.md`. The repository includes a production smoke harness at `api/production-smoke.mjs`.
