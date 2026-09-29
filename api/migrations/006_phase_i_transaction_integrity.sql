-- Phase I: Transaction & Payment Integrity
-- All changes are additive and safe to re-run.

-- Order creation idempotency is separate from payment idempotency.
create table if not exists order_idempotency_keys (
  business_id uuid not null references businesses(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  order_id uuid references orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id,idempotency_key)
);
create index if not exists order_idempotency_keys_order_idx
  on order_idempotency_keys(order_id);

-- Preserve the financial effect of customer-growth promotions on the order itself.
alter table orders add column if not exists coupon_id uuid references customer_coupons(id) on delete set null;
alter table orders add column if not exists coupon_discount numeric(12,2) not null default 0 check(coupon_discount>=0);
create index if not exists orders_coupon_idx on orders(coupon_id) where coupon_id is not null;

-- Future loyalty adjustments can be made idempotently without changing the existing earning rules.
alter table customer_loyalty_ledger add column if not exists source_key text;
create unique index if not exists customer_loyalty_ledger_source_idx
  on customer_loyalty_ledger(source_key) where source_key is not null;

-- Gift-card movements get an immutable transaction trail before balance-changing checkout
-- operations are introduced. No existing customer-facing gift-card behavior is changed here.
create table if not exists gift_card_transactions (
  id uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references gift_cards(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  transaction_type text not null check(transaction_type in ('REDEEM','SPEND','REFUND','ADJUSTMENT')),
  amount numeric(12,2) not null check(amount>0),
  idempotency_key text,
  created_at timestamptz not null default now()
);
create unique index if not exists gift_card_transactions_idempotency_idx
  on gift_card_transactions(idempotency_key) where idempotency_key is not null;
create index if not exists gift_card_transactions_card_idx
  on gift_card_transactions(gift_card_id,created_at desc);
