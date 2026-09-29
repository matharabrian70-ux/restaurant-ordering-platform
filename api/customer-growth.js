import crypto from 'node:crypto';

const clean=(v,n=200)=>String(v??'').trim().slice(0,n);
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const token=()=>crypto.randomBytes(32).toString('hex');

export function registerCustomerGrowth(app,pool){
 async function session(req,res,next){
  try{
   const bearer=String(req.headers.authorization||'');
   if(!bearer.startsWith('Bearer '))return res.status(401).json({error:'Customer session required'});
   const r=await pool.query('select cs.customer_id,cs.business_id,c.name,c.phone,c.email from customer_sessions cs join customers c on c.id=cs.customer_id where cs.token_hash=$1 and cs.expires_at>now()',[hash(bearer.slice(7).trim())]);
   if(!r.rowCount)return res.status(401).json({error:'Customer session expired'});
   req.customer={id:r.rows[0].customer_id,businessId:r.rows[0].business_id,name:r.rows[0].name,phone:r.rows[0].phone,email:r.rows[0].email};next();
  }catch(e){res.status(500).json({error:'Unable to verify customer session'})}
 }

 app.post('/api/customer/session',async(req,res)=>{
  try{
   const orderId=clean(req.body.orderId,100),orderToken=clean(req.body.orderToken,200);
   if(!orderId||!orderToken)return res.status(400).json({error:'orderId and orderToken are required'});
   const r=await pool.query('select o.customer_id,o.business_id from orders o where o.id=$1 and o.customer_access_token_hash=$2 limit 1',[orderId,hash(orderToken)]);
   if(!r.rowCount)return res.status(401).json({error:'Invalid customer access'});
   const t=token();await pool.query('insert into customer_sessions(customer_id,business_id,token_hash,expires_at) values($1,$2,$3,now()+interval \'30 days\')',[r.rows[0].customer_id,r.rows[0].business_id,hash(t)]);
   res.json({token:t,expiresInDays:30});
  }catch(e){res.status(500).json({error:'Unable to create customer session'})}
 });

 app.get('/api/customer/profile',session,async(req,res)=>{
  try{
   const [orders,loyalty,prefs]=await Promise.all([
    pool.query("select count(*)::int order_count,count(*) filter(where status='DELIVERED')::int completed_orders,coalesce(sum(total) filter(where payment_status='PAID' and status<>'CANCELLED'),0) lifetime_spend,max(created_at) last_order_at from orders where customer_id=$1 and business_id=$2",[req.customer.id,req.customer.businessId]),
    pool.query('select points,lifetime_points,tier from customer_loyalty_accounts where customer_id=$1 and business_id=$2',[req.customer.id,req.customer.businessId]),
    pool.query('select * from marketing_preferences where customer_id=$1 and business_id=$2',[req.customer.id,req.customer.businessId])
   ]);
   res.json({customer:req.customer,stats:orders.rows[0],loyalty:loyalty.rows[0]||{points:0,lifetime_points:0,tier:'STANDARD'},marketingPreferences:prefs.rows[0]||{email_enabled:true,sms_enabled:true,push_enabled:true}});
  }catch(e){res.status(500).json({error:'Unable to load customer profile'})}
 });

 app.get('/api/customer/addresses',session,async(req,res)=>{
  const r=await pool.query('select * from customer_addresses where customer_id=$1 and business_id=$2 order by is_default desc,created_at desc',[req.customer.id,req.customer.businessId]);res.json(r.rows);
 });
 app.post('/api/customer/addresses',session,async(req,res)=>{
  try{
   const label=clean(req.body.label,50),address=clean(req.body.addressLine,300);if(!label||!address)return res.status(400).json({error:'Label and address are required'});
   const c=await pool.connect();try{await c.query('begin');if(req.body.isDefault)await c.query('update customer_addresses set is_default=false where customer_id=$1 and business_id=$2',[req.customer.id,req.customer.businessId]);const r=await c.query('insert into customer_addresses(customer_id,business_id,label,address_line,latitude,longitude,delivery_note,is_default) values($1,$2,$3,$4,$5,$6,$7,$8) returning *',[req.customer.id,req.customer.businessId,label,address,req.body.latitude||null,req.body.longitude||null,clean(req.body.deliveryNote,300)||null,Boolean(req.body.isDefault)]);await c.query('commit');res.status(201).json(r.rows[0])}catch(e){try{await c.query('rollback')}catch{}throw e}finally{c.release()}
  }catch(e){res.status(400).json({error:'Unable to save address'})}
 });
 app.delete('/api/customer/addresses/:id',session,async(req,res)=>{
  const r=await pool.query('delete from customer_addresses where id=$1 and customer_id=$2 and business_id=$3',[req.params.id,req.customer.id,req.customer.businessId]);if(!r.rowCount)return res.status(404).json({error:'Address not found'});res.json({ok:true});
 });

 app.get('/api/customer/loyalty',session,async(req,res)=>{
  const r=await pool.query('select points,lifetime_points,tier from customer_loyalty_accounts where customer_id=$1 and business_id=$2',[req.customer.id,req.customer.businessId]);
  const l=await pool.query('select points,reason,created_at from customer_loyalty_ledger where customer_id=$1 and business_id=$2 order by created_at desc limit 50',[req.customer.id,req.customer.businessId]);
  res.json({account:r.rows[0]||{points:0,lifetime_points:0,tier:'STANDARD'},ledger:l.rows});
 });

 app.get('/api/customer/gift-cards',session,async(req,res)=>{
  const r=await pool.query('select g.id,g.code,g.initial_amount,g.balance,g.status,g.expires_at from customer_gift_cards cg join gift_cards g on g.id=cg.gift_card_id where cg.customer_id=$1 and g.business_id=$2 order by cg.assigned_at desc',[req.customer.id,req.customer.businessId]);res.json(r.rows);
 });
 app.post('/api/customer/gift-cards/redeem',session,async(req,res)=>{
  const code=clean(req.body.code,80).toUpperCase();if(!code)return res.status(400).json({error:'Gift card code is required'});
  try{const c=await pool.connect();try{await c.query('begin');const g=await c.query('select id from gift_cards where business_id=$1 and code=$2 and status=\'ACTIVE\' and (expires_at is null or expires_at>now()) for update',[req.customer.businessId,code]);if(!g.rowCount)throw new Error('Gift card not found or inactive');await c.query('insert into customer_gift_cards(customer_id,gift_card_id) values($1,$2) on conflict do nothing',[req.customer.id,g.rows[0].id]);await c.query('commit');res.json({ok:true})}catch(e){try{await c.query('rollback')}catch{}throw e}finally{c.release()}}catch(e){res.status(400).json({error:e.message})}
 });

 app.get('/api/customer/coupons',session,async(req,res)=>{
  const r=await pool.query("select id,code,discount_type,discount_value,min_order_amount,starts_at,expires_at from customer_coupons where business_id=$1 and active=true and starts_at<=now() and (expires_at is null or expires_at>now()) and (max_redemptions is null or redeemed_count<max_redemptions) order by expires_at nulls last",[req.customer.businessId]);res.json(r.rows);
 });

 app.put('/api/customer/marketing-preferences',session,async(req,res)=>{
  const r=await pool.query('insert into marketing_preferences(customer_id,business_id,email_enabled,sms_enabled,push_enabled) values($1,$2,$3,$4,$5) on conflict(customer_id,business_id) do update set email_enabled=excluded.email_enabled,sms_enabled=excluded.sms_enabled,push_enabled=excluded.push_enabled,updated_at=now() returning *',[req.customer.id,req.customer.businessId,req.body.emailEnabled!==false,req.body.smsEnabled!==false,req.body.pushEnabled!==false]);res.json(r.rows[0]);
 });

 app.get('/api/customer/feedback',session,async(req,res)=>{
  const r=await pool.query('select id,order_id,rating,comment,created_at from customer_feedback where customer_id=$1 and business_id=$2 order by created_at desc',[req.customer.id,req.customer.businessId]);res.json(r.rows);
 });
 app.post('/api/customer/feedback',session,async(req,res)=>{
  const rating=Number(req.body.rating);if(!Number.isInteger(rating)||rating<1||rating>5)return res.status(400).json({error:'Rating must be between 1 and 5'});
  try{
   const orderId=req.body.orderId||null;
   if(orderId){const o=await pool.query("select id from orders where id=$1 and customer_id=$2 and business_id=$3 and status='DELIVERED'",[orderId,req.customer.id,req.customer.businessId]);if(!o.rowCount)return res.status(400).json({error:'Feedback can only be attached to your completed order'})}
   const r=await pool.query('insert into customer_feedback(customer_id,business_id,order_id,rating,comment) values($1,$2,$3,$4,$5) on conflict(customer_id,order_id) do update set rating=excluded.rating,comment=excluded.comment returning *',[req.customer.id,req.customer.businessId,orderId,rating,clean(req.body.comment,1000)||null]);res.status(201).json(r.rows[0])
  }catch(e){res.status(400).json({error:'Unable to save feedback'})}
 });
}
