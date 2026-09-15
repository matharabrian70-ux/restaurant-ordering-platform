import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.get('/health', async (_req, res) => {
  try { await pool.query('select 1'); res.json({ ok:true, database:true }); }
  catch { res.status(503).json({ ok:false, database:false }); }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const result = await pool.query(`select o.*, c.name as customer_name, c.phone, c.email, r.name as rider_name, r.vehicle_type, r.number_plate from orders o join customers c on c.id=o.customer_id left join riders r on r.id=(select rider_id from rider_trips t where t.order_id=o.id order by assigned_at desc limit 1) where o.id=$1`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error:'Order not found' });
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error:'Unable to load order' }); }
});

app.get('/api/orders', async (req, res) => {
  try {
    const { businessId, q='' } = req.query;
    if (!businessId) return res.status(400).json({ error:'businessId is required' });
    const result = await pool.query(`select o.id,o.order_number,o.status,o.payment_status,o.total,o.created_at,c.name,c.phone,c.email from orders o join customers c on c.id=o.customer_id where o.business_id=$1 and ($2='' or c.name ilike '%'||$2||'%' or c.phone ilike '%'||$2||'%' or coalesce(c.email,'') ilike '%'||$2||'%') order by o.created_at desc limit 200`, [businessId, String(q)]);
    res.json(result.rows);
  } catch { res.status(500).json({ error:'Unable to load orders' }); }
});

app.post('/api/orders', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, customer, items, paymentMethod, subtotal, total, deliveryNote } = req.body;
    if (!businessId || !customer?.name || !customer?.phone || !Array.isArray(items) || !items.length) return res.status(400).json({ error:'Missing order fields' });
    await client.query('begin');
    const customerResult = await client.query(`insert into customers (id,business_id,name,phone,email) values (gen_random_uuid(),$1,$2,$3,$4) on conflict (business_id,phone) do update set name=excluded.name,email=coalesce(excluded.email,customers.email) returning id`, [businessId,customer.name,customer.phone,customer.email || null]);
    const orderNumber = 'SB-' + Date.now().toString().slice(-8);
    const orderResult = await client.query(`insert into orders (id,business_id,customer_id,order_number,status,payment_status,payment_method,delivery_note,subtotal,total) values (gen_random_uuid(),$1,$2,$3,'NEW','PENDING',$4,$5,$6,$7) returning *`, [businessId,customerResult.rows[0].id,orderNumber,paymentMethod || null,deliveryNote || null,subtotal,total]);
    for (const item of items) await client.query(`insert into order_items (id,order_id,product_id,product_name,quantity,unit_price,options) values (gen_random_uuid(),$1,$2,$3,$4,$5,$6)`, [orderResult.rows[0].id,item.productId || null,item.name,item.quantity,item.unitPrice,item.options || {}]);
    await client.query('commit');
    res.status(201).json(orderResult.rows[0]);
  } catch (error) { await client.query('rollback'); res.status(500).json({ error:'Unable to create order' }); }
  finally { client.release(); }
});

app.listen(port, () => console.log(`Ordering API listening on ${port}`));
