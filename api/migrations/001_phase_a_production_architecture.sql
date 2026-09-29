-- Phase A: production architecture foundation.
-- Applied by api/migrate.js. Safe to run more than once.

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

alter table payments add column if not exists idempotency_key text;
alter table payments add column if not exists authorization_url text;
alter table payments add column if not exists payment_mode text;
create unique index if not exists payments_idempotency_key_idx
  on payments(idempotency_key) where idempotency_key is not null;
create unique index if not exists payments_active_order_provider_idx
  on payments(order_id,provider)
  where status in ('INITIALIZING','PENDING');

create table if not exists outbox_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text,
  aggregate_id uuid,
  business_id uuid references businesses(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','PUBLISHED','FAILED')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists outbox_events_pending_idx
  on outbox_events(status,available_at,created_at);
create index if not exists outbox_events_business_idx
  on outbox_events(business_id,created_at desc);

create table if not exists paystack_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text,
  event_type text not null,
  resource_id text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(event_type,resource_id)
);
create index if not exists paystack_webhook_events_received_idx
  on paystack_webhook_events(received_at desc);

create table if not exists telemetry_access_tokens (
  token_hash text primary key,
  scope text not null check (scope in ('MANAGER','RIDER','STATION','PLATFORM')),
  business_id uuid references businesses(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists telemetry_access_tokens_expiry_idx
  on telemetry_access_tokens(expires_at);

-- Financial/order invariants for new writes.
alter table payments drop constraint if exists payments_amount_nonnegative;
alter table payments add constraint payments_amount_nonnegative
  check (amount >= 0) not valid;
alter table refunds drop constraint if exists refunds_amount_nonnegative;
alter table refunds add constraint refunds_amount_nonnegative
  check (amount > 0) not valid;
alter table orders drop constraint if exists orders_paid_requires_payment;
alter table orders add constraint orders_paid_requires_payment
  check (payment_status <> 'PAID' or status <> 'CANCELLED') not valid;
