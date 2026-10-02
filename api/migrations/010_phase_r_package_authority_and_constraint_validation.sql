-- Phase R: canonical package entitlements and production constraint validation.
-- businesses.plan_key is authoritative. package_type is retained only as a deprecated
-- compatibility column so older integrations can be migrated without destructive DDL.

alter table businesses add column if not exists plan_key text;
update businesses
   set plan_key = case
     when upper(coalesce(package_type,''))='ADVANCED' then 'GROWTH'
     when upper(coalesce(package_type,''))='DIGITAL_ORDERING' then 'STARTER'
     else coalesce(nullif(upper(plan_key),''),'STARTER')
   end
 where plan_key is null or trim(plan_key)='';

alter table businesses alter column plan_key set default 'STARTER';
alter table businesses alter column plan_key set not null;

insert into platform_packages(key,name,description,monthly_price_kes,features)
values
  ('STARTER','Starter','Core online ordering',0,'{}'::jsonb),
  ('GROWTH','Growth','Ordering plus delivery operations',3500,'{}'::jsonb),
  ('PRO','Pro','Full restaurant operations platform',7500,'{}'::jsonb)
on conflict(key) do nothing;

-- Replace the package feature JSON with one canonical matrix. No capability is
-- granted by businesses.package_type or business_features.
update platform_packages set features='{"ordering":true,"digitalOrdering":true,"tenantIsolation":true,"websiteIntegration":true,"auditTrail":true}'::jsonb,updated_at=now() where key='STARTER';
update platform_packages set features='{"ordering":true,"digitalOrdering":true,"advancedDelivery":true,"branchRouting":true,"riderModule":true,"riderTracking":true,"sms":true,"advancedAnalytics":true,"customDomain":true,"apiIntegrations":true,"auditTrail":true,"tenantIsolation":true,"websiteIntegration":true}'::jsonb,updated_at=now() where key='GROWTH';
update platform_packages set features='{"ordering":true,"digitalOrdering":true,"advancedDelivery":true,"branchRouting":true,"riderModule":true,"riderTracking":true,"sms":true,"advancedAnalytics":true,"customDomain":true,"apiIntegrations":true,"auditTrail":true,"tenantIsolation":true,"websiteIntegration":true,"multiBranch":true,"prioritySupport":true,"automation":true}'::jsonb,updated_at=now() where key='PRO';

-- Validate legacy constraints now that historical data has had a chance to be cleaned.
-- VALIDATE CONSTRAINT is intentionally explicit: if historical violations remain,
-- this migration fails instead of silently declaring the database hardened.
alter table payments validate constraint payments_amount_nonnegative;
alter table refunds validate constraint refunds_amount_nonnegative;
alter table manager_users validate constraint manager_users_role_check;
alter table platform_admin_users validate constraint platform_admin_users_role_check;
alter table orders validate constraint orders_customer_tenant_fk;
alter table products validate constraint products_price_nonnegative;
alter table orders validate constraint orders_amounts_nonnegative;
alter table order_items validate constraint order_items_amount_nonnegative;
