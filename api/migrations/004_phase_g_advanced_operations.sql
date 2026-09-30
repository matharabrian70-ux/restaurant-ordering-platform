-- Phase G: Advanced Restaurant Operations (43-49)
create table if not exists restaurant_reservations (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references businesses(id) on delete cascade,
 customer_id uuid references customers(id) on delete set null,
 customer_name text not null,
 phone text not null,
 email text,
 reservation_date date not null,
 reservation_time time not null,
 party_size integer not null check(party_size between 1 and 100),
 table_id uuid references restaurant_tables(id) on delete set null,
 status text not null default 'PENDING' check(status in ('PENDING','CONFIRMED','SEATED','COMPLETED','CANCELLED','NO_SHOW','WAITLISTED')),
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists restaurant_reservations_business_time_idx
 on restaurant_reservations(business_id,reservation_date,reservation_time,status);

create table if not exists restaurant_waitlist (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references businesses(id) on delete cascade,
 customer_id uuid references customers(id) on delete set null,
 customer_name text not null,
 phone text not null,
 party_size integer not null check(party_size between 1 and 100),
 requested_for timestamptz,
 estimated_wait_minutes integer check(estimated_wait_minutes is null or estimated_wait_minutes>=0),
 status text not null default 'WAITING' check(status in ('WAITING','NOTIFIED','SEATED','CANCELLED','EXPIRED')),
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists restaurant_waitlist_queue_idx
 on restaurant_waitlist(business_id,status,created_at);

create table if not exists catering_requests (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references businesses(id) on delete cascade,
 customer_id uuid references customers(id) on delete set null,
 customer_name text not null,
 phone text not null,
 email text,
 event_date date not null,
 guest_count integer not null check(guest_count between 1 and 10000),
 menu_notes text,
 budget numeric(12,2) check(budget is null or budget>=0),
 status text not null default 'PENDING' check(status in ('PENDING','QUOTED','CONFIRMED','COMPLETED','CANCELLED')),
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists catering_requests_business_date_idx
 on catering_requests(business_id,event_date,status);

create table if not exists scheduled_orders (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references businesses(id) on delete cascade,
 customer_id uuid references customers(id) on delete set null,
 customer_name text not null,
 phone text not null,
 email text,
 scheduled_for timestamptz not null,
 order_payload jsonb not null,
 status text not null default 'SCHEDULED' check(status in ('SCHEDULED','PROCESSING','COMPLETED','CANCELLED')),
 order_id uuid references orders(id) on delete set null,
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists scheduled_orders_due_idx
 on scheduled_orders(business_id,scheduled_for,status);

create table if not exists aggregator_integrations (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references businesses(id) on delete cascade,
 channel_code text not null,
 display_name text not null,
 active boolean not null default true,
 webhook_token_hash text not null,
 config jsonb not null default '{}'::jsonb,
 last_received_at timestamptz,
 created_at timestamptz not null default now(),
 unique(business_id,channel_code)
);

create table if not exists aggregator_orders (
 id uuid primary key default gen_random_uuid(),
 integration_id uuid not null references aggregator_integrations(id) on delete cascade,
 external_order_id text not null,
 business_id uuid not null references businesses(id) on delete cascade,
 payload jsonb not null,
 status text not null default 'RECEIVED' check(status in ('RECEIVED','ACCEPTED','REJECTED','IMPORTED')),
 received_at timestamptz not null default now(),
 unique(integration_id,external_order_id)
);
create index if not exists aggregator_orders_business_idx
 on aggregator_orders(business_id,received_at desc);

create table if not exists delivery_zones (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references businesses(id) on delete cascade,
 name text not null,
 zone_type text not null default 'RADIUS' check(zone_type in ('RADIUS','POLYGON')),
 active boolean not null default true,
 fee numeric(12,2) not null default 0 check(fee>=0),
 minimum_order numeric(12,2) not null default 0 check(minimum_order>=0),
 radius_meters numeric(12,2) check(radius_meters is null or radius_meters>0),
 center_latitude numeric(10,7),
 center_longitude numeric(10,7),
 polygon jsonb,
 priority integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists delivery_zones_business_idx on delivery_zones(business_id,active,priority desc);

create table if not exists proof_of_delivery (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references businesses(id) on delete cascade,
 order_id uuid not null references orders(id) on delete cascade,
 rider_id uuid references riders(id) on delete set null,
 proof_type text not null check(proof_type in ('RECIPIENT','PHOTO','SIGNATURE','NOTE')),
 recipient_name text,
 photo_url text,
 signature_data text,
 note text,
 latitude numeric(10,7),
 longitude numeric(10,7),
 captured_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create index if not exists proof_of_delivery_order_idx on proof_of_delivery(order_id,created_at desc);
