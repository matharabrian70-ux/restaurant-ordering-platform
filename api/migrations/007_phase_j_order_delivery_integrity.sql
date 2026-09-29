-- Phase J: Order & Delivery Integrity
-- Bounded, database-enforced lifecycle and quote expiry.

alter table delivery_quotes
  add column if not exists expires_at timestamptz not null default (now() + interval '15 minutes');

update delivery_quotes
   set expires_at = coalesce(expires_at, created_at + interval '15 minutes')
 where expires_at is null;

create index if not exists delivery_quotes_active_expiry_idx
  on delivery_quotes(business_id,status,expires_at)
 where status='QUOTED';

create or replace function enforce_order_status_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if not (
    (old.status='NEW' and new.status in ('ACCEPTED','CANCELLED')) or
    (old.status='ACCEPTED' and new.status in ('OUT_FOR_DELIVERY','CANCELLED')) or
    (old.status='OUT_FOR_DELIVERY' and new.status in ('ACCEPTED','DELIVERED')) or
    (old.status='DELIVERED' and new.status='DELIVERED') or
    (old.status='CANCELLED' and new.status='CANCELLED')
  ) then
    raise exception 'Invalid order status transition: % -> %', old.status, new.status
      using errcode='23514';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_status_transition_guard on orders;
create trigger orders_status_transition_guard
before update of status on orders
for each row execute function enforce_order_status_transition();
