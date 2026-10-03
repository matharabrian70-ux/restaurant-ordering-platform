-- Phase S: delivery quote expiry metadata used by order validation and cleanup.
-- Keep this idempotent so existing production databases can be upgraded safely.
alter table delivery_quotes
  add column if not exists expires_at timestamptz;

alter table delivery_quotes
  add column if not exists updated_at timestamptz not null default now();

update delivery_quotes
   set expires_at=coalesce(expires_at,created_at + interval '15 minutes'),
       updated_at=coalesce(updated_at,created_at,now())
 where expires_at is null;

create index if not exists delivery_quotes_expiry_idx
  on delivery_quotes(status,expires_at);

create index if not exists delivery_quotes_order_idx
  on delivery_quotes(order_id)
  where order_id is not null;
