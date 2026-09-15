-- Restaurant Ordering Platform database blueprint
-- Designed for PostgreSQL. Keep business data separated by business_id.

create table businesses (
  id uuid primary key,
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create table customers (
  id uuid primary key,
  business_id uuid not null references businesses(id),
  name text not null,
  phone text not null,
  email text,
  created_at timestamptz not null default now(),
  unique (business_id, phone)
);

create table products (
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

create table orders (
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

create table order_items (
  id uuid primary key,
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id),
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null,
  options jsonb not null default '{}'::jsonb
);

create table riders (
  id uuid primary key,
  business_id uuid not null references businesses(id),
  name text not null,
  phone text,
  vehicle_type text,
  number_plate text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table rider_trips (
  id uuid primary key,
  rider_id uuid not null references riders(id),
  order_id uuid not null references orders(id),
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  confirmed_by text
);

create table payments (
  id uuid primary key,
  order_id uuid not null references orders(id) on delete cascade,
  provider text not null,
  provider_reference text,
  amount numeric(12,2) not null,
  status text not null default 'PENDING',
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table receipts (
  id uuid primary key,
  order_id uuid not null unique references orders(id),
  receipt_number text not null unique,
  amount numeric(12,2) not null,
  issued_at timestamptz not null default now()
);

create index orders_business_created_idx on orders(business_id, created_at desc);
create index orders_customer_idx on orders(customer_id, created_at desc);
create index customers_phone_idx on customers(business_id, phone);
create index customers_email_idx on customers(business_id, email);
create index riders_business_idx on riders(business_id, active);
create index trips_rider_idx on rider_trips(rider_id, completed_at desc);

-- Archive query pattern: newest delivered orders for a business.
-- Search should normalize phone/email before querying in application code.
