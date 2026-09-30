-- Phase K: Tenant & Authorization Lockdown
-- Database support for strict tenant-scoped authorization lookups.
-- No dashboard/UI changes and no autonomous recovery behavior.

create unique index if not exists manager_users_business_id_id_uidx
  on manager_users(business_id,id);

create unique index if not exists riders_business_id_id_uidx
  on riders(business_id,id);

create unique index if not exists restaurant_order_stations_business_id_id_uidx
  on restaurant_order_stations(business_id,id);

create unique index if not exists delivery_zones_business_id_id_uidx
  on delivery_zones(business_id,id);

create unique index if not exists aggregator_integrations_business_id_id_uidx
  on aggregator_integrations(business_id,id);

create unique index if not exists proof_of_delivery_business_id_id_uidx
  on proof_of_delivery(business_id,id);

create index if not exists rider_sessions_rider_expires_idx
  on rider_sessions(rider_id,expires_at);

create index if not exists station_sessions_station_expires_idx
  on station_sessions(station_id,expires_at);

create index if not exists manager_sessions_manager_expires_idx
  on manager_sessions(manager_id,expires_at);

create index if not exists customer_sessions_customer_business_expires_idx
  on customer_sessions(customer_id,business_id,expires_at);
