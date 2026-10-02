# Control Centre Data Isolation & Controlled Dispute Access

## Objective

The Platform Control Centre is a platform-operations surface, not a general-purpose browser for restaurant or customer data.

Routine Control Centre access must not expose:
- restaurant-wide order feeds
- restaurant revenue or paid-order totals
- customer names, phone numbers, emails or addresses
- rider phone numbers, emails or personal profile data
- exact customer delivery addresses
- exact rider GPS history
- order item contents
- payment provider references
- bulk restaurant/customer exports

## Normal access model

The Control Centre may show platform-level configuration and health information such as:
- tenant registry metadata
- package/entitlement configuration
- integration state
- system health
- platform incidents
- platform administrative audit events
- compliance/processor governance information

The normal UI contains no restaurant order browser or customer browser.

## Controlled dispute access

A legitimate investigation creates a control_access_cases record containing:
- restaurant tenant
- internal target order reference
- documented purpose/category
- reason
- requesting platform administrator
- case status

The target order ID is stored server-side and is never returned by the normal case-list endpoint.

Evidence is accessed only after a time-limited control_access_grants record is created.

Supported evidence scopes:
- ORDER_TIMELINE
- DELIVERY_EVIDENCE
- REFUND_EVIDENCE
- LOCATION_DETAIL
- CUSTOMER_CONTACT

The first three are case-scoped evidence. Exact location and customer contact require PLATFORM_OWNER authorization.

Maximum grant duration is 30 minutes.

## Evidence minimisation

ORDER_TIMELINE does not return order value, customer identity, address or order items.

DELIVERY_EVIDENCE returns delivery lifecycle events, a masked rider reference and proof-of-delivery type/timestamp. Photo, signature, recipient identity and exact coordinates are excluded.

REFUND_EVIDENCE returns refund provider/status/timestamps and a masked transaction reference. Refund amounts are not returned through the controlled evidence surface.

LOCATION_DETAIL is a restricted owner-only scope and returns exact delivery-event coordinates only when specifically required for the documented case.

CUSTOMER_CONTACT is a restricted owner-only scope and returns only the customer contact fields necessary for the documented case.

## Auditability

Every case creation, grant, evidence view and case closure is recorded in control_access_audit.

The audit table is append-only at the database layer: update/delete attempts are rejected by a database trigger.

Evidence grants automatically expire. Closing a case revokes active grants.

## Security boundary

The architecture intentionally avoids a SUPER ADMIN -> SELECT * model.

The Control Centre calls dedicated, purpose-bound dispute endpoints. It does not receive direct database credentials and does not receive a general-purpose tenant-data browsing API.

## Example

For a delivery dispute:
1. Restaurant/support provides the restaurant and order reference.
2. Platform administrator creates a dispute case with a reason.
3. Administrator requests DELIVERY_EVIDENCE.
4. The system creates a 15-minute grant.
5. Only minimum delivery evidence is returned.
6. The evidence view is audited.
7. The grant expires automatically.
8. The case is closed and any remaining grants are revoked.

This is intended to support legitimate dispute resolution while reducing routine exposure of merchant and customer information.

> This technical control supports data minimisation and purpose limitation but does not replace legal review of the platform's controller/processor roles, contractual permissions, retention schedule, incident response obligations or lawful basis for restricted access.