-- Phase F: Customer Growth (36-42)
create table if not exists customer_sessions (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references customers(id) on delete cascade,
 business_id uuid not null references businesses(id) on delete cascade,
 token_hash text not null unique,
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index if not exists customer_sessions_lookup_idx on customer_sessions(customer_id,business_id,expires_at);

create table if not exists customer_addresses (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references customers(id) on delete cascade,
 business_id uuid not null references businesses(id) on delete cascade,
 label text not null,
 address_line text not null,
 latitude numeric(10,7),
 longitude numeric(10,7),
 delivery_note text,
 is_default boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists customer_addresses_customer_idx on customer_addresses(customer_id,business_id);

create table if not exists customer_loyalty_accounts (
 customer_id uuid not null references customers(id) on delete cascade,
 business_id uuid not null references businesses(id) on delete cascade,
 points bigint not null default 0 check(points>=0),
 lifetime_points bigint not null default 0 check(lifetime_points>=0),
 tier text not null default 'STANDARD',
 updated_at timestamptz not null default now(),
 primary key(customer_id,business_id)
);
create table if not exists customer_loyalty_ledger (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references customers(id) on delete cascade,
 business_id uuid not null references businesses(id) on delete cascade,
 points bigint not null,
 reason text not null,
 order_id uuid references orders(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists customer_loyalty_ledger_idx on customer_loyalty_ledger(customer_id,business_id,created_at desc);

create table if not exists gift_cards (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references businesses(id) on delete cascade,
 code text not null,
 initial_amount numeric(12,2) not null check(initial_amount>0),
 balance numeric(12,2) not null check(balance>=0),
 status text not null default 'ACTIVE' check(status in ('ACTIVE','EXHAUSTED','DISABLED')),
 expires_at timestamptz,
 created_at timestamptz not null default now(),
 unique(business_id,code)
);
create table if not exists customer_gift_cards (
 customer_id uuid not null references customers(id) on delete cascade,
 gift_card_id uuid not null references gift_cards(id) on delete cascade,
 assigned_at timestamptz not null default now(),
 primary key(customer_id,gift_card_id)
);

create table if not exists customer_coupons (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references businesses(id) on delete cascade,
 code text not null,
 discount_type text not null check(discount_type in ('PERCENT','FIXED')),
 discount_value numeric(12,2) not null check(discount_value>0),
 min_order_amount numeric(12,2) not null default 0 check(min_order_amount>=0),
 max_redemptions integer,
 redeemed_count integer not null default 0 check(redeemed_count>=0),
 active boolean not null default true,
 starts_at timestamptz not null default now(),
 expires_at timestamptz,
 unique(business_id,code)
);
create table if not exists customer_coupon_redemptions (
 id uuid primary key default gen_random_uuid(),
 coupon_id uuid not null references customer_coupons(id) on delete cascade,
 customer_id uuid not null references customers(id) on delete cascade,
 order_id uuid references orders(id) on delete set null,
 redeemed_at timestamptz not null default now(),
 unique(coupon_id,customer_id,order_id)
);

create table if not exists marketing_preferences (
 customer_id uuid not null references customers(id) on delete cascade,
 business_id uuid not null references businesses(id) on delete cascade,
 email_enabled boolean not null default true,
 sms_enabled boolean not null default true,
 push_enabled boolean not null default true,
 updated_at timestamptz not null default now(),
 primary key(customer_id,business_id)
);
create table if not exists marketing_automations (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references businesses(id) on delete cascade,
 trigger_code text not null check(trigger_code in ('WELCOME','FIRST_ORDER','REPEAT_ORDER','INACTIVE_CUSTOMER','LOYALTY_MILESTONE')),
 action_code text not null check(action_code in ('COUPON','LOYALTY_POINTS','MESSAGE')),
 active boolean not null default true,
 config jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

create table if not exists customer_feedback (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references customers(id) on delete cascade,
 business_id uuid not null references businesses(id) on delete cascade,
 order_id uuid references orders(id) on delete set null,
 rating integer not null check(rating between 1 and 5),
 comment text,
 created_at timestamptz not null default now(),
 unique(customer_id,order_id)
);
create index if not exists customer_feedback_business_idx on customer_feedback(business_id,created_at desc);
