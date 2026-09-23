import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
const PAYSTACK_API = 'https://api.paystack.co';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://matharabrian70-ux.github.io/restaurant-ordering-platform';
const RIDER_MODULE_ENABLED = String(process.env.RIDER_MODULE_ENABLED || 'false').toLowerCase() === 'true';

app.use(cors());
app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));

// Optional advanced module flag. The core ordering system remains usable when disabled.
app.get('/api/features', async (req, res) => {
  const businessId = String(req.query.businessId || '');
  if (RIDER_MODULE_ENABLED) return res.json({ riderModule: true });
  if (!businessId) return res.json({ riderModule: false });
  try {
    const result = await pool.query('select rider_module_enabled from business_features where business_id=$1', [businessId]);
    return res.json({ riderModule: result.rowCount ? Boolean(result.rows[0].rider_module_enabled) : false });
  } catch {
    return res.json({ riderModule: false });
  }
});
async function requireRiderModule(req, res, next) {
  if (RIDER_MODULE_ENABLED) return next();
  let businessId = String(req.query.businessId || req.body?.businessId || '');
  try {
    if (!businessId && req.params?.id) {
      const rider = await pool.query('select business_id from riders where id=$1', [req.params.id]);
      businessId = rider.rows[0]?.business_id ? String(rider.rows[0].business_id) : '';
    }
    if (!businessId && req.params?.id) {
      const order = await pool.query('select business_id from orders where id=$1', [req.params.id]);
      businessId = order.rows[0]?.business_id ? String(order.rows[0].business_id) : '';
    }
    if (!businessId) return res.status(404).json({ error: 'Rider module is not enabled for this business' });
    const feature = await pool.query('select rider_module_enabled from business_features where business_id=$1', [businessId]);
    if (!feature.rowCount || !feature.rows[0].rider_module_enabled) return res.status(404).json({ error: 'Rider module is not enabled for this business' });
    next();
  } catch {
    res.status(500).json({ error: 'Unable to check rider module status' });
  }
}
app.use('/api/riders', requireRiderModule);

// Server-Sent Events: one persistent connection replaces the dashboard's 5-second polling.
const realtimeClients = new Set();
function sendRealtime(client, event, data) {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {}
}
function broadcastRealtime({ businessId, orderId = null, event = 'order.updated', data = {} }) {
  for (const client of realtimeClients) {
    if (client.businessId !== String(businessId)) continue;
    if (client.orderId && orderId && client.orderId !== String(orderId)) continue;
    if (client.orderId && !orderId) continue;
    sendRealtime(client, event, data);
  }
}
function broadcastOrder(order, extra = {}) {
  if (!order) return;
  broadcastRealtime({
    businessId: order.business_id,
    orderId: order.id,
    event: 'order.updated',
    data: { orderId: order.id, status: order.status, paymentStatus: order.payment_status, ...extra }
  });
}

function requirePaystackKey() {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new Error('PAYSTACK_SECRET_KEY is not configured');
  return process.env.PAYSTACK_SECRET_KEY;
}
function requireRefundAdmin(req, res) {
  const configured = process.env.REFUND_ADMIN_KEY;
  const supplied = req.headers['x-refund-admin-key'];
  if (!configured || !supplied || supplied !== configured) { res.status(401).json({ error: 'Refund authorization required' }); return false; }
  return true;
}
async function paystackRequest(path, options = {}) {
  const response = await fetch(PAYSTACK_API + path, { ...options, headers: { Authorization: `Bearer ${requirePaystackKey()}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.status) throw new Error(data.message || `Paystack request failed (${response.status})`);
  return data;
}
function normalizeKenyanPhone(phone) {
  const value = String(phone || '').replace(/[\s()-]/g, '');
  if (/^\+254\d{9}$/.test(value)) return value;
  if (/^254\d{9}$/.test(value)) return `+${value}`;
  if (/^0\d{9}$/.test(value)) return `+254${value.slice(1)}`;
  throw new Error('Enter a valid Kenyan phone number');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { hash: `${salt}:${hash}`, salt };
}
function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
async function getRiderFromSession(req) {
  const raw = String(req.headers.authorization || '');
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
  if (!token) return null;
  const result = await pool.query(`select r.*,s.id as session_id,s.expires_at from rider_sessions s join riders r on r.id=s.rider_id where s.token_hash=$1 and s.expires_at>now()`, [hashSessionToken(token)]);
  return result.rows[0] || null;
}
async function requireRiderAuth(req, res, next) {
  try {
    const rider = await getRiderFromSession(req);
    if (!rider) return res.status(401).json({ error: 'Rider login required' });
    if (req.params?.id && String(req.params.id) !== String(rider.id)) return res.status(403).json({ error: 'You can only access your own rider account' });
    req.rider = rider;
    next();
  } catch { res.status(500).json({ error: 'Unable to verify rider session' }); }
}
async function computeGoogleRoute(origin, destination) {
  if (!process.env.GOOGLE_MAPS_API_KEY) throw new Error('GOOGLE_MAPS_API_KEY is not configured');
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'X-Goog-Api-Key':process.env.GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask':'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline'
    },
    body:JSON.stringify({
      origin:{address:String(origin)},
      destination:{address:String(destination)},
      travelMode:'TWO_WHEELER',
      routingPreference:'TRAFFIC_AWARE',
      languageCode:'en',
      units:'METRIC'
    })
  });
  const data=await response.json().catch(()=>({}));
  if (!response.ok || !data.routes?.[0]) throw new Error(data.error?.message || 'Google Maps route could not be calculated');
  const route=data.routes[0];
  return {
    distanceMeters:Number(route.distanceMeters||0),
    durationSeconds:Math.round(parseFloat(String(route.duration||'0').replace('s',''))||0),
    encodedPolyline:route.polyline?.encodedPolyline||null
  };
}
async function getNairobiFuelPrice() {
  const cached=await pool.query(`select petrol_price_kes from fuel_price_snapshots where city='Nairobi' order by fetched_at desc limit 1`);
  const cachedAt=await pool.query(`select fetched_at from fuel_price_snapshots where city='Nairobi' order by fetched_at desc limit 1`);
  if(cached.rowCount && cachedAt.rowCount && Date.now()-new Date(cachedAt.rows[0].fetched_at).getTime()<6*60*60*1000) return Number(cached.rows[0].petrol_price_kes);
  const configured=Number(process.env.NAIROBI_FUEL_PRICE_KES||0);
  if(configured>0){
    await pool.query(`insert into fuel_price_snapshots(id,city,petrol_price_kes,source,effective_from) values(gen_random_uuid(),'Nairobi',$1,'environment',current_date)`,[configured]);
    return configured;
  }
  try {
    const response=await fetch(process.env.EPRA_FUEL_PRICE_URL||'https://www.epra.go.ke/EPRA%20Pump%20Prices',{headers:{'User-Agent':'RestaurantDeliveryPlatform/1.0'}});
    const html=await response.text();
    const match=html.match(/Nairobi\\s+PMS\\s+([0-9]+(?:\\.[0-9]+)?)/i);
    if(match){
      const price=Number(match[1]);
      if(Number.isFinite(price)&&price>0){
        await pool.query(`insert into fuel_price_snapshots(id,city,petrol_price_kes,source,effective_from) values(gen_random_uuid(),'Nairobi',$1,'EPRA',current_date)`,[price]);
        return price;
      }
    }
  } catch {}
  if(cached.rowCount) return Number(cached.rows[0].petrol_price_kes);
  return 214.03;
}
async function calculateDeliveryQuote({businessId,pickupAddress,deliveryAddress}) {
  const route=await computeGoogleRoute(pickupAddress,deliveryAddress);
  const km=route.distanceMeters/1000;
  const minutes=route.durationSeconds/60;
  const fuel=await getNairobiFuelPrice();
  const online=await pool.query(`select count(*)::int as count from riders r join rider_presence p on p.rider_id=r.id where r.business_id=$1 and r.active=true and p.online=true`,[businessId]);
  const availableOnline=Number(online.rows[0]?.count||0);
  const demandMultiplier=availableOnline===0?1.18:availableOnline===1?1.10:1.0;
  const baseFee=70;
  const distanceFee=km*34;
  const timeFee=minutes*1.35;
  const fuelMultiplier=Math.max(0.9,Math.min(1.2,fuel/200));
  const raw=(baseFee+distanceFee+timeFee)*fuelMultiplier*demandMultiplier;
  const fee=Math.max(100,Math.ceil(raw/10)*10);
  return {...route,km,minutes,fuelPriceKes:fuel,baseFeeKes:baseFee,distanceFeeKes:distanceFee,timeFeeKes:timeFee,demandMultiplier,deliveryFeeKes:fee};
}

app.get('/api/businesses/:id', async (req,res)=>{
  try{
    const result=await pool.query('select id,name,slug,pickup_address from businesses where id=$1',[req.params.id]);
    if(!result.rowCount)return res.status(404).json({error:'Business not found'});
    res.json(result.rows[0]);
  }catch{res.status(500).json({error:'Unable to load business'});}
});
app.get('/api/events', async (req, res) => {
  const businessId = String(req.query.businessId || '');
  const orderId = req.query.orderId ? String(req.query.orderId) : null;
  if (!businessId) return res.status(400).json({ error: 'businessId is required' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const client = { res, businessId, orderId };
  realtimeClients.add(client);
  sendRealtime(client, 'connected', { ok: true });
  const heartbeat = setInterval(() => sendRealtime(client, 'heartbeat', { at: new Date().toISOString() }), 25000);
  req.on('close', () => { clearInterval(heartbeat); realtimeClients.delete(client); });
});

async function initiateRefundForOrder(orderId, customerNote = 'Customer cancelled before restaurant acceptance', merchantNote = 'Automatic cancellation refund') {
  const orderResult = await pool.query(`select o.id,o.business_id,o.total,o.payment_status,p.id as payment_id,p.provider_reference,p.amount as paid_amount from orders o join payments p on p.order_id=o.id and p.provider='PAYSTACK' where o.id=$1`, [orderId]);
  if (!orderResult.rowCount) throw new Error('Paid Paystack order not found');
  const order = orderResult.rows[0];
  if (order.payment_status !== 'PAID' || !order.provider_reference) return null;
  const refundedResult = await pool.query(`select coalesce(sum(amount),0) as total from refunds where payment_id=$1 and status in ('PENDING','PROCESSING','PROCESSED')`, [order.payment_id]);
  const alreadyRefunded = Number(refundedResult.rows[0].total);
  const remaining = Number(order.paid_amount) - alreadyRefunded;
  if (remaining <= 0.0001) return null;
  const refund = await paystackRequest('/refund', { method: 'POST', body: JSON.stringify({ transaction: order.provider_reference, amount: String(Math.round(remaining * 100)), currency: 'KES', customer_note: customerNote, merchant_note: merchantNote }) });
  const data = refund.data || {};
  const insert = await pool.query(`insert into refunds (id,order_id,payment_id,provider,provider_refund_id,transaction_reference,amount,currency,status,customer_note,merchant_note) values (gen_random_uuid(),$1,$2,'PAYSTACK',$3,$4,$5,'KES',$6,$7,$8) returning *`, [order.id, order.payment_id, data.id ? String(data.id) : null, order.provider_reference, remaining, String(data.status || 'pending').toUpperCase(), customerNote, merchantNote]);
  broadcastRealtime({ businessId: order.business_id, orderId: order.id, event: 'refund.updated', data: { orderId: order.id, refund: insert.rows[0] } });
  return insert.rows[0];
}

async function markPaymentSuccessful(reference, paystackData = null) {
  const client = await pool.connect();
  let cancelledOrderId = null;
  let paidOrder = null;
  try {
    await client.query('begin');
    const paymentResult = await client.query(`select p.*, o.total, o.id as order_id, o.business_id, o.status as order_status from payments p join orders o on o.id=p.order_id where p.provider='PAYSTACK' and p.provider_reference=$1 for update`, [reference]);
    if (!paymentResult.rowCount) { await client.query('rollback'); return null; }
    const payment = paymentResult.rows[0];
    const expectedSubunit = Math.round(Number(payment.total) * 100);
    if (paystackData && Number(paystackData.amount) !== expectedSubunit) { await client.query('rollback'); throw new Error('Paystack amount does not match the order total'); }
    await client.query(`update payments set status='PAID', confirmed_at=coalesce(confirmed_at,now()) where id=$1`, [payment.id]);
    const updated = await client.query(`update orders set payment_status='PAID' where id=$1 returning *`, [payment.order_id]);
    paidOrder = updated.rows[0];
    cancelledOrderId = payment.order_status === 'CANCELLED' ? payment.order_id : null;
    await client.query('commit');
    if (paidOrder) broadcastOrder(paidOrder, { reason: 'payment.confirmed', notification: 'New paid order' });
    if (cancelledOrderId) await initiateRefundForOrder(cancelledOrderId, 'Customer cancelled before payment completed', 'Automatic refund because the order was cancelled before restaurant acceptance');
    return payment.order_id;
  } catch (error) { try { await client.query('rollback'); } catch {} throw error; }
  finally { client.release(); }
}

async function updateRefundFromWebhook(data) {
  const transactionReference = String(data?.transaction_reference || data?.transaction?.reference || '');
  const refundProviderId = data?.refund_reference || data?.id || null;
  const status = String(data?.status || '').toUpperCase();
  if (!transactionReference || !status) return;
  const client = await pool.connect();
  try {
    await client.query('begin');
    const refundResult = await client.query(`select r.*, p.id as payment_id, p.amount as payment_amount, o.business_id from refunds r join payments p on p.id=r.payment_id join orders o on o.id=r.order_id where r.transaction_reference=$1 and (r.provider_refund_id=$2 or r.provider_refund_id is null) order by r.created_at desc limit 1 for update`, [transactionReference, refundProviderId]);
    if (!refundResult.rowCount) { await client.query('rollback'); return; }
    const refund = refundResult.rows[0];
    const mappedStatus = ['PENDING','PROCESSING','PROCESSED','FAILED','NEEDS-ATTENTION'].includes(status) ? status : refund.status;
    const updatedRefund = await client.query(`update refunds set status=$1, provider_refund_id=coalesce(provider_refund_id,$2), updated_at=now() where id=$3 returning *`, [mappedStatus, refundProviderId, refund.id]);
    if (mappedStatus === 'PROCESSED') {
      const totalRefunded = await client.query(`select coalesce(sum(amount),0) as total from refunds where payment_id=$1 and status='PROCESSED'`, [refund.payment_id]);
      if (Number(totalRefunded.rows[0].total) >= Number(refund.payment_amount)) {
        await client.query(`update payments set status='REFUNDED' where id=$1`, [refund.payment_id]);
        await client.query(`update orders set payment_status='REFUNDED' where id=$1`, [refund.order_id]);
      }
    }
    await client.query('commit');
    broadcastRealtime({ businessId: refund.business_id, orderId: refund.order_id, event: 'refund.updated', data: { orderId: refund.order_id, refund: updatedRefund.rows[0], paymentStatus: mappedStatus === 'PROCESSED' ? 'REFUNDED' : undefined } });
  } catch (error) { try { await client.query('rollback'); } catch {} throw error; }
  finally { client.release(); }
}

app.get('/health', async (_req, res) => { try { await pool.query('select 1'); res.json({ ok: true, database: true }); } catch { res.status(503).json({ ok: false, database: false }); } });
app.get('/api/orders/:id', async (req, res) => { try { const result = await pool.query(`select o.*, c.name as customer_name, c.phone, c.email, r.name as rider_name, r.vehicle_type, r.number_plate, r.phone as rider_phone from orders o join customers c on c.id=o.customer_id left join riders r on r.id=(select rider_id from rider_trips t where t.order_id=o.id order by assigned_at desc limit 1) where o.id=$1`, [req.params.id]); if (!result.rowCount) return res.status(404).json({ error: 'Order not found' }); res.json(result.rows[0]); } catch { res.status(500).json({ error: 'Unable to load order' }); } });
app.get('/api/orders/:id/refunds', async (req, res) => { try { const result = await pool.query(`select id,amount,currency,status,created_at,updated_at,customer_note,merchant_note from refunds where order_id=$1 order by created_at desc`, [req.params.id]); res.json(result.rows); } catch { res.status(500).json({ error: 'Unable to load refunds' }); } });
app.get('/api/orders', async (req, res) => { try { const { businessId, q = '' } = req.query; if (!businessId) return res.status(400).json({ error: 'businessId is required' }); const result = await pool.query(`select o.id,o.business_id,o.order_number,o.status,o.payment_status,o.payment_method,o.total,o.created_at,o.delivery_note,c.name,c.phone,c.email,coalesce((select r.name from riders r join rider_trips t on t.rider_id=r.id where t.order_id=o.id order by t.assigned_at desc limit 1),'') as rider_name,coalesce((select r.vehicle_type from riders r join rider_trips t on t.rider_id=r.id where t.order_id=o.id order by t.assigned_at desc limit 1),'') as rider_vehicle,coalesce((select r.number_plate from riders r join rider_trips t on t.rider_id=r.id where t.order_id=o.id order by t.assigned_at desc limit 1),'') as rider_plate from orders o join customers c on c.id=o.customer_id where o.business_id=$1 and ($2='' or c.name ilike '%'||$2||'%' or c.phone ilike '%'||$2||'%' or coalesce(c.email,'') ilike '%'||$2||'%' or o.order_number ilike '%'||$2||'%') order by o.created_at desc limit 200`, [businessId, String(q).trim()]); res.json(result.rows); } catch { res.status(500).json({ error: 'Unable to load orders' }); } });
app.get('/api/riders', async (req, res) => { try { const { businessId } = req.query; if (!businessId) return res.status(400).json({ error: 'businessId is required' }); const result = await pool.query(`select r.id,r.name,r.phone,r.email,r.vehicle_type,r.number_plate,r.active,coalesce(p.online,false) as online,exists(select 1 from rider_trips t join orders o on o.id=t.order_id where t.rider_id=r.id and t.completed_at is null) as busy,(select count(*) from rider_trips t where t.rider_id=r.id and t.completed_at is not null) as trip_count from riders r left join rider_presence p on p.rider_id=r.id where r.business_id=$1 order by r.name`, [businessId]); res.json(result.rows.map(r => ({ ...r, available: r.active && r.online && !r.busy }))); } catch { res.status(500).json({ error: 'Unable to load riders' }); } });
app.post('/api/orders/:id/status', async (req, res) => { try { const nextStatus = String(req.body.status || '').toUpperCase(); if (!['ACCEPTED','DELIVERED'].includes(nextStatus)) return res.status(400).json({ error: 'Invalid status transition' }); const orderResult = await pool.query(`select * from orders where id=$1 for update`, [req.params.id]); if (!orderResult.rowCount) return res.status(404).json({ error: 'Order not found' }); const order = orderResult.rows[0]; if (nextStatus === 'ACCEPTED' && !(order.status === 'NEW' && order.payment_status === 'PAID')) return res.status(409).json({ error: 'Only paid NEW orders can be accepted' }); if (nextStatus === 'DELIVERED' && order.status !== 'OUT_FOR_DELIVERY') return res.status(409).json({ error: 'Only orders out for delivery can be delivered' }); const result = nextStatus === 'ACCEPTED' ? await pool.query(`update orders set status='ACCEPTED',accepted_at=coalesce(accepted_at,now()) where id=$1 returning *`, [req.params.id]) : await pool.query(`update orders set status='DELIVERED',delivered_at=coalesce(delivered_at,now()) where id=$1 returning *`, [req.params.id]); broadcastOrder(result.rows[0], { reason: nextStatus === 'ACCEPTED' ? 'restaurant.accepted' : 'restaurant.delivered' }); res.json(result.rows[0]); } catch { res.status(500).json({ error: 'Unable to update order status' }); } });
app.post('/api/orders/:id/cancel', async (req, res) => { const client = await pool.connect(); try { let order; try { await client.query('begin'); const result = await client.query(`select * from orders where id=$1 for update`, [req.params.id]); if (!result.rowCount) { await client.query('rollback'); return res.status(404).json({ error: 'Order not found' }); } order = result.rows[0]; if (order.status !== 'NEW') { await client.query('rollback'); return res.status(409).json({ error: 'This order can no longer be cancelled because the restaurant has accepted it.' }); } await client.query(`update orders set status='CANCELLED' where id=$1`, [order.id]); const updated = await client.query(`select * from orders where id=$1`, [order.id]); await client.query('commit'); order = updated.rows[0]; broadcastOrder(order, { reason: 'customer.cancelled' }); } catch (error) { try { await client.query('rollback'); } catch {} throw error; } let refund = null; if (order.payment_status === 'PAID') refund = await initiateRefundForOrder(order.id, 'Customer cancelled before restaurant acceptance', 'Automatic cancellation refund'); const latest = await pool.query(`select * from orders where id=$1`, [order.id]); res.json({ order: latest.rows[0], refund }); } catch (error) { res.status(500).json({ error: error.message || 'Unable to cancel order' }); } finally { client.release(); } });
app.post('/api/delivery/quote', async (req,res)=>{
  try{
    const {businessId,pickupAddress,deliveryAddress}=req.body;
    if(!businessId||!pickupAddress||!deliveryAddress) return res.status(400).json({error:'businessId, pickupAddress and deliveryAddress are required'});
    const features=await pool.query('select rider_module_enabled from business_features where business_id=$1',[businessId]);
    if(!features.rowCount||!features.rows[0].rider_module_enabled) return res.status(404).json({error:'Delivery module is not enabled for this business'});
    const q=await calculateDeliveryQuote({businessId,pickupAddress,deliveryAddress});
    const saved=await pool.query(`insert into delivery_quotes(id,business_id,pickup_address,delivery_address,distance_meters,duration_seconds,fuel_price_kes,base_fee_kes,distance_fee_kes,time_fee_kes,demand_multiplier,delivery_fee_kes) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,[businessId,pickupAddress,deliveryAddress,q.distanceMeters,q.durationSeconds,q.fuelPriceKes,q.baseFeeKes,q.distanceFeeKes,q.timeFeeKes,q.demandMultiplier,q.deliveryFeeKes]);
    res.json({quoteId:saved.rows[0].id,...q,deliveryFee:saved.rows[0].delivery_fee_kes,currency:'KES'});
  }catch(error){res.status(400).json({error:error.message||'Unable to calculate delivery fee'});}
});

app.post('/api/orders', async (req, res) => {
  const client=await pool.connect();
  try{
    const {businessId,customer,items,paymentMethod,subtotal,total,deliveryNote,quoteId}=req.body;
    const normalizedPaymentMethod=paymentMethod==='M-Pesa'?'M-Pesa':paymentMethod==='Card'?'Card':null;
    const numericSubtotal=Number(subtotal);
    if(!businessId||!customer?.name||!customer?.phone||!customer?.email||!Array.isArray(items)||!items.length||!normalizedPaymentMethod) return res.status(400).json({error:'Missing order fields'});
    if(!Number.isFinite(numericSubtotal)||numericSubtotal<=0) return res.status(400).json({error:'Invalid food subtotal'});
    let deliveryFee=0,deliveryData=null;
    if(quoteId){
      const quote=await pool.query('select * from delivery_quotes where id=$1 and business_id=$2 and status=\'QUOTED\'',[quoteId,businessId]);
      if(!quote.rowCount) return res.status(400).json({error:'Delivery quote expired or invalid'});
      deliveryData=quote.rows[0]; deliveryFee=Number(deliveryData.delivery_fee_kes);
    }
    const numericTotal=Math.round((numericSubtotal+deliveryFee)*100)/100;
    if(Number.isFinite(Number(total)) && Math.abs(Number(total)-numericTotal)>0.01) return res.status(400).json({error:'Order total does not match the server-calculated delivery fee'});
    await client.query('begin');
    const customerResult=await client.query(`insert into customers(id,business_id,name,phone,email) values(gen_random_uuid(),$1,$2,$3,$4) on conflict(business_id,phone) do update set name=excluded.name,email=coalesce(excluded.email,customers.email) returning id`,[businessId,customer.name.trim(),customer.phone.trim(),customer.email.trim()]);
    const orderNumber='SB-'+Date.now().toString().slice(-8);
    const pickupAddress=deliveryData?.pickup_address||null, deliveryAddress=deliveryData?.delivery_address||deliveryNote?.trim()||null;
    const orderResult=await client.query(`insert into orders(id,business_id,customer_id,order_number,status,payment_status,payment_method,delivery_note,subtotal,total,delivery_fee,food_subtotal,delivery_status,pickup_address,delivery_address,route_distance_meters,route_duration_seconds,delivery_fee_status,rider_earning) values(gen_random_uuid(),$1,$2,$3,'NEW','PENDING',$4,$5,$6,$7,$7,$7,$8,$9,$10,$11,$12,'HELD',$13) returning *`,[businessId,customerResult.rows[0].id,orderNumber,normalizedPaymentMethod,deliveryNote?.trim()||null,numericSubtotal,numericTotal,deliveryFee>0?'QUOTED':'NONE',pickupAddress,deliveryAddress,deliveryData?.distance_meters||null,deliveryData?.duration_seconds||null,deliveryFee]);
    for(const item of items){
      const quantity=Number(item.quantity),unitPrice=Number(item.unitPrice);
      if(!item.name||!Number.isInteger(quantity)||quantity<=0||!Number.isFinite(unitPrice)||unitPrice<0) throw new Error('Invalid order item');
      await client.query(`insert into order_items(id,order_id,product_id,product_name,quantity,unit_price,options) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6)`,[orderResult.rows[0].id,item.productId||null,item.name,quantity,unitPrice,item.options||{}]);
    }
    if(deliveryData) await client.query('update delivery_quotes set order_id=$1 where id=$2',[orderResult.rows[0].id,quoteId]);
    await client.query(`insert into payments(id,order_id,provider,amount,status) values(gen_random_uuid(),$1,'PAYSTACK',$2,'PENDING')`,[orderResult.rows[0].id,numericTotal]);
    await client.query('commit');
    res.status(201).json(orderResult.rows[0]);
  }catch(error){try{await client.query('rollback')}catch{}res.status(500).json({error:error.message==='Invalid order item'?error.message:'Unable to create order'});}
  finally{client.release();}
});
app.post('/api/payments/paystack/initialize', async (req,res)=>{
  try{
    const {orderId}=req.body;
    if(!orderId) return res.status(400).json({error:'orderId is required'});
    const result=await pool.query(`select o.id,o.order_number,o.total,o.food_subtotal,o.delivery_fee,o.payment_status,o.payment_method,o.status,c.email,c.phone,b.paystack_subaccount_code from orders o join customers c on c.id=o.customer_id join businesses b on b.id=o.business_id where o.id=$1`,[orderId]);
    if(!result.rowCount) return res.status(404).json({error:'Order not found'});
    const order=result.rows[0];
    if(order.status==='CANCELLED') return res.status(409).json({error:'Order is cancelled'});
    if(order.payment_status==='PAID') return res.json({paid:true,orderId});
    const reference=`SB-${orderId.replace(/-/g,'')}-${Date.now()}`;
    await pool.query(`update payments set provider_reference=$1,status='PENDING' where order_id=$2 and provider='PAYSTACK'`,[reference,orderId]);
    const split=order.paystack_subaccount_code?{type:'flat',bearer_type:'account',subaccounts:[{subaccount:order.paystack_subaccount_code,share:Math.round(Number(order.food_subtotal)*100)}]}:null;
    if(order.payment_method==='M-Pesa'){
      const payload={email:order.email,amount:String(Math.round(Number(order.total)*100)),currency:'KES',reference,mobile_money:{phone:normalizeKenyanPhone(order.phone),provider:'mpesa'}};
      if(split) payload.split=split;
      const charge=await paystackRequest('/charge',{method:'POST',body:JSON.stringify(payload)});
      if(charge.data?.reference&&charge.data.reference!==reference) await pool.query(`update payments set provider_reference=$1 where order_id=$2 and provider='PAYSTACK'`,[charge.data.reference,orderId]);
      return res.json({mode:'mobile_money',orderId,reference:charge.data.reference||reference,status:charge.data.status,displayText:charge.data.display_text||'Check your phone and approve the M-Pesa payment.'});
    }
    const payload={email:order.email,amount:String(Math.round(Number(order.total)*100)),currency:'KES',reference,channels:['card'],callback_url:`${process.env.API_PUBLIC_URL||'https://restaurant-ordering-api-ow3p.onrender.com'}/api/payments/paystack/callback`,metadata:{order_id:order.id,order_number:order.order_number}};
    if(split) payload.split=split;
    const transaction=await paystackRequest('/transaction/initialize',{method:'POST',body:JSON.stringify(payload)});
    return res.json({mode:'redirect',orderId,reference:transaction.data.reference,authorizationUrl:transaction.data.authorization_url});
  }catch(error){res.status(500).json({error:error.message||'Unable to initialize payment'});}
});
app.get('/api/payments/paystack/callback', async (req, res) => { const reference = String(req.query.reference || ''); if (!reference) return res.redirect(`${FRONTEND_URL}/order.html?payment=missing`); try { const verified = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' }); const data = verified.data; if (data?.status !== 'success') throw new Error('Payment was not successful'); const orderId = await markPaymentSuccessful(reference, data); if (!orderId) return res.redirect(`${FRONTEND_URL}/order.html?payment=not-found`); return res.redirect(`${FRONTEND_URL}/order.html?id=${encodeURIComponent(orderId)}&payment=success`); } catch { const payment = await pool.query(`select order_id from payments where provider='PAYSTACK' and provider_reference=$1`, [reference]); const orderId = payment.rows[0]?.order_id; const target = orderId ? `${FRONTEND_URL}/order.html?id=${encodeURIComponent(orderId)}&payment=failed` : `${FRONTEND_URL}/order.html?payment=failed`; return res.redirect(target); } });
app.post('/api/payments/paystack/verify', async (req, res) => { try { const reference = String(req.body.reference || ''); if (!reference) return res.status(400).json({ error: 'reference is required' }); const verified = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' }); if (verified.data?.status === 'success') { const orderId = await markPaymentSuccessful(reference, verified.data); return res.json({ status: 'success', orderId }); } res.json({ status: verified.data?.status || 'pending' }); } catch (error) { res.status(500).json({ error: error.message || 'Unable to verify payment' }); } });
app.get('/api/payments/paystack/webhook', (_req, res) => { res.status(405).json({ error: 'Webhook endpoint accepts POST requests from Paystack.' }); });
app.post('/api/payments/paystack/webhook', async (req, res) => { const signature = req.headers['x-paystack-signature']; const secret = process.env.PAYSTACK_SECRET_KEY; if (!signature || !secret || !req.rawBody) return res.sendStatus(401); const expected = crypto.createHmac('sha512', secret).update(req.rawBody).digest('hex'); const providedBuffer = Buffer.from(String(signature), 'utf8'); const expectedBuffer = Buffer.from(expected, 'utf8'); if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return res.sendStatus(401); try { const event = req.body; if (event.event === 'charge.success' && event.data?.reference && event.data?.status === 'success') await markPaymentSuccessful(event.data.reference, event.data); if (event.event?.startsWith('refund.') && event.data) await updateRefundFromWebhook(event.data); return res.sendStatus(200); } catch (error) { console.error('Paystack webhook processing failed:', error.message); return res.sendStatus(500); } });
app.post('/api/admin/refunds', async (req, res) => { if (!requireRefundAdmin(req, res)) return; try { const { orderId, amount, customerNote, merchantNote } = req.body; const requestedAmount = Number(amount); if (!orderId || !Number.isFinite(requestedAmount) || requestedAmount <= 0) return res.status(400).json({ error: 'orderId and a positive refund amount are required' }); const orderResult = await pool.query(`select o.id,o.business_id,o.total,o.payment_status,p.id as payment_id,p.provider_reference,p.amount as paid_amount from orders o join payments p on p.order_id=o.id and p.provider='PAYSTACK' where o.id=$1`, [orderId]); if (!orderResult.rowCount) return res.status(404).json({ error: 'Paid Paystack order not found' }); const order = orderResult.rows[0]; if (order.payment_status !== 'PAID') return res.status(409).json({ error: 'Only paid orders can be refunded' }); if (!order.provider_reference) return res.status(409).json({ error: 'Paystack transaction reference is missing' }); const refundedResult = await pool.query(`select coalesce(sum(amount),0) as total from refunds where payment_id=$1 and status in ('PENDING','PROCESSING','PROCESSED')`, [order.payment_id]); const alreadyRefunded = Number(refundedResult.rows[0].total); const remaining = Number(order.paid_amount) - alreadyRefunded; if (requestedAmount > remaining + 0.0001) return res.status(400).json({ error: `Refund exceeds the remaining refundable amount (${remaining.toFixed(2)} KES)` }); const refund = await paystackRequest('/refund', { method: 'POST', body: JSON.stringify({ transaction: order.provider_reference, amount: String(Math.round(requestedAmount * 100)), currency: 'KES', customer_note: customerNote || undefined, merchant_note: merchantNote || undefined }) }); const data = refund.data || {}; const insert = await pool.query(`insert into refunds (id,order_id,payment_id,provider,provider_refund_id,transaction_reference,amount,currency,status,customer_note,merchant_note) values (gen_random_uuid(),$1,$2,'PAYSTACK',$3,$4,$5,'KES',$6,$7,$8) returning *`, [order.id, order.payment_id, data.id ? String(data.id) : null, order.provider_reference, requestedAmount, String(data.status || 'pending').toUpperCase(), customerNote || null, merchantNote || null]); broadcastRealtime({ businessId: order.business_id, orderId: order.id, event: 'refund.updated', data: { orderId: order.id, refund: insert.rows[0] } }); res.status(201).json(insert.rows[0]); } catch (error) { res.status(500).json({ error: error.message || 'Unable to initiate refund' }); } });


app.post('/api/riders/login', requireRiderModule, async (req,res)=>{
  try{
    const {businessId,phone,password}=req.body;
    if(!businessId||!phone||!password) return res.status(400).json({error:'Business, phone and password are required'});
    const result=await pool.query(`select r.*,a.password_hash from riders r join rider_auth a on a.rider_id=r.id where r.business_id=$1 and r.phone=$2 and r.active=true`,[businessId,String(phone).trim()]);
    if(!result.rowCount||!verifyPassword(password,result.rows[0].password_hash)) return res.status(401).json({error:'Invalid rider login'});
    const token=crypto.randomBytes(32).toString('hex');
    await pool.query('insert into rider_sessions(id,rider_id,token_hash,expires_at) values(gen_random_uuid(),$1,$2,now()+interval \'30 days\')',[result.rows[0].id,hashSessionToken(token)]);
    await pool.query('update rider_auth set last_login_at=now() where rider_id=$1',[result.rows[0].id]);
    await pool.query(`insert into rider_presence(rider_id,online) values($1,true) on conflict(rider_id) do update set online=true,updated_at=now()`,[result.rows[0].id]);
    const r=result.rows[0];
    res.json({token,rider:{id:r.id,name:r.name,phone:r.phone,email:r.email,vehicle_type:r.vehicle_type,number_plate:r.number_plate,payout_phone:r.payout_phone}});
  }catch(error){res.status(500).json({error:error.message||'Unable to sign in'});}
});
app.post('/api/riders', requireRiderModule, async(req,res)=>{
  try{
    const {businessId,name,phone,email,vehicleType,numberPlate,password,payoutPhone}=req.body;
    if(!businessId||!name||!phone||!vehicleType||!numberPlate||!password) return res.status(400).json({error:'Business, name, phone, vehicle type, number plate and password are required'});
    const normalized=normalizeKenyanPhone(phone);
    const payout=normalizeKenyanPhone(payoutPhone||phone);
    const passwordData=hashPassword(password);
    const client=await pool.connect();
    try{
      await client.query('begin');
      const r=await client.query(`insert into riders(id,business_id,name,phone,email,vehicle_type,number_plate,active,payout_phone) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,true,$7) returning id,name,phone,email,vehicle_type,number_plate,active,payout_phone`,[businessId,String(name).trim(),normalized,String(email||'').trim()||null,String(vehicleType).trim(),String(numberPlate).trim(),payout]);
      await client.query('insert into rider_auth(rider_id,password_hash,payout_phone) values($1,$2,$3)',[r.rows[0].id,passwordData.hash,payout]);
      await client.query('insert into rider_presence(rider_id,online) values($1,false)',[r.rows[0].id]);
      await client.query('commit');
      res.status(201).json({...r.rows[0],available:false,trip_count:0});
    }catch(e){try{await client.query('rollback')}catch{}throw e}finally{client.release()}
  }catch(error){res.status(400).json({error:error.code==='23505'?'A rider with that phone already exists':error.message||'Unable to create rider'});}
});
app.post('/api/riders/logout', requireRiderModule, requireRiderAuth, async(req,res)=>{
  await pool.query('delete from rider_sessions where id=$1',[req.rider.session_id]);
  await pool.query(`insert into rider_presence(rider_id,online) values($1,false) on conflict(rider_id) do update set online=false,updated_at=now()`,[req.rider.id]);
  res.json({ok:true});
});
app.get('/api/riders/me', requireRiderModule, requireRiderAuth, async(req,res)=>{
  const r=req.rider; res.json({id:r.id,name:r.name,phone:r.phone,email:r.email,vehicle_type:r.vehicle_type,number_plate:r.number_plate,payout_phone:r.payout_phone,active:r.active});
});
app.post('/api/riders/:id/presence', requireRiderModule, requireRiderAuth, async(req,res)=>{
  const online=Boolean(req.body.online);
  await pool.query(`insert into rider_presence(rider_id,online) values($1,$2) on conflict(rider_id) do update set online=$2,updated_at=now()`,[req.rider.id,online]);
  res.json({online});
});
app.get('/api/riders/:id/dashboard', requireRiderModule, requireRiderAuth, async(req,res)=>{
  const id=req.rider.id;
  const [available,active,completed,earnings,weekly]=await Promise.all([
    pool.query(`select o.id,o.order_number,o.delivery_fee,o.status,o.delivery_address,o.pickup_address,o.route_distance_meters,o.route_duration_seconds,o.created_at,b.name as restaurant_name,c.name as customer_name from orders o join businesses b on b.id=o.business_id join customers c on c.id=o.customer_id where o.business_id=$1 and o.status='ACCEPTED' and not exists(select 1 from rider_trips t where t.order_id=o.id and t.completed_at is null) order by o.created_at asc`,[req.rider.business_id]),
    pool.query(`select o.*,c.name as customer_name,c.phone,c.email,t.id as trip_id,t.assigned_at,r.name as rider_name from rider_trips t join orders o on o.id=t.order_id join customers c on c.id=o.customer_id join riders r on r.id=t.rider_id where t.rider_id=$1 and t.completed_at is null order by t.assigned_at desc limit 1`,[id]),
    pool.query(`select o.order_number,o.delivery_address,o.delivery_fee,o.delivered_at,t.completed_at,t.assigned_at,extract(epoch from (t.completed_at-t.assigned_at))/60 as trip_minutes,coalesce(o.route_distance_meters,0) as distance_meters,coalesce(e.amount,0) as earning,e.status as earning_status from rider_trips t join orders o on o.id=t.order_id left join rider_earnings e on e.trip_id=t.id where t.rider_id=$1 and t.completed_at is not null order by t.completed_at desc limit 100`,[id]),
    pool.query(`select coalesce(sum(amount),0) as total from rider_earnings where rider_id=$1 and created_at::date=current_date and status in ('RELEASED','PAID')`,[id]),
    pool.query(`select coalesce(sum(amount),0) as total from rider_earnings where rider_id=$1 and created_at>=current_date-interval '6 days' and status in ('HELD','RELEASED','PAID')`,[id])
  ]);
  res.json({available:available.rows,active:active.rows[0]||null,completed:completed.rows,todayEarnings:Number(earnings.rows[0].total),weekEarnings:Number(weekly.rows[0].total)});
});
app.post('/api/riders/:id/deliveries/:tripId/accept', requireRiderModule, requireRiderAuth, async(req,res)=>{
  const result=await pool.query(`select t.*,o.status,o.business_id from rider_trips t join orders o on o.id=t.order_id where t.id=$1 and t.rider_id=$2`,[req.params.tripId,req.rider.id]);
  if(!result.rowCount) return res.status(404).json({error:'Delivery not found'});
  if(result.rows[0].completed_at) return res.status(409).json({error:'Delivery already completed'});
  await pool.query(`insert into delivery_events(id,trip_id,status) values(gen_random_uuid(),$1,'ACCEPTED')`,[req.params.tripId]);
  await pool.query(`update orders set delivery_status='ACCEPTED' where id=$1`,[result.rows[0].order_id]);
  res.json({ok:true,status:'ACCEPTED'});
});
async function createRiderRecipientAndPayout(rider, amount, tripId) {
  if (String(process.env.RIDER_AUTO_PAYOUT || 'false').toLowerCase() !== 'true') return {status:'HELD',reason:'RIDER_AUTO_PAYOUT is disabled'};
  const phone=normalizeKenyanPhone(rider.payout_phone||rider.phone);
  let recipientCode=rider.payout_recipient_code;
  if(!recipientCode){
    const recipient=await paystackRequest('/transferrecipient',{method:'POST',body:JSON.stringify({type:'mobile_money',name:rider.name,account_number:phone.replace('+254','0'),bank_code:'MPESA',currency:'KES'})});
    recipientCode=recipient.data?.recipient_code;
    if(!recipientCode) throw new Error('Paystack did not return an M-Pesa recipient code');
    await pool.query('update rider_auth set payout_recipient_code=$1 where rider_id=$2',[recipientCode,rider.id]);
  }
  const reference=`rider_${String(tripId).replace(/-/g,'').slice(0,40)}`;
  const transfer=await paystackRequest('/transfer',{method:'POST',body:JSON.stringify({source:'balance',amount:String(Math.round(Number(amount)*100)),currency:'KES',recipient:recipientCode,reference,reason:`Delivery earnings for trip ${tripId}`})});
  const data=transfer.data||{};
  await pool.query('update rider_earnings set payout_status=$1,payout_recipient_code=$2,payout_reference=$3,payout_transfer_code=$4,paid_at=case when $1=\'PAID\' then now() else null end,status=case when $1=\'PAID\' then \'PAID\' else status end where trip_id=$5',[String(data.status||'PENDING').toUpperCase()==='SUCCESS'?'PAID':'PENDING',recipientCode,reference,data.transfer_code||null,tripId]);
  return data;
}
async function updateDeliveryStatus(req,res,nextStatus){
  try{
    const result=await pool.query(`select t.*,o.status as order_status,o.id as order_id,o.business_id from rider_trips t join orders o on o.id=t.order_id where t.id=$1 and t.rider_id=$2 for update`,[req.params.tripId,req.rider.id]);
    if(!result.rowCount) return res.status(404).json({error:'Delivery not found'});
    const trip=result.rows[0];
    const allowed={ACCEPTED:['ARRIVED_AT_RESTAURANT'],ARRIVED_AT_RESTAURANT:['PICKED_UP'],PICKED_UP:['ON_THE_WAY'],ON_THE_WAY:['DELIVERED']} ;
    const last=await pool.query(`select status from delivery_events where trip_id=$1 order by created_at desc limit 1`,[trip.id]);
    const current=last.rows[0]?.status||'ASSIGNED';
    if(!allowed[current]?.includes(nextStatus)) return res.status(409).json({error:`Cannot move delivery from ${current} to ${nextStatus}`});
    await pool.query('insert into delivery_events(id,trip_id,status,note) values(gen_random_uuid(),$1,$2,$3)',[trip.id,nextStatus,req.body.note||null]);
    if(nextStatus==='DELIVERED'){
      await pool.query(`update orders set status='DELIVERED',delivered_at=coalesce(delivered_at,now()),delivery_status='DELIVERED',delivery_fee_status='RELEASED',delivery_fee_released_at=now() where id=$1`,[trip.order_id]);
      await pool.query(`update rider_trips set completed_at=now(),confirmed_by='rider' where id=$1`,[trip.id]);
      const earning=await pool.query(`insert into rider_earnings(id,rider_id,trip_id,amount,status,released_at) select gen_random_uuid(),rider_id,$1,delivery_fee,'RELEASED',now() from orders where id=$2 on conflict(trip_id) do update set status='RELEASED',released_at=now() returning *`,[trip.id,trip.order_id]);
      try {
        const rider=await pool.query('select r.*,a.payout_recipient_code from riders r left join rider_auth a on a.rider_id=r.id where r.id=$1',[req.rider.id]);
        await createRiderRecipientAndPayout(rider.rows[0],earning.rows[0].amount,trip.id);
      } catch (payoutError) {
        console.error('Rider payout queued/failed:',payoutError.message);
      }
      broadcastOrder((await pool.query('select * from orders where id=$1',[trip.order_id])).rows[0],{reason:'delivery.completed',notification:'Delivery completed'});
      return res.json({ok:true,status:nextStatus,earning:earning.rows[0]});
    }
    await pool.query('update orders set delivery_status=$1 where id=$2',[nextStatus,trip.order_id]);
    broadcastRealtime({businessId:trip.business_id,orderId:trip.order_id,event:'delivery.updated',data:{orderId:trip.order_id,status:nextStatus}});
    res.json({ok:true,status:nextStatus});
  }catch(error){res.status(500).json({error:error.message||'Unable to update delivery'});}
}
for(const [route,status] of [['arrived','ARRIVED_AT_RESTAURANT'],['picked-up','PICKED_UP'],['on-the-way','ON_THE_WAY']]){
  app.post(`/api/riders/:id/deliveries/:tripId/${route}`,requireRiderModule,requireRiderAuth,(req,res)=>updateDeliveryStatus(req,res,status));
}
app.get('/api/riders/:id/earnings',requireRiderModule,requireRiderAuth,async(req,res)=>{
  const result=await pool.query(`select e.*,o.order_number,o.delivery_address,o.delivered_at,o.route_distance_meters from rider_earnings e join rider_trips t on t.id=e.trip_id join orders o on o.id=t.order_id where e.rider_id=$1 order by e.created_at desc limit 200`,[req.rider.id]);
  res.json(result.rows);
});
app.get('/api/admin/riders',requireRiderModule,async(req,res)=>{
  const businessId=String(req.query.businessId||''); if(!businessId) return res.status(400).json({error:'businessId is required'});
  const result=await pool.query(`select r.id,r.name,r.phone,r.email,r.vehicle_type,r.number_plate,r.active,coalesce(p.online,false) as online,exists(select 1 from rider_trips t join orders o on o.id=t.order_id where t.rider_id=r.id and t.completed_at is null) as busy,count(t.id) filter(where t.completed_at is not null) as trip_count,coalesce(sum(o.route_distance_meters),0) as distance_meters,coalesce(sum(e.amount),0) as earnings from riders r left join rider_presence p on p.rider_id=r.id left join rider_trips t on t.rider_id=r.id left join orders o on o.id=t.order_id left join rider_earnings e on e.trip_id=t.id where r.business_id=$1 group by r.id,p.online order by r.name`,[businessId]);
  res.json(result.rows.map(r=>({...r,available:r.active&&r.online&&!r.busy,distance_km:Number(r.distance_meters)/1000})));
});
app.get('/api/admin/riders/:id/trips',requireRiderModule,async(req,res)=>{
  const result=await pool.query(`select t.id,t.assigned_at,t.completed_at,o.order_number,o.status,o.delivery_address,o.route_distance_meters,o.route_duration_seconds,o.delivery_fee,e.amount as rider_earning,e.status as earning_status from rider_trips t join orders o on o.id=t.order_id left join rider_earnings e on e.trip_id=t.id where t.rider_id=$1 order by t.assigned_at desc limit 200`,[req.params.id]);
  res.json(result.rows);
});
app.post('/api/orders/:id/assign-rider',requireRiderModule,async(req,res)=>{
  const client=await pool.connect();
  try{
    const {riderId}=req.body; if(!riderId) return res.status(400).json({error:'riderId is required'});
    await client.query('begin');
    const orderResult=await client.query('select * from orders where id=$1 for update',[req.params.id]);
    if(!orderResult.rowCount){await client.query('rollback');return res.status(404).json({error:'Order not found'});}
    const order=orderResult.rows[0];
    if(order.status!=='ACCEPTED'){await client.query('rollback');return res.status(409).json({error:'Only accepted orders can be sent for delivery'});}
    const riderResult=await client.query(`select r.*,coalesce(p.online,false) as online,exists(select 1 from rider_trips t join orders o on o.id=t.order_id where t.rider_id=r.id and t.completed_at is null) as busy from riders r left join rider_presence p on p.rider_id=r.id where r.id=$1 and r.business_id=$2 and r.active=true for update`,[riderId,order.business_id]);
    if(!riderResult.rowCount)return res.status(404).json({error:'Rider not found'});
    if(!riderResult.rows[0].online||riderResult.rows[0].busy){await client.query('rollback');return res.status(409).json({error:'Rider must be online and available'});}
    const trip=await client.query('insert into rider_trips(id,rider_id,order_id) values(gen_random_uuid(),$1,$2) returning id',[riderId,order.id]);
    await client.query('insert into delivery_events(id,trip_id,status) values(gen_random_uuid(),$1,\'ASSIGNED\')',[trip.rows[0].id]);
    await client.query(`update orders set status='OUT_FOR_DELIVERY',out_for_delivery_at=coalesce(out_for_delivery_at,now()),delivery_status='ASSIGNED',delivery_fee_status='HELD',rider_earning=delivery_fee where id=$1`,[order.id]);
    await client.query('commit');
    broadcastOrder((await pool.query('select * from orders where id=$1',[order.id])).rows[0],{reason:'restaurant.dispatched',notification:'New delivery assigned'});
    res.json({ok:true,tripId:trip.rows[0].id});
  }catch(error){try{await client.query('rollback')}catch{}res.status(500).json({error:error.message||'Unable to assign rider'});}finally{client.release();}
});
app.listen(port, () => console.log(`Ordering API listening on ${port}`));
