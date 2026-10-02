-- Phase Q: Compliance foundation
-- Creates auditable privacy, consent, data-rights, processor and breach records.
-- Legal text is intentionally maintained separately so counsel can review it without code changes.

create table if not exists business_privacy_settings (
  business_id uuid primary key references businesses(id) on delete cascade,
  privacy_contact_email text,
  dpo_contact_email text,
  controller_legal_name text,
  controller_address text,
  support_email text,
  support_phone text,
  complaints_email text,
  contracting_party_notice text,
  privacy_notice_version text not null default '2026-10-02-v1',
  terms_version text not null default '2026-10-02-v1',
  cookie_policy_version text not null default '2026-10-02-v1',
  marketing_enabled boolean not null default true,
  retention_customer_days integer not null default 730 check (retention_customer_days between 30 and 3650),
  retention_order_days integer not null default 2555 check (retention_order_days between 365 and 3650),
  live_gps_retention_hours integer not null default 24 check (live_gps_retention_hours between 1 and 168),
  odpc_controller_status text not null default 'NOT_REVIEWED',
  odpc_processor_status text not null default 'NOT_REVIEWED',
  odpc_controller_certificate text,
  odpc_processor_certificate text,
  cross_border_transfer_notice text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists privacy_consents (
  id uuid primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  subject_phone text,
  subject_email text,
  consent_type text not null check (consent_type in ('TERMS','PRIVACY_NOTICE','MARKETING_SMS','MARKETING_EMAIL','COOKIES','LOCATION')),
  version text not null,
  granted boolean not null,
  source text not null default 'WEB_CHECKOUT',
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists privacy_consents_business_subject_idx on privacy_consents(business_id,subject_phone,created_at desc);
create index if not exists privacy_consents_order_idx on privacy_consents(order_id,created_at desc);

create table if not exists data_subject_requests (
  id uuid primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  request_type text not null check (request_type in ('ACCESS','RECTIFICATION','ERASURE','OBJECTION','RESTRICTION','PORTABILITY')),
  status text not null default 'OPEN' check (status in ('OPEN','VERIFYING','IN_PROGRESS','COMPLETED','REJECTED')),
  requester_name text,
  requester_email text,
  requester_phone text,
  details text,
  verification_note text,
  response_note text,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists data_subject_requests_business_status_idx on data_subject_requests(business_id,status,created_at desc);

create table if not exists compliance_processors (
  id uuid primary key,
  name text not null,
  purpose text not null,
  data_categories text not null,
  jurisdictions text,
  transfer_safeguard text,
  agreement_status text not null default 'REVIEW_REQUIRED',
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists privacy_incidents (
  id uuid primary key,
  business_id uuid references businesses(id) on delete set null,
  severity text not null default 'MEDIUM',
  status text not null default 'OPEN',
  discovered_at timestamptz not null default now(),
  notified_odpc_at timestamptz,
  data_subjects_notified_at timestamptz,
  description text not null,
  affected_data text,
  affected_subjects integer,
  containment_actions text,
  remediation_actions text,
  regulator_reference text,
  created_by text,
  updated_at timestamptz not null default now()
);

create index if not exists privacy_incidents_business_idx on privacy_incidents(business_id,status,discovered_at desc);

alter table orders add column if not exists privacy_notice_version text;
alter table orders add column if not exists terms_version text;
alter table orders add column if not exists legal_accepted_at timestamptz;
alter table orders add column if not exists marketing_opt_in boolean not null default false;
alter table business_privacy_settings add column if not exists odpc_controller_status text not null default 'NOT_REVIEWED';
alter table business_privacy_settings add column if not exists odpc_processor_status text not null default 'NOT_REVIEWED';
alter table business_privacy_settings add column if not exists odpc_controller_certificate text;
alter table business_privacy_settings add column if not exists odpc_processor_certificate text;
alter table business_privacy_settings add column if not exists controller_legal_name text;
alter table business_privacy_settings add column if not exists controller_address text;
alter table business_privacy_settings add column if not exists support_email text;
alter table business_privacy_settings add column if not exists support_phone text;
alter table business_privacy_settings add column if not exists complaints_email text;
alter table business_privacy_settings add column if not exists contracting_party_notice text;

update business_privacy_settings set privacy_notice_version='2026-10-02-v1',terms_version='2026-10-02-v1',cookie_policy_version='2026-10-02-v1',updated_at=now();

insert into compliance_processors(id,name,purpose,data_categories,jurisdictions,transfer_safeguard)
select gen_random_uuid(),'Paystack','Payment processing and payment status confirmation','Customer name, email, phone, order/payment identifiers','Potential cross-border processing','Verify current contractual transfer safeguards before launch'
where not exists(select 1 from compliance_processors where lower(name)='paystack');

insert into compliance_processors(id,name,purpose,data_categories,jurisdictions,transfer_safeguard)
select gen_random_uuid(),'Google Maps Platform','Address geocoding and route calculation where enabled','Delivery address and route coordinates','Potential cross-border processing','Verify current contractual transfer safeguards before launch'
where not exists(select 1 from compliance_processors where lower(name)='google maps platform');

insert into compliance_processors(id,name,purpose,data_categories,jurisdictions,transfer_safeguard)
select gen_random_uuid(),'Africa''s Talking','Transactional rider SMS where enabled','Rider name, phone, order reference','Potential cross-border processing','Verify current contractual transfer safeguards before launch'
where not exists(select 1 from compliance_processors where lower(name)='africa''s talking');

insert into compliance_processors(id,name,purpose,data_categories,jurisdictions,transfer_safeguard)
select gen_random_uuid(),'Render','Backend hosting and application operations','Application data processed by the API/database environment','Depends on deployment region','Confirm hosting region, DPA and transfer safeguards before launch'
where not exists(select 1 from compliance_processors where lower(name)='render');
