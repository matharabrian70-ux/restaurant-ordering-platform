# Production Processor Register — Launch Evidence

**Operational register. Update whenever a provider, purpose, data category or jurisdiction changes.**

| Provider | Purpose | Data | Jurisdiction | Transfer safeguard | Contract status | Enabled? |
|---|---|---|---|---|---|---|
| Paystack | Payment processing/status | Name, email, phone, payment/order references | Verify current provider locations | Verify current lawful transfer mechanism | Review required | Must be confirmed |
| Google Maps Platform | Geocoding/routes | Delivery address/coordinates | Verify current provider locations | Verify current lawful transfer mechanism | Review required | Must be confirmed |
| Africa's Talking | Rider/customer SMS where enabled | Name, phone, order reference | Verify current provider locations | Verify current lawful transfer mechanism | Review required | Must be confirmed |
| Render | API/database hosting | Application data | Verify deployment region | Verify DPA/transfer safeguards | Review required | Must be confirmed |

**Launch rule:** do not treat "provider exists in the code" as proof of compliance. Confirm the actual account, contract, processing location, data flow and safeguards used in production.
