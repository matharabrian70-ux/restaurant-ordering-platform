-- Phase U: multi-manager governance, branch context, device ownership and manager audit trail.

alter table restaurant_order_stations
  add column if not exists branch_id uuid references business_branches(id) on delete set null;

create index if not exists restaurant_order_stations_branch_idx
  on restaurant_order_stations(business_id,branch_id,active,last_seen_at desc);

-- Every station must belong to a real active branch before it can execute orders.
update restaurant_order_stations s
set branch_id=b.id
from lateral (
  select bb.id
  from business_branches bb
  where bb.business_id=s.business_id and bb.active=true
  order by bb.name
  limit 1
) b
where s.branch_id is null and b.id is not null;

create table if not exists manager_audit_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  manager_id uuid references manager_users(id) on delete set null,
  manager_name text,
  manager_email text,
  action text not null,
  method text not null,
  path text not null,
  branch_id uuid references business_branches(id) on delete set null,
  severity text not null default 'NORMAL' check (severity in ('NORMAL','MAJOR','SECURITY')),
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists manager_audit_business_idx on manager_audit_events(business_id,created_at desc);
create index if not exists manager_audit_manager_idx on manager_audit_events(manager_id,created_at desc);
create index if not exists manager_audit_branch_idx on manager_audit_events(branch_id,created_at desc);

create table if not exists manager_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  manager_id uuid references manager_users(id) on delete set null,
  audit_event_id uuid references manager_audit_events(id) on delete cascade,
  channel text not null check (channel in ('IN_APP','EMAIL')),
  status text not null default 'PENDING' check (status in ('PENDING','SENT','FAILED','SKIPPED')),
  subject text,
  message text not null,
  delivered_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists manager_notifications_business_idx on manager_notifications(business_id,created_at desc);
create index if not exists manager_notifications_manager_idx on manager_notifications(manager_id,created_at desc);

alter table manager_users add column if not exists updated_at timestamptz not null default now();
