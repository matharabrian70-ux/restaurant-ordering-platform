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
