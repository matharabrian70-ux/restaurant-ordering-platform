-- Phase S: Control Centre Data Isolation & Controlled Dispute Access
create table if not exists control_access_cases (
  id uuid primary key default gen_random_uuid(),
  case_reference text not null unique,
  business_id uuid not null references businesses(id) on delete cascade,
  target_order_id uuid references orders(id) on delete set null,
  category text not null check (category in ('DELIVERY_DISPUTE','REFUND_DISPUTE','SECURITY_INCIDENT','LEGAL_REQUEST','OTHER')),
  reason text not null,
  status text not null default 'OPEN' check (status in ('OPEN','ACTIVE','CLOSED','EXPIRED','DENIED')),
  requested_by_admin_id uuid references platform_admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists control_access_cases_business_idx on control_access_cases(business_id,created_at desc);
create index if not exists control_access_cases_status_idx on control_access_cases(status,created_at desc);
create table if not exists control_access_grants (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references control_access_cases(id) on delete cascade,
  admin_id uuid references platform_admin_users(id) on delete set null,
  scope text not null check (scope in ('ORDER_TIMELINE','DELIVERY_EVIDENCE','REFUND_EVIDENCE','LOCATION_DETAIL','CUSTOMER_CONTACT')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists control_access_grants_case_idx on control_access_grants(case_id,created_at desc);
create index if not exists control_access_grants_active_idx on control_access_grants(admin_id,case_id,expires_at) where revoked_at is null;
create table if not exists control_access_audit (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references control_access_cases(id) on delete set null,
  admin_id uuid references platform_admin_users(id) on delete set null,
  action text not null,
  scope text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists control_access_audit_case_idx on control_access_audit(case_id,created_at desc);
create index if not exists control_access_audit_created_idx on control_access_audit(created_at desc);
create or replace function prevent_control_access_audit_mutation() returns trigger language plpgsql as $$
begin raise exception 'control_access_audit is append-only'; end;
$$;
drop trigger if exists control_access_audit_immutable on control_access_audit;
create trigger control_access_audit_immutable before update or delete on control_access_audit for each row execute function prevent_control_access_audit_mutation();