import crypto from 'node:crypto';

const CATEGORIES=new Set(['DELIVERY_DISPUTE','REFUND_DISPUTE','SECURITY_INCIDENT','LEGAL_REQUEST','OTHER']);
const SCOPES=new Set(['ORDER_TIMELINE','DELIVERY_EVIDENCE','REFUND_EVIDENCE','LOCATION_DETAIL','CUSTOMER_CONTACT']);
const OWNER_ONLY=new Set(['LOCATION_DETAIL','CUSTOMER_CONTACT']);
const MAX_ACCESS_MINUTES=30;
function clean(value,max=500){return String(value??'').trim().slice(0,max);}
function maskId(value){const v=String(value||'');return v.length<=8?'••••':v.slice(0,4)+'••••'+v.slice(-4);}
function caseReference(){return 'CASE-'+new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();}

async function ensureControlDataIsolationSchema(pool){
  await pool.query("create table if not exists control_access_cases (id uuid primary key default gen_random_uuid(),case_reference text not null unique,business_id uuid not null references businesses(id) on delete cascade,target_order_id uuid references orders(id) on delete set null,category text not null check (category in ('DELIVERY_DISPUTE','REFUND_DISPUTE','SECURITY_INCIDENT','LEGAL_REQUEST','OTHER')),reason text not null,status text not null default 'OPEN' check (status in ('OPEN','ACTIVE','CLOSED','EXPIRED','DENIED')),requested_by_admin_id uuid references platform_admin_users(id) on delete set null,created_at timestamptz not null default now(),closed_at timestamptz);");
  await pool.query("create index if not exists control_access_cases_business_idx on control_access_cases(business_id,created_at desc);");
  await pool.query("create index if not exists control_access_cases_status_idx on control_access_cases(status,created_at desc);");
  await pool.query("create table if not exists control_access_grants (id uuid primary key default gen_random_uuid(),case_id uuid not null references control_access_cases(id) on delete cascade,admin_id uuid references platform_admin_users(id) on delete set null,scope text not null check (scope in ('ORDER_TIMELINE','DELIVERY_EVIDENCE','REFUND_EVIDENCE','LOCATION_DETAIL','CUSTOMER_CONTACT')),expires_at timestamptz not null,created_at timestamptz not null default now(),revoked_at timestamptz);");
  await pool.query("create index if not exists control_access_grants_case_idx on control_access_grants(case_id,created_at desc);");
  await pool.query("create index if not exists control_access_grants_active_idx on control_access_grants(admin_id,case_id,expires_at) where revoked_at is null;");
  await pool.query("create table if not exists control_access_audit (id uuid primary key default gen_random_uuid(),case_id uuid references control_access_cases(id) on delete set null,admin_id uuid references platform_admin_users(id) on delete set null,action text not null,scope text,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());");
  await pool.query("create index if not exists control_access_audit_case_idx on control_access_audit(case_id,created_at desc);");
  await pool.query("create index if not exists control_access_audit_created_idx on control_access_audit(created_at desc);");
  await pool.query("create or replace function prevent_control_access_audit_mutation() returns trigger language plpgsql as $$ begin raise exception 'control_access_audit is append-only'; end; $$;");
  await pool.query("drop trigger if exists control_access_audit_immutable on control_access_audit;");
  await pool.query("create trigger control_access_audit_immutable before update or delete on control_access_audit for each row execute function prevent_control_access_audit_mutation();");
}

async function audit(pool,{caseId=null,adminId=null,action,scope=null,metadata={}}){
  await pool.query('insert into control_access_audit(case_id,admin_id,action,scope,metadata) values($1,$2,$3,$4,$5)',[caseId,adminId,action,scope,metadata]);
}
async function activeGrant(pool,caseId,adminId,scope){
  const r=await pool.query("select g.id,g.expires_at,c.target_order_id,c.business_id,c.status from control_access_grants g join control_access_cases c on c.id=g.case_id where g.case_id=$1 and g.admin_id=$2 and g.scope=$3 and g.revoked_at is null and g.expires_at>now() and c.status in ('OPEN','ACTIVE') order by g.created_at desc limit 1",[caseId,adminId,scope]);
  return r.rows[0]||null;
}
async function caseRow(pool,id){
  const r=await pool.query("select c.id,c.case_reference,c.business_id,c.target_order_id,c.category,c.reason,c.status,c.created_at,c.closed_at,b.name as business_name,b.slug as business_slug from control_access_cases c join businesses b on b.id=c.business_id where c.id=$1 limit 1",[id]);
  return r.rows[0]||null;
}

function registerControlDataIsolation(app,pool,{requireControl,requireControlRole,recordPlatformAudit}){
  app.get('/api/control/disputes',requireControl,async(req,res)=>{
    try{
      const status=clean(req.query.status,20).toUpperCase()||'OPEN';
      if(!new Set(['OPEN','ACTIVE','CLOSED','EXPIRED','DENIED','ALL']).has(status))return res.status(400).json({error:'Invalid dispute status'});
      const params=[]; let where='';
      if(status!=='ALL'){params.push(status);where='where c.status=$1';}
      params.push(req.controlAdmin.id);
      const r=await pool.query("select c.id,c.case_reference,c.category,c.status,c.created_at,c.closed_at,b.id as business_id,b.name as business_name,exists(select 1 from control_access_grants g where g.case_id=c.id and g.admin_id=$"+(params.length)+" and g.revoked_at is null and g.expires_at>now()) as has_active_access from control_access_cases c join businesses b on b.id=c.business_id "+where+" order by c.created_at desc limit 100",params);
      res.json(r.rows);
    }catch(e){res.status(500).json({error:e.message||'Unable to load dispute cases'});}
  });

  app.post('/api/control/disputes',requireControl,async(req,res)=>{
    try{
      const businessId=clean(req.body.businessId,80),orderNumber=clean(req.body.orderNumber,100),category=clean(req.body.category,40).toUpperCase(),reason=clean(req.body.reason,1000);
      if(!businessId||!orderNumber||!CATEGORIES.has(category)||reason.length<10)return res.status(400).json({error:'Restaurant, order reference, dispute category and a clear reason are required'});
      const order=await pool.query('select id,business_id from orders where business_id=$1 and order_number=$2 limit 1',[businessId,orderNumber]);
      if(!order.rowCount)return res.status(404).json({error:'The specified order could not be found for that restaurant'});
      const reference=caseReference();
      const c=await pool.query('insert into control_access_cases(id,case_reference,business_id,target_order_id,category,reason,requested_by_admin_id) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6) returning id,case_reference,category,status,created_at',[reference,businessId,order.rows[0].id,category,reason,req.controlAdmin.id]);
      await audit(pool,{caseId:c.rows[0].id,adminId:req.controlAdmin.id,action:'CASE_CREATED',metadata:{category,reasonLength:reason.length}});
      await recordPlatformAudit(req.controlAdmin.id,businessId,'DISPUTE_CASE_CREATED','Controlled evidence case created',{caseId:c.rows[0].id,category});
      res.status(201).json({case:c.rows[0]});
    }catch(e){res.status(500).json({error:e.message||'Unable to create dispute case'});}
  });

  app.get('/api/control/disputes/:id',requireControl,async(req,res)=>{
    try{
      const c=await caseRow(pool,req.params.id);
      if(!c)return res.status(404).json({error:'Dispute case not found'});
      const grants=await pool.query('select scope,created_at,expires_at,revoked_at from control_access_grants where case_id=$1 and admin_id=$2 order by created_at desc',[c.id,req.controlAdmin.id]);
      const auditRows=await pool.query('select action,scope,metadata,created_at from control_access_audit where case_id=$1 order by created_at desc limit 50',[c.id]);
      res.json({case:{id:c.id,caseReference:c.case_reference,businessId:c.business_id,businessName:c.business_name,businessSlug:c.business_slug,category:c.category,reason:c.reason,status:c.status,createdAt:c.created_at,closedAt:c.closed_at},grants:grants.rows,audit:auditRows.rows});
    }catch(e){res.status(500).json({error:e.message||'Unable to load dispute case'});}
  });

  app.post('/api/control/disputes/:id/access',requireControl,async(req,res)=>{
    try{
      const c=await caseRow(pool,req.params.id); if(!c)return res.status(404).json({error:'Dispute case not found'});
      const scope=clean(req.body.scope,40).toUpperCase(),minutes=Math.min(Math.max(Number(req.body.minutes||15),1),MAX_ACCESS_MINUTES);
      if(!SCOPES.has(scope))return res.status(400).json({error:'Invalid evidence scope'});
      if(OWNER_ONLY.has(scope)&&String(req.controlAdmin.role).toUpperCase()!=='PLATFORM_OWNER')return res.status(403).json({error:'This evidence scope requires platform owner authorization'});
      const grant=await pool.query('insert into control_access_grants(id,case_id,admin_id,scope,expires_at) values(gen_random_uuid(),$1,$2,$3,now()+make_interval(mins => $4)) returning id,scope,expires_at',[c.id,req.controlAdmin.id,scope,minutes]);
      await pool.query("update control_access_cases set status='ACTIVE' where id=$1 and status='OPEN'",[c.id]);
      await audit(pool,{caseId:c.id,adminId:req.controlAdmin.id,action:'ACCESS_GRANTED',scope,metadata:{minutes}});
      await recordPlatformAudit(req.controlAdmin.id,c.business_id,'DISPUTE_EVIDENCE_ACCESS_GRANTED','Time-limited dispute evidence access granted',{caseId:c.id,scope,minutes});
      res.json({grant:grant.rows[0]});
    }catch(e){res.status(500).json({error:e.message||'Unable to grant evidence access'});}
  });

  app.get('/api/control/disputes/:id/evidence',requireControl,async(req,res)=>{
    try{
      const scope=clean(req.query.scope,40).toUpperCase(); if(!SCOPES.has(scope))return res.status(400).json({error:'Invalid evidence scope'});
      const grant=await activeGrant(pool,req.params.id,req.controlAdmin.id,scope); if(!grant)return res.status(403).json({error:'Active evidence access is required for this scope'});
      const base=await pool.query('select id,order_number,status,payment_status,delivery_status,created_at,accepted_at,out_for_delivery_at,delivered_at from orders where id=$1 and business_id=$2 limit 1',[grant.target_order_id,grant.business_id]);
      if(!base.rowCount)return res.status(404).json({error:'Evidence target no longer exists'});
      const order=base.rows[0];
      const response={caseId:req.params.id,scope,expiresAt:grant.expires_at,order:{reference:order.order_number,status:order.status,paymentStatus:order.payment_status,deliveryStatus:order.delivery_status,createdAt:order.created_at,acceptedAt:order.accepted_at,outForDeliveryAt:order.out_for_delivery_at,deliveredAt:order.delivered_at}};
      if(scope==='DELIVERY_EVIDENCE'||scope==='LOCATION_DETAIL'){
        const trip=await pool.query('select id,rider_id,assigned_at,completed_at from rider_trips where order_id=$1 order by assigned_at desc limit 1',[grant.target_order_id]);
        response.delivery={trip:trip.rows[0]?{tripId:trip.rows[0].id,riderReference:maskId(trip.rows[0].rider_id),assignedAt:trip.rows[0].assigned_at,completedAt:trip.rows[0].completed_at}:null};
        const events=await pool.query('select status,created_at from delivery_events where trip_id=$1 order by created_at asc',[trip.rows[0]?.id||null]);
        response.delivery.events=events.rows;
        const pod=await pool.query('select proof_type,captured_at from proof_of_delivery where order_id=$1 order by captured_at desc limit 10',[grant.target_order_id]);
        response.delivery.proofOfDelivery=pod.rows;
      }
      if(scope==='REFUND_EVIDENCE'){
        const refunds=await pool.query("select provider,status,created_at,updated_at,case when transaction_reference is null then null else left(transaction_reference,4)||'••••'||right(transaction_reference,4) end as transaction_reference from refunds where order_id=$1 order by created_at desc",[grant.target_order_id]);
        response.refunds=refunds.rows;
      }
      if(scope==='LOCATION_DETAIL'){
        const trip=await pool.query('select id from rider_trips where order_id=$1 order by assigned_at desc limit 1',[grant.target_order_id]);
        const events=await pool.query('select status,latitude,longitude,created_at from delivery_events where trip_id=$1 and latitude is not null and longitude is not null order by created_at asc',[trip.rows[0]?.id||null]);
        response.location=events.rows;
      }
      if(scope==='CUSTOMER_CONTACT'){
        const r=await pool.query('select c.name,c.phone,c.email from customers c join orders o on o.customer_id=c.id where o.id=$1 and o.business_id=$2 limit 1',[grant.target_order_id,grant.business_id]);
        response.customer=r.rows[0]||null;
      }
      await audit(pool,{caseId:req.params.id,adminId:req.controlAdmin.id,action:'EVIDENCE_VIEWED',scope,metadata:{scope}});
      res.json(response);
    }catch(e){res.status(500).json({error:e.message||'Unable to load controlled evidence'});}
  });

  app.post('/api/control/disputes/:id/close',requireControl,requireControlRole('PLATFORM_OWNER'),async(req,res)=>{
    try{
      const c=await caseRow(pool,req.params.id); if(!c)return res.status(404).json({error:'Dispute case not found'});
      await pool.query("update control_access_cases set status='CLOSED',closed_at=now() where id=$1",[c.id]);
      await pool.query('update control_access_grants set revoked_at=now() where case_id=$1 and revoked_at is null',[c.id]);
      await audit(pool,{caseId:c.id,adminId:req.controlAdmin.id,action:'CASE_CLOSED'});
      await recordPlatformAudit(req.controlAdmin.id,c.business_id,'DISPUTE_CASE_CLOSED','Controlled evidence case closed',{caseId:c.id});
      res.json({ok:true});
    }catch(e){res.status(500).json({error:e.message||'Unable to close dispute case'});}
  });

  app.get('/api/control/data-access-policy',requireControl,(req,res)=>res.json({normalAccess:false,tenantOperationalDataVisible:false,customerPersonalDataVisible:false,restaurantRevenueVisible:false,restaurantOrdersVisible:false,directDatabaseBrowsing:false,controlledEvidence:true,scopes:[...SCOPES],ownerOnlyScopes:[...OWNER_ONLY],maxAccessMinutes:MAX_ACCESS_MINUTES,model:'purpose-bound, minimum-necessary, time-limited, audited break-glass access'}));
}
export {ensureControlDataIsolationSchema,registerControlDataIsolation};