import crypto from 'node:crypto';

const text=(v,n=200)=>String(v??'').trim().slice(0,n);
const money=v=>{const n=Number(v);if(!Number.isFinite(n)||n<0)throw new Error('Invalid monetary value');return Math.round(n*100)/100};
const integer=(v,min=1,max=100)=>{const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw new Error('Invalid integer');return n};
const orderNumber=()=> 'POS-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(2).toString('hex').toUpperCase();

export function registerPosEngine(app,pool,{requireManager,broadcastRealtime}){
 const auth=(req,res,next)=>requireManager(req,res,next);

 app.get('/api/pos/order-types',auth,async(req,res)=>{
  try{const r=await pool.query('select id,code,name,active,sort_order from restaurant_order_types where business_id=$1 order by sort_order,name',[req.manager.business_id]);res.json(r.rows)}
  catch(e){res.status(500).json({error:'Unable to load order types'})}
 });
 app.post('/api/pos/order-types',auth,async(req,res)=>{
  try{
   const code=text(req.body.code,40).toUpperCase().replace(/[^A-Z0-9_]+/g,'_'),name=text(req.body.name,80);
   if(!code||!name)return res.status(400).json({error:'Code and name are required'});
   const r=await pool.query('insert into restaurant_order_types(business_id,code,name,sort_order) values($1,$2,$3,$4) on conflict(business_id,code) do update set name=excluded.name,active=true,sort_order=excluded.sort_order,updated_at=now() returning *',[req.manager.business_id,code,name,Number(req.body.sortOrder)||0]);
   res.status(201).json(r.rows[0]);
  }catch(e){res.status(400).json({error:e.message})}
 });
 app.patch('/api/pos/order-types/:id',auth,async(req,res)=>{
  try{
   const r=await pool.query('update restaurant_order_types set name=$1,active=$2,sort_order=$3,updated_at=now() where id=$4 and business_id=$5 returning *',[text(req.body.name,80),Boolean(req.body.active),Number(req.body.sortOrder)||0,req.params.id,req.manager.business_id]);
   if(!r.rowCount)return res.status(404).json({error:'Order type not found'});res.json(r.rows[0]);
  }catch(e){res.status(400).json({error:'Unable to update order type'})}
 });

 app.get('/api/pos/tables',auth,async(req,res)=>{
  try{const r=await pool.query('select * from restaurant_tables where business_id=$1 order by table_number',[req.manager.business_id]);res.json(r.rows)}
  catch(e){res.status(500).json({error:'Unable to load tables'})}
 });
 app.post('/api/pos/tables',auth,async(req,res)=>{
  try{
   const number=text(req.body.tableNumber,30),label=text(req.body.label,80)||null,capacity=integer(req.body.capacity||2,1,100);
   if(!number)return res.status(400).json({error:'Table number is required'});
   const r=await pool.query('insert into restaurant_tables(business_id,table_number,label,capacity) values($1,$2,$3,$4) returning *',[req.manager.business_id,number,label,capacity]);res.status(201).json(r.rows[0]);
  }catch(e){res.status(400).json({error:e.code==='23505'?'That table already exists':e.message})}
 });
 app.patch('/api/pos/tables/:id',auth,async(req,res)=>{
  try{
   const allowed=['AVAILABLE','OCCUPIED','RESERVED','CLEANING','OUT_OF_SERVICE'];
   const status=allowed.includes(req.body.status)?req.body.status:null;
   const r=await pool.query('update restaurant_tables set table_number=coalesce(nullif($1,\'\'),table_number),label=$2,capacity=coalesce($3,capacity),status=coalesce($4,status),active=coalesce($5,active),updated_at=now() where id=$6 and business_id=$7 returning *',[text(req.body.tableNumber,30),text(req.body.label,80)||null,req.body.capacity?integer(req.body.capacity,1,100):null,status,typeof req.body.active==='boolean'?req.body.active:null,req.params.id,req.manager.business_id]);
   if(!r.rowCount)return res.status(404).json({error:'Table not found'});res.json(r.rows[0]);
  }catch(e){res.status(400).json({error:e.message})}
 });

 app.get('/api/pos/modifier-groups',auth,async(req,res)=>{
  try{
   const r=await pool.query('select g.*,coalesce(json_agg(json_build_object(\'id\',o.id,\'name\',o.name,\'price\',o.price,\'active\',o.active,\'sortOrder\',o.sort_order) order by o.sort_order,o.name) filter(where o.id is not null),\'[]\'::json) options from modifier_groups g left join modifier_options o on o.group_id=g.id where g.business_id=$1 group by g.id order by g.sort_order,g.name',[req.manager.business_id]);
   res.json(r.rows)
  }catch(e){res.status(500).json({error:'Unable to load modifier groups'})}
 });
 app.post('/api/pos/modifier-groups',auth,async(req,res)=>{
  try{
   const min=Number(req.body.minSelections)||0,max=Number(req.body.maxSelections)||1;
   if(min<0||max<min)return res.status(400).json({error:'Invalid selection limits'});
   const r=await pool.query('insert into modifier_groups(business_id,name,min_selections,max_selections,required,sort_order) values($1,$2,$3,$4,$5,$6) returning *',[req.manager.business_id,text(req.body.name,100),min,max,Boolean(req.body.required),Number(req.body.sortOrder)||0]);res.status(201).json(r.rows[0])
  }catch(e){res.status(400).json({error:e.message})}
 });
 app.post('/api/pos/modifier-groups/:id/options',auth,async(req,res)=>{
  try{
   const g=await pool.query('select id from modifier_groups where id=$1 and business_id=$2',[req.params.id,req.manager.business_id]);if(!g.rowCount)return res.status(404).json({error:'Modifier group not found'});
   const r=await pool.query('insert into modifier_options(group_id,name,price,sort_order) values($1,$2,$3,$4) returning *',[req.params.id,text(req.body.name,100),money(req.body.price||0),Number(req.body.sortOrder)||0]);res.status(201).json(r.rows[0])
  }catch(e){res.status(400).json({error:e.message})}
 });
 app.post('/api/pos/products/:productId/modifier-groups/:groupId',auth,async(req,res)=>{
  try{
   const p=await pool.query('select id from products where id=$1 and business_id=$2',[req.params.productId,req.manager.business_id]),g=await pool.query('select id from modifier_groups where id=$1 and business_id=$2',[req.params.groupId,req.manager.business_id]);
   if(!p.rowCount||!g.rowCount)return res.status(404).json({error:'Product or modifier group not found'});
   await pool.query('insert into menu_item_modifier_groups(product_id,group_id) values($1,$2) on conflict do nothing',[req.params.productId,req.params.groupId]);res.json({ok:true})
  }catch(e){res.status(400).json({error:e.message})}
 });

 app.get('/api/pos/combos',auth,async(req,res)=>{
  try{
   const r=await pool.query('select c.*,coalesce(json_agg(json_build_object(\'productId\',ci.product_id,\'quantity\',ci.quantity) order by ci.product_id) filter(where ci.product_id is not null),\'[]\'::json) items from menu_combos c left join menu_combo_items ci on ci.combo_id=c.id where c.business_id=$1 group by c.id order by c.name',[req.manager.business_id]);res.json(r.rows)
  }catch(e){res.status(500).json({error:'Unable to load combos'})}
 });
 app.post('/api/pos/combos',auth,async(req,res)=>{
  const c=await pool.connect();
  try{
   const name=text(req.body.name,100),items=Array.isArray(req.body.items)?req.body.items:[];if(!name||!items.length)return res.status(400).json({error:'Combo name and items are required'});
   await c.query('begin');const combo=await c.query('insert into menu_combos(business_id,name,description,price) values($1,$2,$3,$4) returning *',[req.manager.business_id,name,text(req.body.description,500)||null,money(req.body.price)]);
   for(const i of items){const p=await c.query('select id from products where id=$1 and business_id=$2 and active=true',[i.productId,req.manager.business_id]);if(!p.rowCount)throw new Error('Combo contains an unavailable product');await c.query('insert into menu_combo_items(combo_id,product_id,quantity) values($1,$2,$3)',[combo.rows[0].id,i.productId,integer(i.quantity||1,1,100)])}
   await c.query('commit');res.status(201).json(combo.rows[0])
  }catch(e){try{await c.query('rollback')}catch{}res.status(400).json({error:e.message})}finally{c.release()}
 });

 async function modifiers(c,businessId,productId,selections){
  const selected=Array.isArray(selections)?selections:[],groups=await c.query('select g.id,g.name,g.min_selections,g.max_selections,g.required from menu_item_modifier_groups mig join modifier_groups g on g.id=mig.group_id where mig.product_id=$1 and g.business_id=$2 and g.active=true',[productId,businessId]);
  const by=new Map();for(const s of selected){const gid=String(s.groupId||''),oid=String(s.optionId||'');if(!gid||!oid)throw new Error('Invalid modifier selection');if(!by.has(gid))by.set(gid,[]);by.get(gid).push(oid)}
  let surcharge=0;const trusted=[];const configured=new Set(groups.rows.map(g=>String(g.id)));
  for(const g of groups.rows){
   const ids=by.get(String(g.id))||[];if(g.required&&ids.length<Number(g.min_selections))throw new Error('Required modifier missing');if(ids.length<Number(g.min_selections)||ids.length>Number(g.max_selections))throw new Error('Invalid modifier selection count');if(new Set(ids).size!==ids.length)throw new Error('Duplicate modifier selection');
   if(!ids.length)continue;
   const opts=await c.query('select id,name,price from modifier_options where group_id=$1 and active=true and id=any($2::uuid[])',[g.id,ids]);if(opts.rowCount!==ids.length)throw new Error('Invalid modifier option');
   for(const o of opts.rows){surcharge+=Number(o.price);trusted.push({groupId:g.id,groupName:g.name,optionId:o.id,name:o.name,price:Number(o.price)})}
  }
  for(const gid of by.keys())if(!configured.has(gid))throw new Error('Modifier group is not configured for this product');
  return {surcharge:money(surcharge),modifiers:trusted}
 }

 async function createOrder(c,businessId,payload){
  const operationId=text(payload.operationId,120)||null;
  if(operationId){const old=await c.query('select * from orders where business_id=$1 and pos_operation_id=$2',[businessId,operationId]);if(old.rowCount)return old.rows[0]}
  const typeCode=text(payload.orderTypeCode,40).toUpperCase(),type=await c.query('select code from restaurant_order_types where business_id=$1 and code=$2 and active=true',[businessId,typeCode]);if(!type.rowCount)throw new Error('Invalid order type');
  let tableId=payload.tableId?String(payload.tableId):null;
  if(typeCode==='DINE_IN'){if(!tableId)throw new Error('A dine-in order requires a table');const t=await c.query('select id,status from restaurant_tables where id=$1 and business_id=$2 and active=true for update',[tableId,businessId]);if(!t.rowCount)throw new Error('Table not found');if(t.rows[0].status==='OUT_OF_SERVICE')throw new Error('Table is unavailable')}else tableId=null;
  const items=Array.isArray(payload.items)?payload.items:[];if(!items.length)throw new Error('At least one item is required');
  let subtotal=0;const trusted=[];
  for(const i of items){const p=await c.query('select id,name,price from products where id=$1 and business_id=$2 and active=true',[String(i.productId||''),businessId]);if(!p.rowCount)throw new Error('Menu item is unavailable');const q=integer(i.quantity,1,100),m=await modifiers(c,businessId,p.rows[0].id,i.modifiers),unit=money(Number(p.rows[0].price)+m.surcharge);subtotal=money(subtotal+unit*q);trusted.push({productId:p.rows[0].id,name:p.rows[0].name,q,unit,modifiers:m.modifiers})}
  const order=await c.query('insert into orders(id,business_id,customer_id,order_number,status,payment_status,payment_method,subtotal,total,food_subtotal,delivery_fee,delivery_status,delivery_fee_status,order_type_code,table_id,source,pos_operation_id) values(gen_random_uuid(),$1,null,$2,\'NEW\',\'PENDING\',\'POS\',$3,$3,$3,0,\'NONE\',\'NONE\',$4,$5,\'POS\',$6) returning *',[businessId,orderNumber(),subtotal,typeCode,tableId,operationId]);
  const stations=await c.query('select id from kds_stations where business_id=$1 and active=true order by name',[businessId]);
  for(const i of trusted){
   const row=await c.query('insert into order_items(id,order_id,product_id,product_name,quantity,unit_price,options,modifiers) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7) returning id',[order.rows[0].id,i.productId,i.name,i.q,i.unit,JSON.stringify({}),JSON.stringify(i.modifiers)]);
   for(const s of stations.rows){const ticket=await c.query('insert into kds_tickets(business_id,order_id,station_id) values($1,$2,$3) on conflict(order_id,station_id) do update set updated_at=now() returning id',[businessId,order.rows[0].id,s.id]);await c.query('insert into kds_ticket_items(ticket_id,order_item_id,quantity,item_name,modifiers) values($1,$2,$3,$4,$5)',[ticket.rows[0].id,row.rows[0].id,i.q,i.name,JSON.stringify(i.modifiers)])}
  }
  if(tableId)await c.query('update restaurant_tables set status=\'OCCUPIED\',updated_at=now() where id=$1',[tableId]);
  return order.rows[0]
 }

 app.post('/api/pos/orders',auth,async(req,res)=>{
  const c=await pool.connect();try{await c.query('begin');const o=await createOrder(c,req.manager.business_id,req.body);await c.query('commit');broadcastRealtime({businessId:req.manager.business_id,orderId:o.id,event:'pos.order.created',data:{orderId:o.id}});res.status(201).json(o)}catch(e){try{await c.query('rollback')}catch{}res.status(400).json({error:e.message||'Unable to create POS order'})}finally{c.release()}
 });
 app.get('/api/pos/kds',auth,async(req,res)=>{
  try{const r=await pool.query('select t.id,t.order_id,t.status,t.priority,t.fired_at,t.accepted_at,t.started_at,t.ready_at,o.order_number,o.order_type_code,o.table_id,coalesce(json_agg(json_build_object(\'id\',ti.id,\'orderItemId\',ti.order_item_id,\'name\',ti.item_name,\'quantity\',ti.quantity,\'modifiers\',ti.modifiers,\'status\',ti.status) order by ti.created_at) filter(where ti.id is not null),\'[]\'::json) items from kds_tickets t join orders o on o.id=t.order_id left join kds_ticket_items ti on ti.ticket_id=t.id where t.business_id=$1 and t.status<>\'VOID\' group by t.id,o.order_number,o.order_type_code,o.table_id order by t.priority desc,t.fired_at',[req.manager.business_id]);res.json(r.rows)}
  catch(e){res.status(500).json({error:'Unable to load KDS queue'})}
 });
 app.patch('/api/pos/kds/:id',auth,async(req,res)=>{
  const allowed=['NEW','ACCEPTED','PREPARING','READY','VOID'],status=String(req.body.status||'');if(!allowed.includes(status))return res.status(400).json({error:'Invalid KDS status'});
  try{const r=await pool.query('update kds_tickets set status=$1,accepted_at=case when $1=\'ACCEPTED\' then coalesce(accepted_at,now()) else accepted_at end,started_at=case when $1=\'PREPARING\' then coalesce(started_at,now()) else started_at end,ready_at=case when $1=\'READY\' then coalesce(ready_at,now()) else ready_at end,updated_at=now() where id=$2 and business_id=$3 returning *',[status,req.params.id,req.manager.business_id]);if(!r.rowCount)return res.status(404).json({error:'KDS ticket not found'});broadcastRealtime({businessId:req.manager.business_id,orderId:r.rows[0].order_id,event:'kds.updated',data:r.rows[0]});res.json(r.rows[0])}
  catch(e){res.status(400).json({error:'Unable to update KDS ticket'})}
 });
 app.post('/api/pos/offline-sync',auth,async(req,res)=>{
  const ops=Array.isArray(req.body.operations)?req.body.operations:[];if(ops.length>100)return res.status(400).json({error:'Maximum 100 offline operations per sync'});
  const c=await pool.connect(),results=[];try{
   for(const op of ops){
    const operationId=text(op.operationId,120);if(!operationId){results.push({operationId:null,status:'FAILED',error:'operationId is required'});continue}
    const old=await c.query('select status,result,error from pos_offline_operations where business_id=$1 and operation_id=$2',[req.manager.business_id,operationId]);if(old.rowCount){results.push({operationId,status:old.rows[0].status,result:old.rows[0].result,error:old.rows[0].error});continue}
    await c.query('insert into pos_offline_operations(business_id,operation_id,operation_type,payload) values($1,$2,$3,$4)',[req.manager.business_id,operationId,text(op.type,50),JSON.stringify(op.payload||{})]);
    try{await c.query('begin');if(String(op.type).toUpperCase()!=='CREATE_ORDER')throw new Error('Unsupported offline operation');const o=await createOrder(c,req.manager.business_id,{...(op.payload||{}),operationId});await c.query('commit');await c.query('update pos_offline_operations set status=\'APPLIED\',result=$3,applied_at=now() where business_id=$1 and operation_id=$2',[req.manager.business_id,operationId,JSON.stringify(o)]);results.push({operationId,status:'APPLIED',result:o})}
    catch(e){try{await c.query('rollback')}catch{}await c.query('update pos_offline_operations set status=\'FAILED\',error=$3 where business_id=$1 and operation_id=$2',[req.manager.business_id,operationId,String(e.message||'Sync failed').slice(0,500)]);results.push({operationId,status:'FAILED',error:e.message})}
   }
   res.json({results})
  }finally{c.release()}
 });
}
