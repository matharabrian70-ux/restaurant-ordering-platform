# Production Smoke Test Matrix

This is the final end-to-end checklist for deployment. Automated regression tests prove the code contract; these smoke tests prove that the deployed services, database, payment provider and browser flow work together.

## Customer

- Open restaurant
- Load menu
- Open product
- Choose options
- Add to cart
- Request delivery quote
- Checkout
- M-Pesa/card payment
- Payment confirmation
- Restaurant receives order
- Customer tracking
- Rider delivery
- Customer confirmation
- Receipt

## Manager

- Sign in
- Load today's orders
- Open order details
- Change order status
- Manage menu
- Create promotion
- Assign rider (Growth/Pro only)
- Verify a Starter tenant receives HTTP 403 for rider operations
- Verify analytics (Growth/Pro only)
- Verify SMS controls (Growth/Pro only)
- Verify custom-domain controls (Growth/Pro only)
- Verify integration controls (Growth/Pro only)
- Verify branch-management controls (Pro only)

## Rider

- Sign in
- Receive assignment
- Accept delivery
- Location update
- Live route
- Mark delivered
- Earnings
- Suspend/reactivate session behavior

## Control Centre

- Platform login
- Create Starter tenant
- Create Growth tenant
- Create Pro tenant
- Change plan
- Verify plan change immediately changes backend capabilities
- Verify tenant A cannot access tenant B resources
- Verify package feature list matches `platform_packages.features`

## Payment reconciliation

Run all of these against the payment provider's test/sandbox environment:

- payment succeeds
- payment fails
- payment times out
- customer closes browser
- duplicate webhook
- webhook before frontend verification
- duplicate frontend verification
- wrong payment reference
- successful refund
- failed refund
- refund timeout
- partial refund
- multiple partial refunds
- refund larger than paid amount

## Deployment gate

The automated smoke harness is:

`SMOKE_BASE_URL=https://your-api.example npm --prefix api test`

For a deployed API, run:

`SMOKE_BASE_URL=https://your-api.example node api/production-smoke.mjs`

The repository also contains a manual GitHub Actions production-smoke workflow so the same check can be run against the eventual custom API domain.
