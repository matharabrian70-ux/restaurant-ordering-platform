-- Restaurant Ordering Platform database blueprint
-- Designed for PostgreSQL. Keep business data separated by business_id.

create extension if not exists pgcrypto;

create table if not exists businesses (
  id uuid primary key,
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key,
  business_id uuid not null references businesses(id),
  name text not null,
  phone text not null,
  email text,
  created_at timestamptz not null default now(),
  unique (business_id, phone)
);

create table if not exists products (
  id uuid primary key,
  business_id uuid not null references businesses(id),
  name text not null,
  category text,
  description text,
  price numeric(12,2) not null,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key,
  business_id uuid not null references businesses(id),
  customer_id uuid not null references customers(id),
  order_number text not null,
  status text not null default 'NEW',
  payment_status text not null default 'PENDING',
  payment_method text,
  delivery_note text,
  subtotal numeric(12,2) not null,
  total numeric(12,2) not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  out_for_delivery_at timestamptz,
  delivered_at timestamptz,
  unique (business_id, order_number)
);

create table if not exists order_items (
  id uuid primary key,
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id),
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null,
  options jsonb not null default '{}'::jsonb
);

create table if not exists riders (
  id uuid primary key,
  business_id uuid not null references businesses(id),
  name text not null,
  phone text,
  vehicle_type text,
  number_plate text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists rider_trips (
  id uuid primary key,
  rider_id uuid not null references riders(id),
  order_id uuid not null references orders(id),
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  confirmed_by text
);

create table if not exists payments (
  id uuid primary key,
  order_id uuid not null references orders(id) on delete cascade,
  provider text not null,
  provider_reference text,
  amount numeric(12,2) not null,
  status text not null default 'PENDING',
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists refunds (
  id uuid primary key,
  order_id uuid not null references orders(id) on delete cascade,
  payment_id uuid not null references payments(id) on delete cascade,
  provider text not null,
  provider_refund_id text,
  transaction_reference text not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'KES',
  status text not null default 'PENDING',
  customer_note text,
  merchant_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists receipts (
  id uuid primary key,
  order_id uuid not null unique references orders(id),
  receipt_number text not null unique,
  amount numeric(12,2) not null,
  issued_at timestamptz not null default now()
);

create index if not exists orders_business_created_idx on orders(business_id, created_at desc);
create index if not exists orders_customer_idx on orders(customer_id, created_at desc);
create index if not exists customers_phone_idx on customers(business_id, phone);
create index if not exists customers_email_idx on customers(business_id, email);
create index if not exists riders_business_idx on riders(business_id, active);
create index if not exists trips_rider_idx on rider_trips(rider_id, completed_at desc);
create unique index if not exists rider_active_trip_idx on rider_trips(rider_id) where completed_at is null;
create unique index if not exists payments_provider_reference_idx on payments(provider_reference) where provider_reference is not null;
create unique index if not exists refunds_provider_refund_id_idx on refunds(provider_refund_id) where provider_refund_id is not null;
create index if not exists refunds_order_idx on refunds(order_id, created_at desc);

alter table businesses add column if not exists pickup_address text;
alter table businesses add column if not exists paystack_subaccount_code text;

-- Demo business used by the current Savanna Bites prototype.
insert into businesses (id, name, slug)
values ('11111111-1111-4111-8111-111111111111', 'Savanna Bites', 'savanna-bites')
on conflict (slug) do nothing;
update businesses set pickup_address=coalesce(pickup_address,'Savanna Bites, Nairobi, Kenya') where slug='savanna-bites';

-- Demo riders used by the current prototype. These are clearly marked as demo records.
insert into riders (id, business_id, name, phone, vehicle_type, number_plate, active)
values
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Demo Rider A', '+254700000001', 'Motorbike', 'DEMO-001', true),
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Demo Rider B', '+254700000002', 'Motorbike', 'DEMO-002', true)
on conflict (id) do nothing;

-- Archive query pattern: newest delivered orders for a business.
-- Search should normalize phone/email before querying in application code.


-- Advanced rider delivery module: tenant feature configuration and delivery ledger.
create table if not exists business_features (
  business_id uuid primary key references businesses(id) on delete cascade,
  rider_module_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rider_auth (
  rider_id uuid primary key references riders(id) on delete cascade,
  password_hash text not null,
  payout_phone text,
  payout_recipient_code text,
  last_login_at timestamptz
);

create table if not exists rider_sessions (
  id uuid primary key,
  rider_id uuid not null references riders(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists rider_presence (
  rider_id uuid primary key references riders(id) on delete cascade,
  online boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists delivery_events (
  id uuid primary key,
  trip_id uuid not null references rider_trips(id) on delete cascade,
  status text not null,
  note text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  created_at timestamptz not null default now()
);

create table if not exists rider_earnings (
  id uuid primary key,
  rider_id uuid not null references riders(id),
  trip_id uuid not null unique references rider_trips(id),
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'HELD',
  released_at timestamptz,
  payout_status text not null default 'PENDING',
  payout_recipient_code text,
  payout_reference text,
  payout_transfer_code text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists delivery_quotes (
  id uuid primary key,
  business_id uuid not null references businesses(id),
  order_id uuid references orders(id) on delete set null,
  pickup_address text not null,
  delivery_address text not null,
  distance_meters integer not null,
  duration_seconds integer,
  fuel_price_kes numeric(10,2),
  base_fee_kes numeric(12,2) not null,
  distance_fee_kes numeric(12,2) not null,
  time_fee_kes numeric(12,2) not null,
  demand_multiplier numeric(8,4) not null default 1,
  delivery_fee_kes numeric(12,2) not null,
  currency text not null default 'KES',
  status text not null default 'QUOTED',
  created_at timestamptz not null default now()
);

create table if not exists fuel_price_snapshots (
  id uuid primary key,
  city text not null,
  petrol_price_kes numeric(10,2) not null,
  source text not null,
  effective_from date,
  fetched_at timestamptz not null default now()
);

alter table orders add column if not exists delivery_fee numeric(12,2) not null default 0;
alter table orders add column if not exists food_subtotal numeric(12,2);
alter table orders add column if not exists delivery_status text;
alter table orders add column if not exists pickup_address text;
alter table orders add column if not exists delivery_address text;
alter table orders add column if not exists delivery_lat numeric(10,7);
alter table orders add column if not exists delivery_lng numeric(10,7);
alter table orders add column if not exists route_distance_meters integer;
alter table orders add column if not exists route_duration_seconds integer;
alter table orders add column if not exists delivery_fee_status text not null default 'NONE';
alter table orders add column if not exists rider_earning numeric(12,2) not null default 0;
alter table orders add column if not exists delivery_fee_released_at timestamptz;
alter table orders add column if not exists cancelled_at timestamptz;
alter table orders add column if not exists cancellation_reason text;

alter table riders add column if not exists email text;
alter table riders add column if not exists payout_phone text;
alter table riders add column if not exists active boolean not null default true;

create index if not exists rider_sessions_rider_idx on rider_sessions(rider_id, expires_at desc);
create index if not exists delivery_events_trip_idx on delivery_events(trip_id, created_at);
create index if not exists rider_earnings_rider_idx on rider_earnings(rider_id, created_at desc);
create index if not exists delivery_quotes_business_idx on delivery_quotes(business_id, created_at desc);
create index if not exists fuel_price_city_idx on fuel_price_snapshots(city, fetched_at desc);

insert into business_features (business_id, rider_module_enabled)
values ('11111111-1111-4111-8111-111111111111', true)
on conflict (business_id) do update set rider_module_enabled=excluded.rider_module_enabled, updated_at=now();

update orders set food_subtotal=coalesce(food_subtotal,subtotal), delivery_status=coalesce(delivery_status, case when status='DELIVERED' then 'DELIVERED' when status='OUT_FOR_DELIVERY' then 'ASSIGNED' else 'NONE' end);


-- Branch-aware delivery engine and package pricing
create table if not exists business_branches (
  id uuid primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  address text not null,
  latitude numeric(10,7) not null,
  longitude numeric(10,7) not null,
  google_place_id text,
  building text,
  floor text,
  unit text,
  street text,
  estate text,
  landmark text,
  pickup_instructions text,
  active boolean not null default true,
  accepting_orders boolean not null default true,
  service_radius_km numeric(8,2) not null default 18,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists business_branches_business_active_idx on business_branches(business_id,active,accepting_orders);

create table if not exists delivery_pricing_rules (
  business_id uuid primary key references businesses(id) on delete cascade,
  base_fee_kes numeric(12,2) not null default 70,
  per_km_kes numeric(12,2) not null default 24,
  per_minute_kes numeric(12,2) not null default 0.90,
  minimum_fee_kes numeric(12,2) not null default 100,
  maximum_fee_kes numeric(12,2) not null default 450,
  rider_base_kes numeric(12,2) not null default 55,
  rider_per_km_kes numeric(12,2) not null default 17,
  rider_per_minute_kes numeric(12,2) not null default 0.85,
  rider_minimum_kes numeric(12,2) not null default 75,
  rider_maximum_kes numeric(12,2) not null default 500,
  fuel_reference_kes numeric(12,2) not null default 200,
  fuel_sensitivity numeric(8,4) not null default 0.35,
  customer_margin numeric(8,4) not null default 1.08,
  peak_multiplier numeric(8,4) not null default 1,
  service_radius_km numeric(8,2) not null default 18,
  auto_round_kes numeric(8,2) not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table orders add column if not exists branch_id uuid references business_branches(id) on delete set null;
alter table orders add column if not exists customer_lat numeric(10,7);
alter table orders add column if not exists customer_lng numeric(10,7);
alter table orders add column if not exists selected_branch_distance_meters integer;
alter table orders add column if not exists selected_branch_duration_seconds integer;

alter table delivery_quotes add column if not exists branch_id uuid references business_branches(id) on delete set null;
alter table delivery_quotes add column if not exists customer_lat numeric(10,7);
alter table delivery_quotes add column if not exists customer_lng numeric(10,7);
alter table delivery_quotes add column if not exists rider_earning_kes numeric(12,2) not null default 0;
alter table delivery_quotes add column if not exists pricing_mode text not null default 'MASTER';

insert into delivery_pricing_rules(business_id)
select id from businesses
on conflict(business_id) do nothing;

insert into business_branches(id,business_id,name,address,latitude,longitude,active,accepting_orders)
select gen_random_uuid(),id,'Main Branch',coalesce(pickup_address,name),-1.286389,36.817223,true,true
from businesses b
where b.slug='savanna-bites'
and not exists(select 1 from business_branches bb where bb.business_id=b.id);

update orders o set branch_id=q.branch_id,customer_lat=q.customer_lat,customer_lng=q.customer_lng
from delivery_quotes q where o.id=q.order_id and (o.branch_id is null or o.customer_lat is null);

create table if not exists geocoding_cache (
  id uuid primary key,
  address_key text unique not null,
  latitude numeric(10,7) not null,
  longitude numeric(10,7) not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);


-- Menu management, promotions, rider profiles and restaurant order stations.
create table if not exists menu_categories (
  id uuid primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  description text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,name)
);
alter table products add column if not exists category_id uuid references menu_categories(id) on delete set null;
alter table products add column if not exists featured boolean not null default false;
alter table products add column if not exists options jsonb not null default '[]'::jsonb;
alter table products add column if not exists updated_at timestamptz not null default now();
alter table riders add column if not exists profile_image_url text;
create index if not exists products_business_category_idx on products(business_id,category_id,active);
create index if not exists products_business_featured_idx on products(business_id,featured) where featured=true;

create table if not exists promotions (
  id uuid primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  type text not null check (type in ('PERCENT','FIXED','SPECIAL_PRICE','BUY_X_GET_Y','FREE_ITEM')),
  value numeric(12,2) not null default 0,
  min_order_kes numeric(12,2) not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  days_of_week integer[] not null default '{}',
  start_time time,
  end_time time,
  active boolean not null default true,
  banner_text text,
  product_ids jsonb not null default '[]'::jsonb,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists promotions_business_active_idx on promotions(business_id,active,starts_at,ends_at);

create table if not exists restaurant_order_stations (
  id uuid primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  device_type text not null check (device_type in ('PHONE','TABLET','PC','LAPTOP','TV','BOARD')),
  mode text not null default 'OPERATIONS' check (mode in ('OPERATIONS','KITCHEN','COUNTER','DISPLAY')),
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists restaurant_order_stations_business_idx on restaurant_order_stations(business_id,active,last_seen_at desc);

insert into menu_categories(id,business_id,name,sort_order) values
(gen_random_uuid(),'11111111-1111-4111-8111-111111111111','Mains',10),
(gen_random_uuid(),'11111111-1111-4111-8111-111111111111','Sides',20),
(gen_random_uuid(),'11111111-1111-4111-8111-111111111111','Drinks',30),
(gen_random_uuid(),'11111111-1111-4111-8111-111111111111','Desserts',40)
on conflict (business_id,name) do nothing;
update products p set category_id=c.id,updated_at=now() from menu_categories c where p.business_id=c.business_id and lower(coalesce(p.category,''))=lower(c.name) and p.category_id is null;
