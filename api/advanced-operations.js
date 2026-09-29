import crypto from 'node:crypto';

const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const id=v=>clean(v,100);

function pointInPolygon(lat,lng,points){
  if(!Array.isArray(points)||points.length<3)return false;
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const yi=Number(points[i]?.lat),xi=Number(points[i]?.lng),yj=Number(points[j]?.lat),xj=Number(points[j]?.lng);
    if(![yi,xi,yj,xj].every(Number.isFinite))continue;
    const hit=((yi>lat)!==(yj>lat))&&(lng<(xj-xi)*(lat-yi)/(yj-yi)+xi);
    if(hit)inside=!inside;
  }
  return inside;
}
function haversineMeters(a,b,c,d){
  const rad=Math.PI/180,R=6371000,dl=(c-a)*rad,dg=(d-b)*rad;
  const x=Math.sin(dl/2)**2+Math.cos(a*rad)*Math.cos(c*rad)*Math.sin(dg/2)**2;
  return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

export function registerAdvancedOperations(app,pool){
  async function customer(req,res,next){
    try{
      const raw=String(req.headers.authorization||'');
      if(!raw.startsWith('Bearer '))return res.status(401).json({error:'Customer session required'});
      const r=await pool.query('select cs.customer_id,cs.business_id,c.name,c.phone,c.email from customer_sessions cs join customers c on c.id=cs.customer_id where cs.token_hash=$1 and cs.expires_at>now() limit 1',[hash(raw.slice(7).trim())]);
      if(!r.rowCount)return res.status(401).json({error:'Customer session expired'});
      req.customer={id:r.rows[0].customer_id,businessId:r.rows[0].business_id,name:r.rows[0].name,phone:r.rows[0].phone,email:r.rows[0].email};next();
    }catch{res.status(500).json({error:'Unable to verify customer session'})}
  }
  async function manager(req,res,next){
    try{
      const raw=String(req.headers.authorization||'');
      if(!raw.startsWith('Bearer '))return res.status(401).json({error:'Manager session required'});
      const r=await pool.query('select ms.manager_id,mu.business_id,mu.role from manager_sessions ms join manager_users mu on mu.id=ms.manager_id where ms.token_hash=$1 and ms.expires_at>now() and mu.active=true limit 1',[hash(raw.slice(7).trim())]);
      if(!r.rowCount)return res.status(401).json({error:'Manager session expired'});
      req.manager={id:r.rows[0].manager_id,businessId:r.rows[0].business_id,role:r.rows[0].role};next();
    }catch{res.status(500).json({error:'Unable to verify manager session'})}
  }
  async function rider(req,res,next){
    try{
      const raw=String(req.headers.authorization||'');
      if(!raw.startsWith('Bearer '))return res.status(401).json({error:'Rider session required'});
      const r=await pool.query('select rs.rider_id,r.business_id from rider_sessions rs join riders r on r.id=rs.rider_id where rs.token_hash=$1 and rs.expires_at>now() limit 1',[hash(raw.slice(7).trim())]);
      if(!r.rowCount)return res.status(401).json({error:'Rider session expired'});
      req.rider={id:r.rows[0].rider_id,businessId:r.rows[0].business_id};next();
    }catch{res.status(500).json({error:'Unable to verify rider session'})}
  }

  // 43 Reservations
  app.get('/api/customer/reservations',customer,async(req,res)=>{
    const r=await pool.query('select id,customer_name,phone,email,reservation_date,reservation_time,party_size,status,notes,created_at from restaurant_reservations where customer_id=$1 and business_id=$2 order by reservation_date desc,reservation_time desc',[req.customer.id,req.customer.businessId]);res.json(r.rows);
  });
  app.post('/api/customer/reservations',customer,async(req,res)=>{
    const date=clean(req.body.reservationDate,20),time=clean(req.body.reservationTime,20),party=Number(req.body.partySize);
    if(!date||!time||!Number.isInteger(party)||party<1||party>100)return res.status(400).json({error:'Reservation date, time and party size are required'});
    const conflict=await pool.query("select 1 from restaurant_reservations where business_id=$1 and reservation_date=$2 and reservation_time=$3 and status in ('PENDING','CONFIRMED','SEATED') limit 1",[req.customer.businessId,date,time]);
    const status=conflict.rowCount?'WAITLISTED':'PENDING';
    const r=await pool.query('insert into restaurant_reservations(business_id,customer_id,customer_name,phone,email,reservation_date,reservation_time,party_size,status,notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *',[req.customer.businessId,req.customer.id,req.customer.name,req.customer.phone,req.customer.email,date,time,party,status,clean(req.body.notes,1000)||null]);
    res.status(201).json(r.rows[0]);
  });
  app.post('/api/customer/reservations/:id/cancel',customer,async(req,res)=>{
    const r=await pool.query("update restaurant_reservations set status='CANCELLED',updated_at=now() where id=$1 and customer_id=$2 and business_id=$3 and status in ('PENDING','CONFIRMED','WAITLISTED') returning *",[id(req.params.id),req.customer.id,req.customer.businessId]);if(!r.rowCount)return res.status(404).json({error:'Reservation not found or cannot be cancelled'});res.json(r.rows[0]);
  });

  // 44 Waitlist
  app.get('/api/customer/waitlist',customer,async(req,res)=>{
    const r=await pool.query("select id,customer_name,phone,party_size,requested_for,estimated_wait_minutes,status,notes,created_at from restaurant_waitlist where customer_id=$1 and business_id=$2 order by created_at desc",[req.customer.id,req.customer.businessId]);res.json(r.rows);
  });
  app.post('/api/customer/waitlist',customer,async(req,res)=>{
    const party=Number(req.body.partySize);if(!Number.isInteger(party)||party<1||party>100)return res.status(400).json({error:'Party size is required'});
    const r=await pool.query('insert into restaurant_waitlist(business_id,customer_id,customer_name,phone,party_size,requested_for,notes) values($1,$2,$3,$4,$5,$6,$7) returning *',[req.customer.businessId,req.customer.id,req.customer.name,req.customer.phone,party,req.body.requestedFor||null,clean(req.body.notes,1000)||null]);res.status(201).json(r.rows[0]);
  });
  app.post('/api/customer/waitlist/:id/cancel',customer,async(req,res)=>{
    const r=await pool.query("update restaurant_waitlist set status='CANCELLED',updated_at=now() where id=$1 and customer_id=$2 and business_id=$3 and status in ('WAITING','NOTIFIED') returning *",[id(req.params.id),req.customer.id,req.customer.businessId]);if(!r.rowCount)return res.status(404).json({error:'Waitlist entry not found'});res.json(r.rows[0]);
  });

  // 45 Catering
  app.get('/api/customer/catering',customer,async(req,res)=>{
    const r=await pool.query('select id,customer_name,event_date,guest_count,menu_notes,budget,status,notes,created_at from catering_requests where customer_id=$1 and business_id=$2 order by event_date desc,created_at desc',[req.customer.id,req.customer.businessId]);res.json(r.rows);
  });
  app.post('/api/customer/catering',customer,async(req,res)=>{
    const date=clean(req.body.eventDate,20),guests=Number(req.body.guestCount);
    if(!date||!Number.isInteger(guests)||guests<1||guests>10000)return res.status(400).json({error:'Event date and guest count are required'});
    const budget=req.body.budget===''||req.body.budget==null?null:Number(req.body.budget);
    if(budget!==null&&(!Number.isFinite(budget)||budget<0))return res.status(400).json({error:'Budget must be a valid amount'});
    const r=await pool.query('insert into catering_requests(business_id,customer_id,customer_name,phone,email,event_date,guest_count,menu_notes,budget,notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *',[req.customer.businessId,req.customer.id,req.customer.name,req.customer.phone,req.customer.email,date,guests,clean(req.body.menuNotes,3000)||null,budget,clean(req.body.notes,1000)||null]);res.status(201).json(r.rows[0]);
  });

  // 46 Scheduled orders
  app.get('/api/customer/scheduled-orders',customer,async(req,res)=>{
    const r=await pool.query('select id,scheduled_for,order_payload,status,order_id,notes,created_at from scheduled_orders where customer_id=$1 and business_id=$2 order by scheduled_for asc',[req.customer.id,req.customer.businessId]);res.json(r.rows);
  });
  app.post('/api/customer/scheduled-orders',customer,async(req,res)=>{
    const when=new Date(req.body.scheduledFor),items=Array.isArray(req.body.items)?req.body.items:[];
    if(Number.isNaN(when.getTime())||when.getTime()<=Date.now()+15*60*1000||!items.length)return res.status(400).json({error:'Scheduled time must be at least 15 minutes from now and items are required'});
    const payload={items,deliveryAddress:clean(req.body.deliveryAddress,500)||null,deliveryNote:clean(req.body.deliveryNote,1000)||null,paymentMethod:clean(req.body.paymentMethod,50)||'M-Pesa',subtotal:Number(req.body.subtotal||0),total:Number(req.body.total||0)};
    if(!Number.isFinite(payload.total)||payload.total<0)return res.status(400).json({error:'Invalid order total'});
    const r=await pool.query('insert into scheduled_orders(business_id,customer_id,customer_name,phone,email,scheduled_for,order_payload,notes) values($1,$2,$3,$4,$5,$6,$7,$8) returning *',[req.customer.businessId,req.customer.id,req.customer.name,req.customer.phone,req.customer.email,when.toISOString(),payload,clean(req.body.notes,1000)||null]);res.status(201).json(r.rows[0]);
  });
  app.post('/api/customer/scheduled-orders/:id/cancel',customer,async(req,res)=>{
    const r=await pool.query("update scheduled_orders set status='CANCELLED',updated_at=now() where id=$1 and customer_id=$2 and business_id=$3 and status='SCHEDULED' returning *",[id(req.params.id),req.customer.id,req.customer.businessId]);if(!r.rowCount)return res.status(404).json({error:'Scheduled order not found'});res.json(r.rows[0]);
  });

  // 47 Multi-channel aggregator integrations
  app.get('/api/manager/aggregator-integrations',manager,async(req,res)=>{
    const r=await pool.query('select id,channel_code,display_name,active,config,last_received_at,created_at from aggregator_integrations where business_id=$1 order by created_at desc',[req.manager.businessId]);res.json(r.rows);
  });
  app.post('/api/manager/aggregator-integrations',manager,async(req,res)=>{
    const channel=clean(req.body.channelCode,60).toUpperCase(),name=clean(req.body.displayName,120);
    if(!channel||!name)return res.status(400).json({error:'Channel code and display name are required'});
    const secret=clean(req.body.webhookToken,200);if(secret.length<16)return res.status(400).json({error:'Webhook token must be at least 16 characters'});
    const r=await pool.query('insert into aggregator_integrations(business_id,channel_code,display_name,webhook_token_hash,config) values($1,$2,$3,$4,$5) on conflict(business_id,channel_code) do update set display_name=excluded.display_name,webhook_token_hash=excluded.webhook_token_hash,config=excluded.config,active=true returning id,channel_code,display_name,active,config',[req.manager.businessId,channel,name,hash(secret),req.body.config||{}]);res.status(201).json({...r.rows[0],webhookToken:secret});
  });
  app.patch('/api/manager/aggregator-integrations/:id',manager,async(req,res)=>{
    const r=await pool.query('update aggregator_integrations set active=coalesce($1,active),config=coalesce($2,config) where id=$3 and business_id=$4 returning id,channel_code,display_name,active,config,last_received_at',[req.body.active===undefined?null:Boolean(req.body.active),req.body.config||null,id(req.params.id),req.manager.businessId]);if(!r.rowCount)return res.status(404).json({error:'Integration not found'});res.json(r.rows[0]);
  });
  app.post('/api/aggregator/:channel/webhook',async(req,res)=>{
    const channel=clean(req.params.channel,60).toUpperCase(),provided=clean(req.headers['x-aggregator-token'],200);
    if(!provided)return res.status(401).json({error:'Aggregator token required'});
    const r=await pool.query('select * from aggregator_integrations where business_id=$1 and channel_code=$2 and active=true limit 1',[clean(req.body.businessId,100),channel]);
    if(!r.rowCount||hash(provided)!==r.rows[0].webhook_token_hash)return res.status(401).json({error:'Invalid aggregator token'});
    const external=clean(req.body.externalOrderId||req.body.id,200);if(!external)return res.status(400).json({error:'externalOrderId is required'});
    const saved=await pool.query('insert into aggregator_orders(integration_id,external_order_id,business_id,payload) values($1,$2,$3,$4) on conflict(integration_id,external_order_id) do update set payload=excluded.payload,status=\'RECEIVED\' returning id',[r.rows[0].id,external,r.rows[0].business_id,req.body]);
    await pool.query('update aggregator_integrations set last_received_at=now() where id=$1',[r.rows[0].id]);
    res.status(202).json({received:true,aggregatorOrderId:saved.rows[0].id});
  });
  app.get('/api/manager/aggregator-orders',manager,async(req,res)=>{
    const r=await pool.query('select ao.id,ai.channel_code,ai.display_name,ao.external_order_id,ao.status,ao.payload,ao.received_at from aggregator_orders ao join aggregator_integrations ai on ai.id=ao.integration_id where ao.business_id=$1 order by ao.received_at desc limit 100',[req.manager.businessId]);res.json(r.rows);
  });

  // 48 Advanced delivery zones
  app.get('/api/manager/delivery-zones',manager,async(req,res)=>{
    const r=await pool.query('select * from delivery_zones where business_id=$1 order by priority desc,created_at desc',[req.manager.businessId]);res.json(r.rows);
  });
  app.post('/api/manager/delivery-zones',manager,async(req,res)=>{
    const type=clean(req.body.zoneType,20).toUpperCase(),fee=Number(req.body.fee||0),minimum=Number(req.body.minimumOrder||0);
    if(!['RADIUS','POLYGON'].includes(type)||!clean(req.body.name,100)||!Number.isFinite(fee)||fee<0||!Number.isFinite(minimum)||minimum<0)return res.status(400).json({error:'Valid zone name, type, fee and minimum order are required'});
    if(type==='RADIUS'&&(!Number.isFinite(Number(req.body.centerLatitude))||!Number.isFinite(Number(req.body.centerLongitude))||!Number(req.body.radiusMeters)>0))return res.status(400).json({error:'Radius zones require center coordinates and radius'});
    if(type==='POLYGON'&&(!Array.isArray(req.body.polygon)||req.body.polygon.length<3))return res.status(400).json({error:'Polygon zones require at least three points'});
    const r=await pool.query('insert into delivery_zones(business_id,name,zone_type,fee,minimum_order,radius_meters,center_latitude,center_longitude,polygon,priority) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *',[req.manager.businessId,clean(req.body.name,100),type,fee,minimum,type==='RADIUS'?Number(req.body.radiusMeters):null,type==='RADIUS'?Number(req.body.centerLatitude):null,type==='RADIUS'?Number(req.body.centerLongitude):null,type==='POLYGON'?req.body.polygon:null,Number(req.body.priority||0)]);res.status(201).json(r.rows[0]);
  });
  app.patch('/api/manager/delivery-zones/:id',manager,async(req,res)=>{
    const r=await pool.query('update delivery_zones set active=coalesce($1,active),fee=coalesce($2,fee),minimum_order=coalesce($3,minimum_order),priority=coalesce($4,priority),updated_at=now() where id=$5 and business_id=$6 returning *',[req.body.active===undefined?null:Boolean(req.body.active),req.body.fee===undefined?null:Number(req.body.fee),req.body.minimumOrder===undefined?null:Number(req.body.minimumOrder),req.body.priority===undefined?null:Number(req.body.priority),id(req.params.id),req.manager.businessId]);if(!r.rowCount)return res.status(404).json({error:'Delivery zone not found'});res.json(r.rows[0]);
  });
  app.post('/api/delivery/zones/quote',async(req,res)=>{
    const businessId=id(req.body.businessId),lat=Number(req.body.latitude),lng=Number(req.body.longitude),amount=Number(req.body.orderAmount||0);
    if(!businessId||!Number.isFinite(lat)||!Number.isFinite(lng))return res.status(400).json({error:'Business, latitude and longitude are required'});
    const zones=await pool.query('select * from delivery_zones where business_id=$1 and active=true order by priority desc',[businessId]);
    const matches=zones.rows.filter(z=>z.zone_type==='RADIUS'?Number.isFinite(Number(z.center_latitude))&&haversineMeters(Number(z.center_latitude),Number(z.center_longitude),lat,lng)<=Number(z.radius_meters):pointInPolygon(lat,lng,z.polygon));
    if(!matches.length)return res.status(404).json({error:'Location is outside the configured delivery zones'});
    const zone=matches[0];if(amount<Number(zone.minimum_order))return res.status(400).json({error:'Order does not meet this delivery zone minimum order'});
    res.json({zoneId:zone.id,zoneName:zone.name,deliveryFee:Number(zone.fee),minimumOrder:Number(zone.minimum_order)});
  });

  // 49 Proof of delivery
  app.post('/api/riders/orders/:orderId/proof-of-delivery',rider,async(req,res)=>{
    const order=await pool.query("select id from orders where id=$1 and business_id=$2 limit 1",[id(req.params.orderId),req.rider.businessId]);
    if(!order.rowCount)return res.status(404).json({error:'Order not found'});
    const type=clean(req.body.proofType,20).toUpperCase();if(!['RECIPIENT','PHOTO','SIGNATURE','NOTE'].includes(type))return res.status(400).json({error:'Invalid proof type'});
    if(type==='PHOTO'&&clean(req.body.photoUrl,2000).length>2000)return res.status(400).json({error:'Photo URL is too long'});
    const r=await pool.query('insert into proof_of_delivery(business_id,order_id,rider_id,proof_type,recipient_name,photo_url,signature_data,note,latitude,longitude) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id,proof_type,recipient_name,photo_url,note,latitude,longitude,captured_at',[req.rider.businessId,id(req.params.orderId),req.rider.id,type,clean(req.body.recipientName,200)||null,clean(req.body.photoUrl,2000)||null,clean(req.body.signatureData,20000)||null,clean(req.body.note,2000)||null,req.body.latitude??null,req.body.longitude??null]);res.status(201).json(r.rows[0]);
  });
  app.get('/api/riders/orders/:orderId/proof-of-delivery',rider,async(req,res)=>{
    const r=await pool.query('select * from proof_of_delivery where order_id=$1 and business_id=$2 order by created_at desc',[id(req.params.orderId),req.rider.businessId]);res.json(r.rows);
  });
  app.get('/api/manager/orders/:orderId/proof-of-delivery',manager,async(req,res)=>{
    const r=await pool.query('select * from proof_of_delivery where order_id=$1 and business_id=$2 order by created_at desc',[id(req.params.orderId),req.manager.businessId]);res.json(r.rows);
  });

  // Manager operations for reservation/waitlist/catering/scheduled orders.
  app.get('/api/manager/reservations',manager,async(req,res)=>{
    const r=await pool.query('select * from restaurant_reservations where business_id=$1 order by reservation_date,reservation_time',[req.manager.businessId]);res.json(r.rows);
  });
  app.patch('/api/manager/reservations/:id',manager,async(req,res)=>{
    const status=clean(req.body.status,30).toUpperCase();if(!['PENDING','CONFIRMED','SEATED','COMPLETED','CANCELLED','NO_SHOW','WAITLISTED'].includes(status))return res.status(400).json({error:'Invalid reservation status'});
    const r=await pool.query('update restaurant_reservations set status=$1,table_id=coalesce($2,table_id),updated_at=now() where id=$3 and business_id=$4 returning *',[status,req.body.tableId||null,id(req.params.id),req.manager.businessId]);if(!r.rowCount)return res.status(404).json({error:'Reservation not found'});res.json(r.rows[0]);
  });
  app.get('/api/manager/waitlist',manager,async(req,res)=>{
    const r=await pool.query('select * from restaurant_waitlist where business_id=$1 order by created_at',[req.manager.businessId]);res.json(r.rows);
  });
  app.patch('/api/manager/waitlist/:id',manager,async(req,res)=>{
    const status=clean(req.body.status,30).toUpperCase();if(!['WAITING','NOTIFIED','SEATED','CANCELLED','EXPIRED'].includes(status))return res.status(400).json({error:'Invalid waitlist status'});
    const r=await pool.query('update restaurant_waitlist set status=$1,estimated_wait_minutes=coalesce($2,estimated_wait_minutes),updated_at=now() where id=$3 and business_id=$4 returning *',[status,req.body.estimatedWaitMinutes===undefined?null:Number(req.body.estimatedWaitMinutes),id(req.params.id),req.manager.businessId]);if(!r.rowCount)return res.status(404).json({error:'Waitlist entry not found'});res.json(r.rows[0]);
  });
  app.get('/api/manager/catering',manager,async(req,res)=>{
    const r=await pool.query('select * from catering_requests where business_id=$1 order by event_date,created_at',[req.manager.businessId]);res.json(r.rows);
  });
  app.patch('/api/manager/catering/:id',manager,async(req,res)=>{
    const status=clean(req.body.status,30).toUpperCase();if(!['PENDING','QUOTED','CONFIRMED','COMPLETED','CANCELLED'].includes(status))return res.status(400).json({error:'Invalid catering status'});
    const r=await pool.query('update catering_requests set status=$1,notes=coalesce($2,notes),updated_at=now() where id=$3 and business_id=$4 returning *',[status,clean(req.body.notes,1000)||null,id(req.params.id),req.manager.businessId]);if(!r.rowCount)return res.status(404).json({error:'Catering request not found'});res.json(r.rows[0]);
  });
  app.get('/api/manager/scheduled-orders',manager,async(req,res)=>{
    const r=await pool.query('select * from scheduled_orders where business_id=$1 order by scheduled_for',[req.manager.businessId]);res.json(r.rows);
  });
  app.patch('/api/manager/scheduled-orders/:id',manager,async(req,res)=>{
    const status=clean(req.body.status,30).toUpperCase();if(!['SCHEDULED','PROCESSING','COMPLETED','CANCELLED'].includes(status))return res.status(400).json({error:'Invalid scheduled order status'});
    const r=await pool.query('update scheduled_orders set status=$1,updated_at=now() where id=$2 and business_id=$3 returning *',[status,id(req.params.id),req.manager.businessId]);if(!r.rowCount)return res.status(404).json({error:'Scheduled order not found'});res.json(r.rows[0]);
  });
}
