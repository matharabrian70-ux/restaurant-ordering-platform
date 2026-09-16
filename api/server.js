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

app.use(cors());
app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));

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
app.get('/api/riders', async (req, res) => { try { const { businessId } = req.query; if (!businessId) return res.status(400).json({ error: 'businessId is required' }); const result = await pool.query(`select r.id,r.name,r.phone,r.vehicle_type,r.number_plate,r.active,exists(select 1 from rider_trips t join orders o on o.id=t.order_id where t.rider_id=r.id and o.status='OUT_FOR_DELIVERY' and t.completed_at is null) as busy,(select count(*) from rider_trips t where t.rider_id=r.id and t.completed_at is not null) as trip_count from riders r where r.business_id=$1 order by r.name`, [businessId]); res.json(result.rows.map(r => ({ ...r, available: r.active && !r.busy }))); } catch { res.status(500).json({ error: 'Unable to load riders' }); } });
app.post('/api/riders', async (req, res) => { try { const { businessId, name, phone, vehicleType, numberPlate } = req.body; if (!businessId || !name || !phone || !vehicleType || !numberPlate) return res.status(400).json({ error: 'Business, name, phone, vehicle type and number plate are required' }); const result = await pool.query(`insert into riders (id,business_id,name,phone,vehicle_type,number_plate,active) values (gen_random_uuid(),$1,$2,$3,$4,$5,true) returning id,name,phone,vehicle_type,number_plate,active`, [businessId, String(name).trim(), String(phone).trim(), String(vehicleType).trim(), String(numberPlate).trim()]); res.status(201).json({ ...result.rows[0], available: true, trip_count: 0 }); } catch { res.status(500).json({ error: 'Unable to create rider' }); } });
app.get('/api/riders/:id/active-delivery', async (req, res) => { try { const result = await pool.query(`select o.*,c.name as customer_name,c.phone,c.email,r.name as rider_name,r.vehicle_type,r.number_plate,r.phone as rider_phone,t.assigned_at from rider_trips t join orders o on o.id=t.order_id join customers c on c.id=o.customer_id join riders r on r.id=t.rider_id where t.rider_id=$1 and o.status='OUT_FOR_DELIVERY' and t.completed_at is null order by t.assigned_at desc limit 1`, [req.params.id]); res.json(result.rows[0] || null); } catch { res.status(500).json({ error: 'Unable to load active delivery' }); } });
app.post('/api/riders/:id/complete-delivery', async (req, res) => { const client = await pool.connect(); try { await client.query('begin'); const result = await client.query(`select t.id as trip_id,t.order_id from rider_trips t join orders o on o.id=t.order_id where t.rider_id=$1 and o.status='OUT_FOR_DELIVERY' and t.completed_at is null order by t.assigned_at desc limit 1 for update of t`, [req.params.id]); if (!result.rowCount) { await client.query('rollback'); return res.status(404).json({ error: 'No active delivery' }); } const trip = result.rows[0]; await client.query(`update orders set status='DELIVERED',delivered_at=coalesce(delivered_at,now()) where id=$1`, [trip.order_id]); await client.query(`update rider_trips set completed_at=now(),confirmed_by='rider' where id=$1`, [trip.trip_id]); const order = await client.query(`select * from orders where id=$1`, [trip.order_id]); await client.query('commit'); broadcastOrder(order.rows[0], { reason: 'delivery.completed' }); res.json(order.rows[0]); } catch (error) { try { await client.query('rollback'); } catch {} res.status(500).json({ error: error.message || 'Unable to complete delivery' }); } finally { client.release(); } });
app.post('/api/orders/:id/status', async (req, res) => { try { const nextStatus = String(req.body.status || '').toUpperCase(); if (!['ACCEPTED','DELIVERED'].includes(nextStatus)) return res.status(400).json({ error: 'Invalid status transition' }); const orderResult = await pool.query(`select * from orders where id=$1 for update`, [req.params.id]); if (!orderResult.rowCount) return res.status(404).json({ error: 'Order not found' }); const order = orderResult.rows[0]; if (nextStatus === 'ACCEPTED' && !(order.status === 'NEW' && order.payment_status === 'PAID')) return res.status(409).json({ error: 'Only paid NEW orders can be accepted' }); if (nextStatus === 'DELIVERED' && order.status !== 'OUT_FOR_DELIVERY') return res.status(409).json({ error: 'Only orders out for delivery can be delivered' }); const result = nextStatus === 'ACCEPTED' ? await pool.query(`update orders set status='ACCEPTED',accepted_at=coalesce(accepted_at,now()) where id=$1 returning *`, [req.params.id]) : await pool.query(`update orders set status='DELIVERED',delivered_at=coalesce(delivered_at,now()) where id=$1 returning *`, [req.params.id]); broadcastOrder(result.rows[0], { reason: nextStatus === 'ACCEPTED' ? 'restaurant.accepted' : 'restaurant.delivered' }); res.json(result.rows[0]); } catch { res.status(500).json({ error: 'Unable to update order status' }); } });
app.post('/api/orders/:id/assign-rider', async (req, res) => { const client = await pool.connect(); try { const { riderId } = req.body; if (!riderId) return res.status(400).json({ error: 'riderId is required' }); await client.query('begin'); const orderResult = await client.query(`select * from orders where id=$1 for update`, [req.params.id]); if (!orderResult.rowCount) { await client.query('rollback'); return res.status(404).json({ error: 'Order not found' }); } const order = orderResult.rows[0]; if (order.status !== 'ACCEPTED') { await client.query('rollback'); return res.status(409).json({ error: 'Only accepted orders can be sent for delivery' }); } const riderResult = await client.query(`select r.*,exists(select 1 from rider_trips t join orders o on o.id=t.order_id where t.rider_id=r.id and o.status='OUT_FOR_DELIVERY' and t.completed_at is null) as busy from riders r where r.id=$1 and r.business_id=$2 and r.active=true for update`, [riderId, order.business_id]); if (!riderResult.rowCount) { await client.query('rollback'); return res.status(404).json({ error: 'Rider not found' }); } if (riderResult.rows[0].busy) { await client.query('rollback'); return res.status(409).json({ error: 'Rider is already delivering' }); } await client.query(`insert into rider_trips (id,rider_id,order_id) values (gen_random_uuid(),$1,$2)`, [riderId, order.id]); const updated = await client.query(`update orders set status='OUT_FOR_DELIVERY',out_for_delivery_at=coalesce(out_for_delivery_at,now()) where id=$1 returning *`, [order.id]); await client.query('commit'); broadcastOrder(updated.rows[0], { reason: 'restaurant.dispatched' }); res.json(updated.rows[0]); } catch (error) { try { await client.query('rollback'); } catch {} res.status(500).json({ error: error.message || 'Unable to assign rider' }); } finally { client.release(); } });
app.post('/api/orders/:id/cancel', async (req, res) => { const client = await pool.connect(); try { let order; try { await client.query('begin'); const result = await client.query(`select * from orders where id=$1 for update`, [req.params.id]); if (!result.rowCount) { await client.query('rollback'); return res.status(404).json({ error: 'Order not found' }); } order = result.rows[0]; if (order.status !== 'NEW') { await client.query('rollback'); return res.status(409).json({ error: 'This order can no longer be cancelled because the restaurant has accepted it.' }); } await client.query(`update orders set status='CANCELLED' where id=$1`, [order.id]); const updated = await client.query(`select * from orders where id=$1`, [order.id]); await client.query('commit'); order = updated.rows[0]; broadcastOrder(order, { reason: 'customer.cancelled' }); } catch (error) { try { await client.query('rollback'); } catch {} throw error; } let refund = null; if (order.payment_status === 'PAID') refund = await initiateRefundForOrder(order.id, 'Customer cancelled before restaurant acceptance', 'Automatic cancellation refund'); const latest = await pool.query(`select * from orders where id=$1`, [order.id]); res.json({ order: latest.rows[0], refund }); } catch (error) { res.status(500).json({ error: error.message || 'Unable to cancel order' }); } finally { client.release(); } });
app.post('/api/orders', async (req, res) => { const client = await pool.connect(); try { const { businessId, customer, items, paymentMethod, subtotal, total, deliveryNote } = req.body; const normalizedPaymentMethod = paymentMethod === 'M-Pesa' ? 'M-Pesa' : paymentMethod === 'Card' ? 'Card' : null; const numericTotal = Number(total); const numericSubtotal = Number(subtotal); if (!businessId || !customer?.name || !customer?.phone || !customer?.email || !Array.isArray(items) || !items.length || !normalizedPaymentMethod) return res.status(400).json({ error: 'Missing order fields' }); if (!Number.isFinite(numericTotal) || numericTotal <= 0 || !Number.isFinite(numericSubtotal) || numericSubtotal <= 0) return res.status(400).json({ error: 'Invalid order amount' }); await client.query('begin'); const customerResult = await client.query(`insert into customers (id,business_id,name,phone,email) values (gen_random_uuid(),$1,$2,$3,$4) on conflict (business_id,phone) do update set name=excluded.name,email=coalesce(excluded.email,customers.email) returning id`, [businessId, customer.name.trim(), customer.phone.trim(), customer.email.trim()]); const orderNumber = 'SB-' + Date.now().toString().slice(-8); const orderResult = await client.query(`insert into orders (id,business_id,customer_id,order_number,status,payment_status,payment_method,delivery_note,subtotal,total) values (gen_random_uuid(),$1,$2,$3,'NEW','PENDING',$4,$5,$6,$7) returning *`, [businessId, customerResult.rows[0].id, orderNumber, normalizedPaymentMethod, deliveryNote?.trim() || null, numericSubtotal, numericTotal]); for (const item of items) { const quantity = Number(item.quantity); const unitPrice = Number(item.unitPrice); if (!item.name || !Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Invalid order item'); await client.query(`insert into order_items (id,order_id,product_id,product_name,quantity,unit_price,options) values (gen_random_uuid(),$1,$2,$3,$4,$5,$6)`, [orderResult.rows[0].id, item.productId || null, item.name, quantity, unitPrice, item.options || {}]); } await client.query(`insert into payments (id,order_id,provider,amount,status) values (gen_random_uuid(),$1,'PAYSTACK',$2,'PENDING')`, [orderResult.rows[0].id, numericTotal]); await client.query('commit'); res.status(201).json(orderResult.rows[0]); } catch (error) { try { await client.query('rollback'); } catch {} res.status(500).json({ error: error.message === 'Invalid order item' ? error.message : 'Unable to create order' }); } finally { client.release(); } });
app.post('/api/payments/paystack/initialize', async (req, res) => { try { const { orderId } = req.body; if (!orderId) return res.status(400).json({ error: 'orderId is required' }); const result = await pool.query(`select o.id,o.order_number,o.total,o.payment_status,o.payment_method,o.status,c.email,c.phone from orders o join customers c on c.id=o.customer_id where o.id=$1`, [orderId]); if (!result.rowCount) return res.status(404).json({ error: 'Order not found' }); const order = result.rows[0]; if (order.status === 'CANCELLED') return res.status(409).json({ error: 'Order is cancelled' }); if (order.payment_status === 'PAID') return res.json({ paid: true, orderId }); const reference = `SB-${orderId.replace(/-/g, '')}-${Date.now()}`; await pool.query(`update payments set provider_reference=$1, status='PENDING' where order_id=$2 and provider='PAYSTACK'`, [reference, orderId]); if (order.payment_method === 'M-Pesa') { const charge = await paystackRequest('/charge', { method: 'POST', body: JSON.stringify({ email: order.email, amount: String(Math.round(Number(order.total) * 100)), currency: 'KES', reference, mobile_money: { phone: normalizeKenyanPhone(order.phone), provider: 'mpesa' } }) }); if (charge.data?.reference && charge.data.reference !== reference) await pool.query(`update payments set provider_reference=$1 where order_id=$2 and provider='PAYSTACK'`, [charge.data.reference, orderId]); return res.json({ mode: 'mobile_money', orderId, reference: charge.data.reference || reference, status: charge.data.status, displayText: charge.data.display_text || 'Check your phone and approve the M-Pesa payment.' }); } const transaction = await paystackRequest('/transaction/initialize', { method: 'POST', body: JSON.stringify({ email: order.email, amount: String(Math.round(Number(order.total) * 100)), currency: 'KES', reference, channels: ['card'], callback_url: `${process.env.API_PUBLIC_URL || 'https://restaurant-ordering-api-ow3p.onrender.com'}/api/payments/paystack/callback`, metadata: { order_id: order.id, order_number: order.order_number } }) }); return res.json({ mode: 'redirect', orderId, reference: transaction.data.reference, authorizationUrl: transaction.data.authorization_url }); } catch (error) { res.status(500).json({ error: error.message || 'Unable to initialize payment' }); } });
app.get('/api/payments/paystack/callback', async (req, res) => { const reference = String(req.query.reference || ''); if (!reference) return res.redirect(`${FRONTEND_URL}/order.html?payment=missing`); try { const verified = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' }); const data = verified.data; if (data?.status !== 'success') throw new Error('Payment was not successful'); const orderId = await markPaymentSuccessful(reference, data); if (!orderId) return res.redirect(`${FRONTEND_URL}/order.html?payment=not-found`); return res.redirect(`${FRONTEND_URL}/order.html?id=${encodeURIComponent(orderId)}&payment=success`); } catch { const payment = await pool.query(`select order_id from payments where provider='PAYSTACK' and provider_reference=$1`, [reference]); const orderId = payment.rows[0]?.order_id; const target = orderId ? `${FRONTEND_URL}/order.html?id=${encodeURIComponent(orderId)}&payment=failed` : `${FRONTEND_URL}/order.html?payment=failed`; return res.redirect(target); } });
app.post('/api/payments/paystack/verify', async (req, res) => { try { const reference = String(req.body.reference || ''); if (!reference) return res.status(400).json({ error: 'reference is required' }); const verified = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' }); if (verified.data?.status === 'success') { const orderId = await markPaymentSuccessful(reference, verified.data); return res.json({ status: 'success', orderId }); } res.json({ status: verified.data?.status || 'pending' }); } catch (error) { res.status(500).json({ error: error.message || 'Unable to verify payment' }); } });
app.get('/api/payments/paystack/webhook', (_req, res) => { res.status(405).json({ error: 'Webhook endpoint accepts POST requests from Paystack.' }); });
app.post('/api/payments/paystack/webhook', async (req, res) => { const signature = req.headers['x-paystack-signature']; const secret = process.env.PAYSTACK_SECRET_KEY; if (!signature || !secret || !req.rawBody) return res.sendStatus(401); const expected = crypto.createHmac('sha512', secret).update(req.rawBody).digest('hex'); const providedBuffer = Buffer.from(String(signature), 'utf8'); const expectedBuffer = Buffer.from(expected, 'utf8'); if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return res.sendStatus(401); try { const event = req.body; if (event.event === 'charge.success' && event.data?.reference && event.data?.status === 'success') await markPaymentSuccessful(event.data.reference, event.data); if (event.event?.startsWith('refund.') && event.data) await updateRefundFromWebhook(event.data); return res.sendStatus(200); } catch (error) { console.error('Paystack webhook processing failed:', error.message); return res.sendStatus(500); } });
app.post('/api/admin/refunds', async (req, res) => { if (!requireRefundAdmin(req, res)) return; try { const { orderId, amount, customerNote, merchantNote } = req.body; const requestedAmount = Number(amount); if (!orderId || !Number.isFinite(requestedAmount) || requestedAmount <= 0) return res.status(400).json({ error: 'orderId and a positive refund amount are required' }); const orderResult = await pool.query(`select o.id,o.business_id,o.total,o.payment_status,p.id as payment_id,p.provider_reference,p.amount as paid_amount from orders o join payments p on p.order_id=o.id and p.provider='PAYSTACK' where o.id=$1`, [orderId]); if (!orderResult.rowCount) return res.status(404).json({ error: 'Paid Paystack order not found' }); const order = orderResult.rows[0]; if (order.payment_status !== 'PAID') return res.status(409).json({ error: 'Only paid orders can be refunded' }); if (!order.provider_reference) return res.status(409).json({ error: 'Paystack transaction reference is missing' }); const refundedResult = await pool.query(`select coalesce(sum(amount),0) as total from refunds where payment_id=$1 and status in ('PENDING','PROCESSING','PROCESSED')`, [order.payment_id]); const alreadyRefunded = Number(refundedResult.rows[0].total); const remaining = Number(order.paid_amount) - alreadyRefunded; if (requestedAmount > remaining + 0.0001) return res.status(400).json({ error: `Refund exceeds the remaining refundable amount (${remaining.toFixed(2)} KES)` }); const refund = await paystackRequest('/refund', { method: 'POST', body: JSON.stringify({ transaction: order.provider_reference, amount: String(Math.round(requestedAmount * 100)), currency: 'KES', customer_note: customerNote || undefined, merchant_note: merchantNote || undefined }) }); const data = refund.data || {}; const insert = await pool.query(`insert into refunds (id,order_id,payment_id,provider,provider_refund_id,transaction_reference,amount,currency,status,customer_note,merchant_note) values (gen_random_uuid(),$1,$2,'PAYSTACK',$3,$4,$5,'KES',$6,$7,$8) returning *`, [order.id, order.payment_id, data.id ? String(data.id) : null, order.provider_reference, requestedAmount, String(data.status || 'pending').toUpperCase(), customerNote || null, merchantNote || null]); broadcastRealtime({ businessId: order.business_id, orderId: order.id, event: 'refund.updated', data: { orderId: order.id, refund: insert.rows[0] } }); res.status(201).json(insert.rows[0]); } catch (error) { res.status(500).json({ error: error.message || 'Unable to initiate refund' }); } });

app.listen(port, () => console.log(`Ordering API listening on ${port}`));
