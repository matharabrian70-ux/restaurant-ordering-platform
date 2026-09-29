-- Phase B: Restaurant Core
alter table orders add column if not exists order_type_code text;
alter table orders add column if not exists table_id uuid;
alter table orders add column if not exists source text not null default 'ONLINE';
alter table orders add column if not exists pos_operation_id text;
create index if not exists orders_business_order_type_idx on orders(business_id,order_type_code,created_at desc);
create index if not exists orders_business_table_idx on orders(business_id,table_id) where table_id is not null;
create unique index if not exists orders_business_pos_operation_idx on orders(business_id,pos_operation_id) where pos_operation_id is not null;
alter table order_items add column if not exists modifiers jsonb not null default '[]'::jsonb;
alter table order_items add column if not exists combo_id uuid;

create table if not exists restaurant_order_types (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
 code text not null, name text not null, active boolean not null default true, sort_order integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(business_id,code)
);
create table if not exists restaurant_tables (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
 table_number text not null, label text, capacity integer not null default 2 check(capacity>0 and capacity<=100),
 status text not null default 'AVAILABLE' check(status in ('AVAILABLE','OCCUPIED','RESERVED','CLEANING','OUT_OF_SERVICE')),
 active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(business_id,table_number)
);
create index if not exists restaurant_tables_business_idx on restaurant_tables(business_id,active,status,table_number);

create table if not exists modifier_groups (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
 name text not null, min_selections integer not null default 0 check(min_selections>=0),
 max_selections integer not null default 1 check(max_selections>=min_selections), required boolean not null default false,
 active boolean not null default true, sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists modifier_options (
 id uuid primary key default gen_random_uuid(), group_id uuid not null references modifier_groups(id) on delete cascade,
 name text not null, price numeric(12,2) not null default 0 check(price>=0), active boolean not null default true,
 sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists menu_item_modifier_groups (
 product_id uuid not null references products(id) on delete cascade,
 group_id uuid not null references modifier_groups(id) on delete cascade,
 sort_order integer not null default 0, primary key(product_id,group_id)
);
create table if not exists menu_combos (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
 name text not null, description text, price numeric(12,2) not null check(price>=0), active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists menu_combo_items (
 combo_id uuid not null references menu_combos(id) on delete cascade,
 product_id uuid not null references products(id) on delete restrict, quantity integer not null default 1 check(quantity>0 and quantity<=100),
 primary key(combo_id,product_id)
);
create table if not exists kds_stations (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
 name text not null, station_type text not null default 'KITCHEN', active boolean not null default true,
 created_at timestamptz not null default now(), unique(business_id,name)
);
create table if not exists kds_tickets (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
 order_id uuid not null references orders(id) on delete cascade, station_id uuid references kds_stations(id) on delete set null,
 status text not null default 'NEW' check(status in ('NEW','ACCEPTED','PREPARING','READY','VOID')),
 priority integer not null default 0, fired_at timestamptz not null default now(), accepted_at timestamptz, started_at timestamptz,
 ready_at timestamptz, updated_at timestamptz not null default now(), unique(order_id,station_id)
);
create index if not exists kds_tickets_queue_idx on kds_tickets(business_id,status,priority desc,fired_at);
create table if not exists kds_ticket_items (
 id uuid primary key default gen_random_uuid(), ticket_id uuid not null references kds_tickets(id) on delete cascade,
 order_item_id uuid not null references order_items(id) on delete cascade, quantity integer not null check(quantity>0),
 item_name text not null, modifiers jsonb not null default '[]'::jsonb, status text not null default 'NEW'
 check(status in ('NEW','PREPARING','READY','VOID')), created_at timestamptz not null default now()
);
create table if not exists pos_offline_operations (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
 operation_id text not null, operation_type text not null, payload jsonb not null,
 status text not null default 'PENDING' check(status in ('PENDING','APPLIED','FAILED')), result jsonb, error text,
 created_at timestamptz not null default now(), applied_at timestamptz, unique(business_id,operation_id)
);
create index if not exists pos_offline_operations_business_idx on pos_offline_operations(business_id,status,created_at);

insert into restaurant_order_types(business_id,code,name,sort_order) select id,'DINE_IN','Dine-in',1 from businesses on conflict(business_id,code) do nothing;
insert into restaurant_order_types(business_id,code,name,sort_order) select id,'TAKEAWAY','Takeaway',2 from businesses on conflict(business_id,code) do nothing;
insert into restaurant_order_types(business_id,code,name,sort_order) select id,'DELIVERY','Delivery',3 from businesses on conflict(business_id,code) do nothing;
