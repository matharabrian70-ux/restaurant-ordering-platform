import crypto from 'node:crypto';

export const LEGAL_VERSIONS = Object.freeze({
  privacy: '2026-10-01',
  terms: '2026-10-01',
  cookies: '2026-10-01',
  refunds: '2026-10-01',
  delivery: '2026-10-01',
  merchant: '2026-10-01',
  dpa: '2026-10-01',
  rider: '2026-10-01'
});

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function hashIp(req) {
  return crypto.createHash('sha256').update(clean(req.ip || req.socket?.remoteAddress || '', 120)).digest('hex');
}

export async function ensureComplianceSchema(pool) {
  await pool.query(`
    create table if not exists business_privacy_settings (
      business_id uuid primary key references businesses(id) on delete cascade,
      privacy_contact_email text,
      dpo_contact_email text,
      privacy_notice_version text not null default '2026-10-01',
      terms_version text not null default '2026-10-01',
      cookie_policy_version text not null default '2026-10-01',
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
      severity text not null default 'MEDIUM' check (severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
      status text not null default 'OPEN' check (status in ('OPEN','CONTAINED','NOTIFIABLE','REPORTED','CLOSED')),
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
  `);

  await pool.query(`
    insert into business_privacy_settings(business_id,privacy_contact_email,dpo_contact_email)
    select id,null,null
    from businesses
    on conflict (business_id) do nothing
  `);

  const seed = [
    ['Paystack','Payment processing and payment status confirmation','Customer name, email, phone, order/payment identifiers','Potential cross-border processing','Contractual safeguards; verify current transfer mechanism before launch'],
    ['Google Maps Platform','Address geocoding and route calculation where enabled','Delivery address and route coordinates','Potential cross-border processing','Contractual safeguards; verify current transfer mechanism before launch'],
    ["Africa's Talking",'Transactional rider SMS where enabled','Rider name, phone, order reference','Potential cross-border processing','Contractual safeguards; verify current transfer mechanism before launch'],
    ['Render','Backend hosting and application operations','Application data processed by the API/database environment','Hosting jurisdiction depends on deployment','Confirm hosting region, DPA and transfer safeguards before launch']
  ];
  for (const [name,purpose,data,jurisdictions,safeguard] of seed) {
    await pool.query(`
      insert into compliance_processors(id,name,purpose,data_categories,jurisdictions,transfer_safeguard)
      select gen_random_uuid(),$1,$2,$3,$4,$5
      where not exists(select 1 from compliance_processors where lower(name)=lower($1))
    `, [name,purpose,data,jurisdictions,safeguard]);
  }
}

export async function runComplianceRetentionSweep(pool) {
  // Live GPS is operational data with a short, configurable lifetime.
  await pool.query(`
    delete from rider_live_locations l
    using riders r, business_privacy_settings s
    where l.rider_id=r.id
      and s.business_id=r.business_id
      and l.updated_at < now() - make_interval(hours => s.live_gps_retention_hours)
  `);
  // Old privacy-request records are minimized after completion. Customer/order/payment
  // records are not destructively deleted here because their lawful retention may differ.
  await pool.query(`
    delete from data_subject_requests
    where status in ('COMPLETED','REJECTED')
      and updated_at < now() - interval '730 days'
  `);
}

export function registerComplianceRoutes(app, pool, deps) {
  const {
    FRONTEND_URL,
    requireManager,
    requireManagerRole,
    requirePlatformAdmin,
    requirePlatformRole,
    recordPlatformAudit,
    recordSystemIncident
  } = deps;

  const publicLimit = deps.publicComplianceRateLimit || ((req,res,next)=>next());

  app.get('/api/privacy/config', publicLimit, async (req,res) => {
    try {
      const businessId = clean(req.query.businessId, 80);
      if (!businessId) return res.status(400).json({error:'businessId is required'});
      const r = await pool.query(`
        select b.id,b.name,b.slug,
          s.privacy_contact_email as privacy_contact_email,
          s.dpo_contact_email,s.privacy_notice_version,s.terms_version,s.cookie_policy_version,
          coalesce(s.marketing_enabled,true) as marketing_enabled
        from businesses b left join business_privacy_settings s on s.business_id=b.id
        where b.id=$1 and b.status='ACTIVE' limit 1
      `,[businessId]);
      if(!r.rowCount) return res.status(404).json({error:'Restaurant not found'});
      const x=r.rows[0];
      res.json({
        businessId:x.id,businessName:x.name,slug:x.slug,
        privacyContact:x.privacy_contact_email,dpoContact:x.dpo_contact_email||null,
        versions:{privacy:x.privacy_notice_version||LEGAL_VERSIONS.privacy,terms:x.terms_version||LEGAL_VERSIONS.terms,cookies:x.cookie_policy_version||LEGAL_VERSIONS.cookies},
        marketingEnabled:Boolean(x.marketing_enabled),
        legalUrls:{
          privacy:`${FRONTEND_URL.replace(/\/$/,'')}/privacy.html?businessId=${encodeURIComponent(x.id)}`,
          terms:`${FRONTEND_URL.replace(/\/$/,'')}/terms.html?businessId=${encodeURIComponent(x.id)}`,
          cookies:`${FRONTEND_URL.replace(/\/$/,'')}/cookie-policy.html?businessId=${encodeURIComponent(x.id)}`,
          dataRights:`${FRONTEND_URL.replace(/\/$/,'')}/data-rights.html?businessId=${encodeURIComponent(x.id)}`
        }
      });
    } catch(e) { res.status(500).json({error:'Unable to load privacy configuration'}); }
  });

  app.post('/api/privacy/consent', publicLimit, async (req,res) => {
    try {
      const businessId=clean(req.body?.businessId,80);
      const type=clean(req.body?.consentType,40).toUpperCase();
      const allowed=['TERMS','PRIVACY_NOTICE','MARKETING_SMS','MARKETING_EMAIL','COOKIES','LOCATION'];
      if(!businessId||!allowed.includes(type))return res.status(400).json({error:'businessId and a valid consentType are required'});
      const b=await pool.query('select id from businesses where id=$1 and status=\'ACTIVE\'',[businessId]);
      if(!b.rowCount)return res.status(404).json({error:'Restaurant not found'});
      const granted=req.body?.granted===true;
      const version=clean(req.body?.version,80)||LEGAL_VERSIONS[type==='TERMS'?'terms':type==='COOKIES'?'cookies':'privacy'];
      const r=await pool.query(`
        insert into privacy_consents(id,business_id,subject_phone,subject_email,consent_type,version,granted,source,ip_hash,user_agent)
        values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9) returning id,created_at
      `,[businessId,clean(req.body?.phone,40)||null,clean(req.body?.email,160)||null,type,version,granted,clean(req.body?.source,40)||'WEB',hashIp(req),clean(req.headers['user-agent'],500)]);
      res.status(201).json({ok:true,consentId:r.rows[0].id,createdAt:r.rows[0].created_at});
    }catch(e){res.status(400).json({error:'Unable to record consent'});}
  });

  app.post('/api/privacy/requests', publicLimit, async (req,res) => {
    try {
      const businessId=clean(req.body?.businessId,80);
      const type=clean(req.body?.requestType,40).toUpperCase();
      const allowed=['ACCESS','RECTIFICATION','ERASURE','OBJECTION','RESTRICTION','PORTABILITY'];
      const name=clean(req.body?.name,160),email=clean(req.body?.email,160).toLowerCase(),phone=clean(req.body?.phone,40);
      if(!businessId||!allowed.includes(type)||(!email&&!phone))return res.status(400).json({error:'Business, request type and at least one contact detail are required'});
      const b=await pool.query('select id from businesses where id=$1 and status=\'ACTIVE\'',[businessId]);
      if(!b.rowCount)return res.status(404).json({error:'Restaurant not found'});
      const dueDays=type==='ACCESS'?7:type==='RECTIFICATION'?14:type==='PORTABILITY'?30:14;
      const dueAt=new Date(Date.now()+dueDays*24*60*60*1000);
      const r=await pool.query(`
        insert into data_subject_requests(id,business_id,request_type,requester_name,requester_email,requester_phone,details,due_at)
        values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7) returning id,created_at,due_at,status
      `,[businessId,type,name,email||null,phone||null,clean(req.body?.details,4000),dueAt]);
      res.status(201).json({ok:true,requestId:r.rows[0].id,status:r.rows[0].status,dueAt:r.rows[0].due_at});
    }catch(e){res.status(400).json({error:'Unable to create data rights request'});}
  });

  app.get('/api/manager/privacy', requireManager, async(req,res) => {
    const r=await pool.query('select * from business_privacy_settings where business_id=$1',[req.manager.business_id]);
    res.json(r.rows[0]||{business_id:req.manager.business_id});
  });

  app.put('/api/manager/privacy', requireManager, requireManagerRole('OWNER'), async(req,res) => {
    try {
      const privacyContact=clean(req.body?.privacyContact,160).toLowerCase();
      const dpoContact=clean(req.body?.dpoContact,160).toLowerCase()||null;
      if(privacyContact && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(privacyContact))return res.status(400).json({error:'Privacy contact email is invalid'});
      if(dpoContact && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dpoContact))return res.status(400).json({error:'DPO contact email is invalid'});
      const customerDays=Math.max(30,Math.min(3650,Number(req.body?.retentionCustomerDays||730)));
      const orderDays=Math.max(365,Math.min(3650,Number(req.body?.retentionOrderDays||2555)));
      const gpsHours=Math.max(1,Math.min(168,Number(req.body?.liveGpsRetentionHours||24)));
      const marketingEnabled=req.body?.marketingEnabled!==false;
      const controllerStatus=clean(req.body?.odpcControllerStatus,40).toUpperCase()||'NOT_REVIEWED';
      const processorStatus=clean(req.body?.odpcProcessorStatus,40).toUpperCase()||'NOT_REVIEWED';
      if(!['NOT_REVIEWED','IN_PROGRESS','REGISTERED','NOT_REQUIRED'].includes(controllerStatus)||!['NOT_REVIEWED','IN_PROGRESS','REGISTERED','NOT_REQUIRED'].includes(processorStatus))return res.status(400).json({error:'Invalid ODPC registration status'});
      const controllerCertificate=clean(req.body?.odpcControllerCertificate,160)||null;
      const processorCertificate=clean(req.body?.odpcProcessorCertificate,160)||null;
      const r=await pool.query(`
        insert into business_privacy_settings(business_id,privacy_contact_email,dpo_contact_email,marketing_enabled,retention_customer_days,retention_order_days,live_gps_retention_hours,odpc_controller_status,odpc_processor_status,odpc_controller_certificate,odpc_processor_certificate,updated_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
        on conflict(business_id) do update set privacy_contact_email=excluded.privacy_contact_email,dpo_contact_email=excluded.dpo_contact_email,marketing_enabled=excluded.marketing_enabled,retention_customer_days=excluded.retention_customer_days,retention_order_days=excluded.retention_order_days,live_gps_retention_hours=excluded.live_gps_retention_hours,odpc_controller_status=excluded.odpc_controller_status,odpc_processor_status=excluded.odpc_processor_status,odpc_controller_certificate=excluded.odpc_controller_certificate,odpc_processor_certificate=excluded.odpc_processor_certificate,updated_at=now()
        returning *
      `,[req.manager.business_id,privacyContact||null,dpoContact,marketingEnabled,customerDays,orderDays,gpsHours,controllerStatus,processorStatus,controllerCertificate,processorCertificate]);
      res.json(r.rows[0]);
    }catch(e){res.status(400).json({error:'Unable to save privacy settings'});}
  });

  app.get('/api/manager/privacy/requests', requireManager, async(req,res) => {
    const r=await pool.query('select * from data_subject_requests where business_id=$1 order by created_at desc limit 200',[req.manager.business_id]);
    res.json(r.rows);
  });

  app.patch('/api/manager/privacy/requests/:id', requireManager, requireManagerRole('OWNER'), async(req,res) => {
    try {
      const status=clean(req.body?.status,30).toUpperCase();
      const allowed=['OPEN','VERIFYING','IN_PROGRESS','COMPLETED','REJECTED'];
      if(!allowed.includes(status))return res.status(400).json({error:'Invalid request status'});
      const note=clean(req.body?.responseNote,4000)||null;
      const r=await pool.query(`
        update data_subject_requests set status=$1,response_note=coalesce($2,response_note),completed_at=case when $1 in ('COMPLETED','REJECTED') then now() else completed_at end,updated_at=now()
        where id=$2 and business_id=$3 returning *
      `,[status,note,req.params.id,req.manager.business_id]);
      if(!r.rowCount)return res.status(404).json({error:'Data rights request not found'});
      res.json(r.rows[0]);
    }catch(e){res.status(400).json({error:'Unable to update data rights request'});}
  });

  app.get('/api/manager/privacy/customer/:id/export', requireManager, async(req,res) => {
    try {
      const customer=await pool.query('select id,business_id,name,phone,email,created_at from customers where id=$1 and business_id=$2',[req.params.id,req.manager.business_id]);
      if(!customer.rowCount)return res.status(404).json({error:'Customer not found'});
      const orders=await pool.query(`
        select o.id,o.order_number,o.status,o.payment_status,o.payment_method,o.subtotal,o.total,o.delivery_fee,o.created_at,o.delivery_address,
          coalesce((select json_agg(json_build_object('product',oi.product_name,'quantity',oi.quantity,'unitPrice',oi.unit_price,'options',oi.options) order by oi.id),'[]'::json) items
        from orders o left join order_items oi on oi.order_id=o.id
        where o.customer_id=$1 and o.business_id=$2
        group by o.id order by o.created_at desc
      `,[req.params.id,req.manager.business_id]);
      const consents=await pool.query('select consent_type,version,granted,source,created_at from privacy_consents where business_id=$1 and (customer_id=$2 or subject_phone=$3 or subject_email=$4) order by created_at desc',[req.manager.business_id,req.params.id,customer.rows[0].phone,customer.rows[0].email]);
      res.json({exportVersion:'1.0',generatedAt:new Date().toISOString(),customer:customer.rows[0],orders:orders.rows,consents:consents.rows});
    }catch(e){res.status(500).json({error:'Unable to export customer data'});}
  });

  app.get('/api/platform/compliance/processors', requirePlatformAdmin, async(req,res) => {
    const r=await pool.query('select * from compliance_processors order by name');
    res.json(r.rows);
  });

  app.patch('/api/platform/compliance/processors/:id', requirePlatformAdmin, requirePlatformRole('PLATFORM_OWNER'), async(req,res) => {
    try {
      const status=clean(req.body?.agreementStatus,40).toUpperCase();
      if(!['REVIEW_REQUIRED','UNDER_REVIEW','SIGNED','NOT_APPLICABLE'].includes(status))return res.status(400).json({error:'Invalid processor agreement status'});
      const r=await pool.query('update compliance_processors set agreement_status=$1,transfer_safeguard=coalesce($2,transfer_safeguard),updated_at=now() where id=$3 returning *',[status,clean(req.body?.transferSafeguard,1000)||null,req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:'Processor not found'});
      await recordPlatformAudit(req.platformAdmin.id,null,'PROCESSOR_COMPLIANCE_UPDATED','Processor register updated',{processorId:req.params.id,status});
      res.json(r.rows[0]);
    }catch(e){res.status(400).json({error:'Unable to update processor register'});}
  });

  app.post('/api/platform/compliance/incidents', requirePlatformAdmin, requirePlatformRole('PLATFORM_OWNER'), async(req,res) => {
    try {
      const description=clean(req.body?.description,5000);
      if(!description)return res.status(400).json({error:'Incident description is required'});
      const severity=['LOW','MEDIUM','HIGH','CRITICAL'].includes(String(req.body?.severity||'MEDIUM').toUpperCase())?String(req.body.severity).toUpperCase():'MEDIUM';
      const r=await pool.query(`
        insert into privacy_incidents(id,business_id,severity,description,affected_data,affected_subjects,containment_actions,remediation_actions,created_by)
        values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8) returning *
      `,[clean(req.body?.businessId,80)||null,severity,description,clean(req.body?.affectedData,2000)||null,Number.isFinite(Number(req.body?.affectedSubjects))?Number(req.body.affectedSubjects):null,clean(req.body?.containmentActions,4000)||null,clean(req.body?.remediationActions,4000)||null,req.platformAdmin.email||req.platformAdmin.name]);
      await recordSystemIncident({businessId:clean(req.body?.businessId,80)||null,source:'PRIVACY',severity:severity==='CRITICAL'?'CRITICAL':severity==='HIGH'?'ERROR':'WARN',message:'Privacy incident opened.',metadata:{privacyIncidentId:r.rows[0].id}});
      res.status(201).json(r.rows[0]);
    }catch(e){res.status(400).json({error:'Unable to open privacy incident'});}
  });

  app.get('/api/platform/compliance/incidents', requirePlatformAdmin, async(req,res) => {
    const r=await pool.query('select i.*,b.name as business_name from privacy_incidents i left join businesses b on b.id=i.business_id order by i.discovered_at desc limit 200');
    res.json(r.rows);
  });

  app.patch('/api/platform/compliance/incidents/:id', requirePlatformAdmin, requirePlatformRole('PLATFORM_OWNER'), async(req,res) => {
    try {
      const status=clean(req.body?.status,30).toUpperCase();
      if(!['OPEN','CONTAINED','NOTIFIABLE','REPORTED','CLOSED'].includes(status))return res.status(400).json({error:'Invalid incident status'});
      const r=await pool.query(`
        update privacy_incidents set status=$1,
          notified_odpc_at=case when $1='REPORTED' and notified_odpc_at is null then now() else notified_odpc_at end,
          data_subjects_notified_at=case when $1 in ('REPORTED','CLOSED') and data_subjects_notified_at is null then now() else data_subjects_notified_at end,
          regulator_reference=coalesce($2,regulator_reference),updated_at=now()
        where id=$3 returning *
      `,[status,clean(req.body?.regulatorReference,200)||null,req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:'Privacy incident not found'});
      await recordPlatformAudit(req.platformAdmin.id,r.rows[0].business_id,'PRIVACY_INCIDENT_UPDATED','Privacy incident workflow updated',{incidentId:req.params.id,status});
      res.json(r.rows[0]);
    }catch(e){res.status(400).json({error:'Unable to update privacy incident'});}
  });
}
