-- Phase T: branch execution routing and branch-scoped order stations.
alter table delivery_zones
  add column if not exists branch_id uuid references business_branches(id) on delete cascade;

alter table restaurant_order_stations
  add column if not exists branch_id uuid references business_branches(id) on delete set null;

create index if not exists delivery_zones_branch_idx
  on delivery_zones(business_id,branch_id,active,priority desc);

create index if not exists restaurant_order_stations_branch_idx
  on restaurant_order_stations(business_id,branch_id,active,last_seen_at desc);

-- Existing delivery zones inherit the nearest active branch from their configured centre.
update delivery_zones z
set branch_id = b.id
from lateral (
  select bb.id
  from business_branches bb
  where bb.business_id=z.business_id
    and bb.active=true
    and z.center_latitude is not null
    and z.center_longitude is not null
  order by ((bb.latitude-z.center_latitude)*(bb.latitude-z.center_latitude)
          +(bb.longitude-z.center_longitude)*(bb.longitude-z.center_longitude))
  limit 1
) b
where z.branch_id is null
  and b.id is not null;

-- Existing stations inherit the restaurant's only/first active branch.
update restaurant_order_stations s
set branch_id = b.id
from lateral (
  select bb.id
  from business_branches bb
  where bb.business_id=s.business_id
    and bb.active=true
  order by bb.name
  limit 1
) b
where s.branch_id is null
  and b.id is not null;

-- Historical orders that predate branch routing are assigned to the nearest active branch
-- when customer coordinates exist; otherwise use the restaurant's first active branch.
update orders o
set branch_id = b.id
from lateral (
  select bb.id
  from business_branches bb
  where bb.business_id=o.business_id
    and bb.active=true
  order by
    case when o.customer_lat is not null and o.customer_lng is not null
      then ((bb.latitude-o.customer_lat)*(bb.latitude-o.customer_lat)
           +(bb.longitude-o.customer_lng)*(bb.longitude-o.customer_lng))
      else 0
    end,
    bb.name
  limit 1
) b
where o.branch_id is null
  and b.id is not null;
