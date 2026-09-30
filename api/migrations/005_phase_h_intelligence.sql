-- Phase H: Intelligence (50-55)
create table if not exists restaurant_branches (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references businesses(id) on delete cascade,
 name text not null,
 code text not null,
 active boolean not null default true,
 address text,
 latitude numeric(10,7),
 longitude numeric(10,7),
 created_at timestamptz not null default now(),
 unique(business_id,code)
);
alter table orders add column if not exists branch_id uuid references restaurant_branches(id) on delete set null;
create index if not exists orders_business_branch_created_idx on orders(business_id,branch_id,created_at desc);

create table if not exists intelligence_product_settings (
 business_id uuid not null references businesses(id) on delete cascade,
 product_id uuid not null references products(id) on delete cascade,
 unit_cost numeric(12,2) not null default 0 check(unit_cost>=0),
 stock_on_hand numeric(12,2) not null default 0 check(stock_on_hand>=0),
 reorder_point numeric(12,2) not null default 0 check(reorder_point>=0),
 lead_time_days numeric(8,2) not null default 1 check(lead_time_days>0),
 target_days numeric(8,2) not null default 7 check(target_days>0),
 updated_at timestamptz not null default now(),
 primary key(business_id,product_id)
);

create table if not exists intelligence_snapshots (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references businesses(id) on delete cascade,
 snapshot_date date not null,
 revenue numeric(14,2) not null default 0,
 orders_count integer not null default 0,
 completed_orders integer not null default 0,
 average_order_value numeric(12,2) not null default 0,
 anomaly_count integer not null default 0,
 created_at timestamptz not null default now(),
 unique(business_id,snapshot_date)
);

create table if not exists intelligence_anomalies (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references businesses(id) on delete cascade,
 detected_at timestamptz not null default now(),
 anomaly_type text not null,
 severity text not null check(severity in ('LOW','MEDIUM','HIGH')),
 metric text not null,
 observed_value numeric(14,2),
 expected_value numeric(14,2),
 explanation text not null,
 resolved_at timestamptz
);
create index if not exists intelligence_anomalies_business_idx on intelligence_anomalies(business_id,detected_at desc);

create index if not exists intelligence_settings_business_idx on intelligence_product_settings(business_id,product_id);
