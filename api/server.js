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
app.use(express.json({
  limit: '100kb',
  verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); }
}));

function requirePaystackKey() {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new Error('PAYSTACK_SECRET_KEY is not configured');
  return process.env.PAYSTACK_SECRET_KEY;
}

function requireRefundAdmin(req, res) {
  const configured = process.env.REFUND_ADMIN_KEY;
  const supplied = req.headers['x-refund-admin-key'];
  if (!configured || !supplied || supplied !== configured) {
    res.status(401).json({ error: 'Refund authorization required' });
    return false;
  }
  return true;
}

async function paystackRequest(path, options = {}) {
  const response = await fetch(PAYSTACK_API + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${requirePaystackKey()}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
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

async function markPaymentSuccessful(reference, paystackData = null) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const paymentResult = await client.query(`select p.*, o.total, o.id as order_id from payments p join orders o on o.id=p.order_id where p.provider='PAYSTACK' and p.provider_reference=$1 for update`, [reference]);
    if (!paymentResult.rowCount) {
      await client.query('rollback');
      return null;
    }
    const payment = paymentResult.rows[0];
    const expectedSubunit = Math.round(Number(payment.total) * 100);
    if (paystackData && Number(paystackData.amount) !== expectedSubunit) {
      await client.query('rollback');
      throw new Error('Paystack amount does not match the order total');
    }
    await client.query(`update payments set status='PAID', confirmed_at=coalesce(confirmed_at,now()) where id=$1`, [payment.id]);
    await client.query(`update orders set payment_status='PAID' where id=$1`, [payment.order_id]);
    await client.query('commit');
    return payment.order_id;
  } catch (error) {
    try { await client.query('rollback'); } catch {}
    throw error;
  } finally { client.release(); }
}

async function updateRefundFromWebhook(data) {
  const transactionReference = String(data?.transaction_reference || data?.transaction?.reference || '');
  const refundProviderId = data?.refund_reference || data?.id || null;
  const status = String(data?.status || '').toUpperCase();
  if (!transactionReference || !status) return;

  const client = await pool.connect();
  try {
    await client.query('begin');
    const refundResult = await client.query(`select r.*, p.id as payment_id, p.amount as payment_amount from refunds r join payments p on p.id=r.payment_id where r.transaction_reference=$1 order by r.created_at desc limit 1 for update`, [transactionReference]);
    if (!refundResult.rowCount) {
      await client.query('rollback');
      return;
    }
    const refund = refundResult.rows[0];
    const mappedStatus = ['PENDING','PROCESSING','PROCESSED','FAILED','NEEDS-ATTENTION'].includes(status) ? status : refund.status;
    await client.query(`update refunds set status=$1, provider_refund_id=coalesce(provider_refund_id,$2), updated_at=now() where id=$3`, [mappedStatus, refundProviderId, refund.id]);

    if (mappedStatus === 'PROCESSED') {
      const totalRefunded = await client.query(`select coalesce(sum(amount),0) as total from refunds where payment_id=$1 and status='PROCESSED'`, [refund.payment_id]);
      if (Number(totalRefunded.rows[0].total) >= Number(refund.payment_amount)) {
        await client.query(`update payments set status='REFUNDED' where id=$1`, [refund.payment_id]);
        await client.query(`update orders set payment_status='REFUNDED' where id=$1`, [refund.order_id]);
      }
    }
    await client.query('commit');
  } catch (error) {
    try { await client.query('rollback'); } catch {}
    throw error;
  } finally { client.release(); }
}

app.get('/health', async (_req, res) => {
  try { await pool.query('select 1'); res.json({ ok: true, database: true }); }
  catch { res.status(503).json({ ok: false, database: false }); }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const result = await pool.query(`select o.*, c.name as customer_name, c.phone, c.email, r.name as rider_name, r.vehicle_type, r.number_plate from orders o join customers c on c.id=o.customer_id left join riders r on r.id=(select rider_id from rider_trips t where t.order_id=o.id order by assigned_at desc limit 1) where o.id=$1`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Order not found' });
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Unable to load order' }); }
});

app.get('/api/orders/:id/refunds', async (req, res) => {
  try {
    const result = await pool.query(`select id,amount,currency,status,created_at,updated_at from refunds where order_id=$1 order by created_at desc`, [req.params.id]);
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Unable to load refunds' }); }
});

app.get('/api/orders', async (req, res) => {
  try {
    const { businessId, q = '' } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId is required' });
    const result = await pool.query(`select o.id,o.order_number,o.status,o.payment_status,o.total,o.created_at,c.name,c.phone,c.email from orders o join customers c on c.id=o.customer_id where o.business_id=$1 and ($2='' or c.name ilike '%'||$2||'%' or c.phone ilike '%'||$2||'%' or coalesce(c.email,'') ilike '%'||$2||'%') order by o.created_at desc limit 200`, [businessId, String(q)]);
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Unable to load orders' }); }
});

app.post('/api/orders', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, customer, items, paymentMethod, subtotal, total, deliveryNote } = req.body;
    const normalizedPaymentMethod = paymentMethod === 'M-Pesa' ? 'M-Pesa' : paymentMethod === 'Card' ? 'Card' : null;
    const numericTotal = Number(total);
    const numericSubtotal = Number(subtotal);
    if (!businessId || !customer?.name || !customer?.phone || !customer?.email || !Array.isArray(items) || !items.length || !normalizedPaymentMethod) return res.status(400).json({ error: 'Missing order fields' });
    if (!Number.isFinite(numericTotal) || numericTotal <= 0 || !Number.isFinite(numericSubtotal) || numericSubtotal <= 0) return res.status(400).json({ error: 'Invalid order amount' });
    await client.query('begin');
    const customerResult = await client.query(`insert into customers (id,business_id,name,phone,email) values (gen_random_uuid(),$1,$2,$3,$4) on conflict (business_id,phone) do update set name=excluded.name,email=coalesce(excluded.email,customers.email) returning id`, [businessId, customer.name.trim(), customer.phone.trim(), customer.email.trim()]);
    const orderNumber = 'SB-' + Date.now().toString().slice(-8);
    const orderResult = await client.query(`insert into orders (id,business_id,customer_id,order_number,status,payment_status,payment_method,delivery_note,subtotal,total) values (gen_random_uuid(),$1,$2,$3,'NEW','PENDING',$4,$5,$6,$7) returning *`, [businessId, customerResult.rows[0].id, orderNumber, normalizedPaymentMethod, deliveryNote?.trim() || null, numericSubtotal, numericTotal]);
    for (const item of items) {
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);
      if (!item.name || !Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Invalid order item');
      await client.query(`insert into order_items (id,order_id,product_id,product_name,quantity,unit_price,options) values (gen_random_uuid(),$1,$2,$3,$4,$5,$6)`, [orderResult.rows[0].id, item.productId || null, item.name, quantity, unitPrice, item.options || {}]);
    }
    await client.query(`insert into payments (id,order_id,provider,amount,status) values (gen_random_uuid(),$1,'PAYSTACK',$2,'PENDING')`, [orderResult.rows[0].id, numericTotal]);
    await client.query('commit');
    res.status(201).json(orderResult.rows[0]);
  } catch (error) {
    await client.query('rollback');
    res.status(500).json({ error: error.message === 'Invalid order item' ? error.message : 'Unable to create order' });
  } finally { client.release(); }
});

app.post('/api/payments/paystack/initialize', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });
    const result = await pool.query(`select o.id,o.order_number,o.total,o.payment_status,o.payment_method,c.email,c.phone from orders o join customers c on c.id=o.customer_id where o.id=$1`, [orderId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Order not found' });
    const order = result.rows[0];
    if (order.payment_status === 'PAID') return res.json({ paid: true, orderId });

    const reference = `SB-${orderId.replace(/-/g, '')}-${Date.now()}`;
    await pool.query(`update payments set provider_reference=$1, status='PENDING' where order_id=$2 and provider='PAYSTACK'`, [reference, orderId]);

    if (order.payment_method === 'M-Pesa') {
      const charge = await paystackRequest('/charge', {
        method: 'POST',
        body: JSON.stringify({
          email: order.email,
          amount: String(Math.round(Number(order.total) * 100)),
          currency: 'KES',
          reference,
          mobile_money: { phone: normalizeKenyanPhone(order.phone), provider: 'mpesa' }
        })
      });
      if (charge.data?.reference && charge.data.reference !== reference) await pool.query(`update payments set provider_reference=$1 where order_id=$2 and provider='PAYSTACK'`, [charge.data.reference, orderId]);
      return res.json({ mode: 'mobile_money', orderId, reference: charge.data.reference || reference, status: charge.data.status, displayText: charge.data.display_text || 'Check your phone and approve the M-Pesa payment.' });
    }

    const transaction = await paystackRequest('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: order.email,
        amount: String(Math.round(Number(order.total) * 100)),
        currency: 'KES',
        reference,
        channels: ['card'],
        callback_url: `${process.env.API_PUBLIC_URL || 'https://restaurant-ordering-api-ow3p.onrender.com'}/api/payments/paystack/callback`,
        metadata: { order_id: order.id, order_number: order.order_number }
      })
    });
    return res.json({ mode: 'redirect', orderId, reference: transaction.data.reference, authorizationUrl: transaction.data.authorization_url });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to initialize payment' });
  }
});

app.get('/api/payments/paystack/callback', async (req, res) => {
  const reference = String(req.query.reference || '');
  if (!reference) return res.redirect(`${FRONTEND_URL}/order.html?payment=missing`);
  try {
    const verified = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
    const data = verified.data;
    if (data?.status !== 'success') throw new Error('Payment was not successful');
    const orderId = await markPaymentSuccessful(reference, data);
    if (!orderId) return res.redirect(`${FRONTEND_URL}/order.html?payment=not-found`);
    return res.redirect(`${FRONTEND_URL}/order.html?id=${encodeURIComponent(orderId)}&payment=success`);
  } catch {
    const payment = await pool.query(`select order_id from payments where provider='PAYSTACK' and provider_reference=$1`, [reference]);
    const orderId = payment.rows[0]?.order_id;
    const target = orderId ? `${FRONTEND_URL}/order.html?id=${encodeURIComponent(orderId)}&payment=failed` : `${FRONTEND_URL}/order.html?payment=failed`;
    return res.redirect(target);
  }
});

app.post('/api/payments/paystack/verify', async (req, res) => {
  try {
    const reference = String(req.body.reference || '');
    if (!reference) return res.status(400).json({ error: 'reference is required' });
    const verified = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
    if (verified.data?.status === 'success') {
      const orderId = await markPaymentSuccessful(reference, verified.data);
      return res.json({ status: 'success', orderId });
    }
    res.json({ status: verified.data?.status || 'pending' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to verify payment' });
  }
});

app.get('/api/payments/paystack/webhook', (_req, res) => {
  res.status(405).json({ error: 'Webhook endpoint accepts POST requests from Paystack.' });
});

app.post('/api/payments/paystack/webhook', async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!signature || !secret || !req.rawBody) return res.sendStatus(401);
  const expected = crypto.createHmac('sha512', secret).update(req.rawBody).digest('hex');
  const providedBuffer = Buffer.from(String(signature), 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return res.sendStatus(401);
  try {
    const event = req.body;
    if (event.event === 'charge.success' && event.data?.reference && event.data?.status === 'success') await markPaymentSuccessful(event.data.reference, event.data);
    if (event.event?.startsWith('refund.') && event.data) await updateRefundFromWebhook(event.data);
    return res.sendStatus(200);
  } catch (error) {
    console.error('Paystack webhook processing failed:', error.message);
    return res.sendStatus(500);
  }
});

app.post('/api/admin/refunds', async (req, res) => {
  if (!requireRefundAdmin(req, res)) return;
  try {
    const { orderId, amount, customerNote, merchantNote } = req.body;
    const requestedAmount = Number(amount);
    if (!orderId || !Number.isFinite(requestedAmount) || requestedAmount <= 0) return res.status(400).json({ error: 'orderId and a positive refund amount are required' });

    const orderResult = await pool.query(`select o.id,o.total,o.payment_status,p.id as payment_id,p.provider_reference,p.amount as paid_amount from orders o join payments p on p.order_id=o.id and p.provider='PAYSTACK' where o.id=$1`, [orderId]);
    if (!orderResult.rowCount) return res.status(404).json({ error: 'Paid Paystack order not found' });
    const order = orderResult.rows[0];
    if (order.payment_status !== 'PAID') return res.status(409).json({ error: 'Only paid orders can be refunded' });
    if (!order.provider_reference) return res.status(409).json({ error: 'Paystack transaction reference is missing' });

    const refundedResult = await pool.query(`select coalesce(sum(amount),0) as total from refunds where payment_id=$1 and status in ('PENDING','PROCESSING','PROCESSED')`, [order.payment_id]);
    const alreadyRefunded = Number(refundedResult.rows[0].total);
    const remaining = Number(order.paid_amount) - alreadyRefunded;
    if (requestedAmount > remaining + 0.0001) return res.status(400).json({ error: `Refund exceeds the remaining refundable amount (${remaining.toFixed(2)} KES)` });

    const refund = await paystackRequest('/refund', {
      method: 'POST',
      body: JSON.stringify({
        transaction: order.provider_reference,
        amount: String(Math.round(requestedAmount * 100)),
        currency: 'KES',
        customer_note: customerNote || undefined,
        merchant_note: merchantNote || undefined
      })
    });

    const data = refund.data || {};
    const insert = await pool.query(`insert into refunds (id,order_id,payment_id,provider,provider_refund_id,transaction_reference,amount,currency,status,customer_note,merchant_note) values (gen_random_uuid(),$1,$2,'PAYSTACK',$3,$4,$5,'KES',$6,$7,$8) returning *`, [order.id, order.payment_id, data.id ? String(data.id) : null, order.provider_reference, requestedAmount, String(data.status || 'pending').toUpperCase(), customerNote || null, merchantNote || null]);
    res.status(201).json(insert.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to initiate refund' });
  }
});

app.listen(port, () => console.log(`Ordering API listening on ${port}`));
