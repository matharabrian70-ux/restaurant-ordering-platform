# Rider Dashboard Module

The rider dashboard is an optional advanced module of the restaurant ordering platform.

## Enable for an advanced-package client

Set the backend environment variable:

RIDER_MODULE_ENABLED=true

Redeploy the API. The restaurant workflow can then assign riders and the rider portal becomes available.

## Keep disabled for standard clients

Set:

RIDER_MODULE_ENABLED=false

The core customer ordering, restaurant dashboard, payments and refunds continue to operate. Rider endpoints are disabled, rider navigation is hidden, and the restaurant dashboard does not require rider data.

## Integration contract

The module uses the existing riders, rider_trips and orders tables and these endpoints:

- GET /api/riders
- POST /api/riders
- GET /api/riders/:id/active-delivery
- POST /api/riders/:id/complete-delivery
- POST /api/orders/:id/assign-rider

Feature state is exposed through:

GET /api/features

Example response:

{ "riderModule": true }

The goal is to keep the advanced rider capability attachable to the same core ordering platform without maintaining a separate customer-ordering codebase.


## Delivery and rider operating model

The advanced module now includes:

- Secure rider login sessions instead of rider-ID-only access.
- Restaurant-created rider accounts with phone, password, vehicle, plate and M-Pesa payout number.
- Online/offline presence and busy/available state.
- Assignment → accepted → arrived at restaurant → picked up → on the way → delivered.
- Rider dashboard with assignments, active trip, completed trips, daily/weekly earnings and history.
- Restaurant-side rider analytics: trip count, kilometres covered, online/busy status, payout number and earnings.
- Google Routes API route calculation using traffic-aware two-wheel routing.
- Server-side delivery quotes based on route distance/time, a fuel-price input, rider availability/demand and configurable pricing constants.
- Delivery fee is stored separately from food subtotal.
- Delivery fee remains held in the platform ledger until a rider completes the delivery.
- Cancellation before restaurant acceptance uses the existing Paystack refund flow, including the delivery fee.
- After completed delivery, the delivery fee is released to the rider ledger. The payout engine can send the released amount to the rider's M-Pesa number through Paystack Transfers when `RIDER_AUTO_PAYOUT=true`.
- Post-delivery refund protection prevents an admin refund from including a released delivery fee; food refunds can still be handled separately.
- If a restaurant has a Paystack subaccount configured on `businesses.paystack_subaccount_code`, the payment initializer can split the food subtotal to the restaurant while the delivery fee remains in the platform account for rider payout.
- Nairobi petrol price is refreshed from the official EPRA pump-price page when the cached value is stale, with an environment/cached fallback.

### Pricing model

The delivery quote engine is deliberately **Bolt-inspired, not a copy of Bolt's proprietary formula**. It uses transparent inputs:

`base fee + distance fee + time fee` × `fuel multiplier` × `demand multiplier`

The exact constants are configuration decisions for this platform and can be tuned from real Nairobi delivery data. Google Routes supplies distance and traffic-aware duration; EPRA supplies the fuel-price input. Google Maps Platform Routes API requires an API key and billing. The checkout displays the resulting delivery fee before payment.

### Production configuration

Set these on the API service:

`RIDER_MODULE_ENABLED=true` — master-enable the advanced module.

`GOOGLE_MAPS_API_KEY=...` — server key for route calculation.

`RIDER_AUTO_PAYOUT=true` — enable automatic rider M-Pesa payout after successful delivery.

`EPRA_FUEL_PRICE_URL=https://www.epra.go.ke/EPRA%20Pump%20Prices` — official fuel-price source.

`NAIROBI_FUEL_PRICE_KES=` — optional manual fallback/override.

For each restaurant, set `business_features.rider_module_enabled=true` only when that client has purchased the advanced package.
