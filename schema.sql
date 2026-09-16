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

-- Demo business used by the current Savanna Bites prototype.
insert into businesses (id, name, slug)
values ('11111111-1111-4111-8111-111111111111', 'Savanna Bites', 'savanna-bites')
on conflict (slug) do nothing;

-- Demo riders used by the current prototype. These are clearly marked as demo records.
insert into riders (id, business_id, name, phone, vehicle_type, number_plate, active)
values
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Demo Rider A', '+254700000001', 'Motorbike', 'DEMO-001', true),
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Demo Rider B', '+254700000002', 'Motorbike', 'DEMO-002', true)
on conflict (id) do nothing;

-- Archive query pattern: newest delivered orders for a business.
-- Search should normalize phone/email before querying in application code.
