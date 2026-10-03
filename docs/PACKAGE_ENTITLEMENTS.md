# Package Entitlement Architecture

## Authority

The platform now has one entitlement model:

`businesses.plan_key` → `platform_packages.features`

The legacy `businesses.package_type` column is retained only as a migration-compatibility field. Runtime authorization must not read it.

Likewise, `business_features.rider_module_enabled` is not an entitlement source. It may mirror operational state, but a tenant cannot receive a package feature by changing that flag.

## Canonical plans

| Plan | Core | Delivery | Rider | Analytics | Integrations | Multi-branch |
|---|---|---|---|---|---|---|
| STARTER | ordering, digitalOrdering, tenantIsolation, websiteIntegration, auditTrail | manualDeliveryZones | — | — | — | — |
| GROWTH | STARTER | advancedDelivery, branchRouting | riderModule, riderTracking, sms | advancedAnalytics | customDomain, apiIntegrations | — |
| PRO | GROWTH | — | — | — | — | multiBranch, prioritySupport, automation |

## Enforcement

The API uses `requireFeature(feature, businessId)` and a centralized package-capability middleware. Protected routes resolve their tenant from authenticated sessions, tenant-bound URL parameters, order records, business IDs, rider invites, stations, or signed integration tokens.

The frontend may hide or show controls, but it is never an authorization boundary.

A missing capability returns HTTP 403 with:

- `code: FEATURE_NOT_INCLUDED`
- `feature`
- `planKey`

## Migration

Migration `010_phase_r_package_authority_and_constraint_validation.sql`:

1. maps `DIGITAL_ORDERING → STARTER`
2. maps `ADVANCED → GROWTH`
3. fills missing `plan_key` values
4. makes `plan_key` non-null with STARTER as the default
5. rewrites package feature JSON to the canonical matrix
6. validates the production database constraints

The migration intentionally fails if historical records still violate a constraint. That is a launch gate, not data that should be silently repaired.

## Developer rule

When adding a paid capability:

1. add it to `platform_packages.features`
2. protect the backend operation with `requireFeature()` or the central capability map
3. add an entitlement regression test
4. add the capability to the production smoke matrix if it has an end-to-end flow

Do not add a second package enum or feature flag.


## Delivery package behavior

- **STARTER:** delivery is restaurant-controlled. Managers create simple radius zones and set the customer-facing fee and optional minimum order for each zone. There is no Dispatch, Riders, rider tracking, rider earnings or rider payout control in the Manager Dashboard.
- **GROWTH/PRO:** automatic route-based delivery pricing is used when the Rider Dashboard is actually connected. The delivery fee is kept in the rider delivery ledger and can flow to the rider payout workflow after delivery completion.
- **Growth/Pro entitlement without an active Rider Dashboard connection:** rider operations are unavailable and the restaurant stays on manual delivery-zone pricing until the connection is active.
- businesses.plan_key → platform_packages.features remains the package authority. business_connections.rider_connected is operational connection state, not package entitlement.
