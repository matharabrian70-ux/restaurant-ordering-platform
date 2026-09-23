import crypto from 'node:crypto';

const DEFAULT_RULES = {
  baseFeeKes: 70,
  perKmKes: 24,
  perMinuteKes: 0.9,
  minimumFeeKes: 100,
  maximumFeeKes: 450,
  riderBaseKes: 55,
  riderPerKmKes: 17,
  riderPerMinuteKes: 0.85,
  riderMinimumKes: 75,
  riderMaximumKes: 500,
  fuelReferenceKes: 200,
  fuelSensitivity: 0.35,
  customerMargin: 1.08,
  peakMultiplier: 1,
  serviceRadiusKm: 18,
  autoRoundKes: 10
};

function num(v, fallback=0){ const n=Number(v); return Number.isFinite(n)?n:fallback; }
function roundTo(value, step){ const s=Math.max(1,num(step,10)); return Math.ceil(value/s)*s; }
function haversineKm(aLat,aLng,bLat,bLng){
  const R=6371, p=Math.PI/180;
  const dLat=(bLat-aLat)*p, dLng=(bLng-aLng)*p;
  const x=Math.sin(dLat/2)**2+Math.cos(aLat*p)*Math.cos(bLat*p)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function envBool(v){ return String(v||'').toLowerCase()==='true'; }

async function getFeature(pool,businessId){
  const r=await pool.query('select rider_module_enabled from business_features where business_id=$1',[businessId]);
  return Boolean(r.rows[0]?.rider_module_enabled);
}
async function getRules(pool,businessId){
  const r=await pool.query('select * from delivery_pricing_rules where business_id=$1',[businessId]);
  return r.rows[0] || null;
}
async function getFuel(pool){
  const r=await pool.query("select petrol_price_kes from fuel_price_snapshots where city='Nairobi' order by fetched_at desc limit 1");
  const cached=num(r.rows[0]?.petrol_price_kes, num(process.env.NAIROBI_FUEL_PRICE_KES,214.03));
  return cached;
}
async function getBranches(pool,businessId){
  const r=await pool.query(`select * from business_branches where business_id=$1 and active=true and accepting_orders=true order by name`,[businessId]);
  return r.rows;
}
async function matrixRoutes(branches,lat,lng){
  if(!process.env.GOOGLE_MAPS_API_KEY) throw new Error('GOOGLE_MAPS_API_KEY is not configured');
  const body={
    origins:branches.map(b=>({waypoint:{location:{latLng:{latitude:num(b.latitude),longitude:num(b.longitude)}}}})),
    destinations:[{waypoint:{location:{latLng:{latitude:lat,longitude:lng}}}}],
    travelMode:'TWO_WHEELER',
    routingPreference:'TRAFFIC_AWARE',
    languageCode:'en',
    units:'METRIC'
  };
  const response=await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Goog-Api-Key':process.env.GOOGLE_MAPS_API_KEY,'X-Goog-FieldMask':'originIndex,destinationIndex,status,condition,distanceMeters,duration'},
    body:JSON.stringify(body)
  });
  const text=await response.text();
  if(!response.ok) throw new Error('Google route matrix request failed');
  const elements=text.trim().split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(Boolean);
  return elements.filter(e=>!e.status?.code && e.condition!=='ROUTE_NOT_FOUND').map(e=>({
    branchIndex:num(e.originIndex), distanceMeters:num(e.distanceMeters), durationSeconds:Math.round(parseFloat(String(e.duration||'0').replace('s',''))||0)
  }));
}
function chooseCandidates(branches,lat,lng){
  return branches.map((b,i)=>({...b,_i:i,_straightKm:haversineKm(lat,lng,num(b.latitude),num(b.longitude))}))
    .filter(b=>b._straightKm<=Math.max(2,num(b.service_radius_km,18)))
    .sort((a,b)=>a._straightKm-b._straightKm).slice(0,Math.min(3,branches.length));
}
function normalizeRules(row){ if(!row) return DEFAULT_RULES; return {...DEFAULT_RULES,base_fee_kes:num(row.base_fee_kes,70),per_km_kes:num(row.per_km_kes,24),per_minute_kes:num(row.per_minute_kes,.9),minimum_fee_kes:num(row.minimum_fee_kes,100),maximum_fee_kes:num(row.maximum_fee_kes,450),rider_base_kes:num(row.rider_base_kes,55),rider_per_km_kes:num(row.rider_per_km_kes,17),rider_per_minute_kes:num(row.rider_per_minute_kes,.85),rider_minimum_kes:num(row.rider_minimum_kes,75),rider_maximum_kes:num(row.rider_maximum_kes,500),fuel_reference_kes:num(row.fuel_reference_kes,200),fuel_sensitivity:num(row.fuel_sensitivity,.35),customer_margin:num(row.customer_margin,1.08),peak_multiplier:num(row.peak_multiplier,1),service_radius_km:num(row.service_radius_km,18),auto_round_kes:num(row.auto_round_kes,10)}; }
function calculatePrices({advanced,rules,fuel,km,minutes}){
  const r=normalizeRules(rules);
  const fuelMultiplier=Math.max(0.90,Math.min(1.15,1+((fuel-r.fuel_reference_kes)/Math.max(1,r.fuel_reference_kes))*r.fuel_sensitivity));
  if(advanced){
    const riderCost=(r.rider_base_kes)+(km*r.rider_per_km_kes)+(minutes*r.rider_per_minute_kes);
    const riderPay=roundTo(Math.min(r.rider_maximum_kes,Math.max(r.rider_minimum_kes,riderCost*fuelMultiplier)),r.auto_round_kes);
    const customerRaw=(r.base_fee_kes)+(km*r.per_km_kes)+(minutes*r.per_minute_kes);
    const customerFee=roundTo(Math.min(r.maximum_fee_kes,Math.max(r.minimum_fee_kes,customerRaw*fuelMultiplier*r.peak_multiplier,riderPay*r.customer_margin)),r.auto_round_kes);
    return {deliveryFeeKes:customerFee,riderEarningKes:riderPay,fuelMultiplier};
  }
  const raw=(r.base_fee_kes)+(km*r.per_km_kes)+(minutes*r.per_minute_kes);
  const customerFee=roundTo(Math.min(r.maximum_fee_kes,Math.max(r.minimum_fee_kes,raw*fuelMultiplier*r.peak_multiplier)),r.auto_round_kes);
  return {deliveryFeeKes:customerFee,riderEarningKes:0,fuelMultiplier};
}
async function geocodeAddress(pool,address){
  const normalized=String(address||'').trim().toLowerCase().replace(/\\s+/g,' ');
  if(!normalized) throw new Error('Customer delivery address is required');
  const cached=await pool.query('select latitude,longitude from geocoding_cache where address_key=$1 and expires_at>now()',[normalized]);
  if(cached.rowCount) return {lat:num(cached.rows[0].latitude),lng:num(cached.rows[0].longitude),cached:true};
  if(!process.env.GOOGLE_MAPS_API_KEY) throw new Error('GOOGLE_MAPS_API_KEY is not configured');
  const response=await fetch('https://maps.googleapis.com/maps/api/geocode/json?address='+encodeURIComponent(address)+'&key='+encodeURIComponent(process.env.GOOGLE_MAPS_API_KEY));
  const data=await response.json().catch(()=>({}));
  const loc=data.results?.[0]?.geometry?.location;
  if(!response.ok||!loc) throw new Error('We could not locate that delivery address. Try a more specific address or landmark.');
  await pool.query('insert into geocoding_cache(id,address_key,latitude,longitude,expires_at) values(gen_random_uuid(),$1,$2,$3,now()+interval \'30 days\') on conflict(address_key) do update set latitude=excluded.latitude,longitude=excluded.longitude,expires_at=excluded.expires_at',[normalized,loc.lat,loc.lng]);
  return {lat:num(loc.lat),lng:num(loc.lng),cached:false};
}
async function quote(pool,{businessId,customerLat,customerLng,deliveryAddress,branchId=null}){
  let lat=num(customerLat,NaN), lng=num(customerLng,NaN);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)){ const g=await geocodeAddress(pool,deliveryAddress); lat=g.lat; lng=g.lng; }
  const advanced=await getFeature(pool,businessId);
  const rules=await getRules(pool,businessId);
  const fuel=await getFuel(pool);
  let branches=await getBranches(pool,businessId);
  if(branchId) branches=branches.filter(b=>String(b.id)===String(branchId));
  if(!branches.length) throw new Error('No active delivery branch is configured');
  const candidates=chooseCandidates(branches,lat,lng);
  if(!candidates.length) throw new Error('Your delivery location is outside the restaurant delivery area');
  const routes=await matrixRoutes(candidates,lat,lng);
  const ranked=routes.map(x=>({...candidates[x.branchIndex],...x})).sort((a,b)=>a.distanceMeters-b.distanceMeters);
  if(!ranked.length) throw new Error('No drivable delivery route was found');
  const selected=ranked[0];
  const km=selected.distanceMeters/1000, minutes=selected.durationSeconds/60;
  const prices=calculatePrices({advanced,rules,fuel,km,minutes});
  const saved=await pool.query(`insert into delivery_quotes(id,business_id,branch_id,pickup_address,delivery_address,customer_lat,customer_lng,distance_meters,duration_seconds,fuel_price_kes,base_fee_kes,distance_fee_kes,time_fee_kes,demand_multiplier,delivery_fee_kes,rider_earning_kes,pricing_mode,status)
    values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'QUOTED') returning *`,
    [businessId,selected.id,selected.address,deliveryAddress||null,lat,lng,selected.distanceMeters,selected.durationSeconds,fuel,num((rules||DEFAULT_RULES).base_fee_kes,70),km*num((rules||DEFAULT_RULES).per_km_kes,24),minutes*num((rules||DEFAULT_RULES).per_minute_kes,0.9),1,prices.deliveryFeeKes,prices.riderEarningKes,advanced?'AUTO':'MASTER']);
  return {quoteId:saved.rows[0].id,branchId:selected.id,branchName:selected.name,pickupAddress:selected.address,deliveryAddress,distanceMeters:selected.distanceMeters,durationSeconds:selected.durationSeconds,km,minutes,fuelPriceKes:fuel,deliveryFee:prices.deliveryFeeKes,riderEarning:prices.riderEarningKes,pricingMode:advanced?'AUTO':'MASTER',currency:'KES'};
}

export function registerDeliveryEngine(app,pool){
  app.get('/api/businesses/:id/branches',async(req,res)=>{
    try{ const rows=await pool.query('select id,name,address,latitude,longitude,google_place_id,building,floor,unit,street,estate,landmark,pickup_instructions,active,accepting_orders from business_branches where business_id=$1 order by name',[req.params.id]); res.json(rows.rows); }
    catch(e){res.status(500).json({error:'Unable to load branches'});}
  });
  app.post('/api/businesses/:id/branches',async(req,res)=>{
    try{
      const {name,address,latitude,longitude,googlePlaceId,building,floor,unit,street,estate,landmark,pickupInstructions,active=true,acceptingOrders=true,serviceRadiusKm=18}=req.body;
      if(!name||!address||!Number.isFinite(Number(latitude))||!Number.isFinite(Number(longitude))) return res.status(400).json({error:'Branch name, address and map coordinates are required'});
      const r=await pool.query(`insert into business_branches(id,business_id,name,address,latitude,longitude,google_place_id,building,floor,unit,street,estate,landmark,pickup_instructions,active,accepting_orders,service_radius_km) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,[req.params.id, name,address,latitude,longitude,googlePlaceId||null,building||null,floor||null,unit||null,street||null,estate||null,landmark||null,pickupInstructions||null,Boolean(active),Boolean(acceptingOrders),serviceRadiusKm]);
      res.status(201).json(r.rows[0]);
    }catch(e){res.status(500).json({error:e.message||'Unable to create branch'});}
  });
  app.patch('/api/businesses/:id/branches/:branchId',async(req,res)=>{
    try{
      const fields={name:'name',address:'address',latitude:'latitude',longitude:'longitude',googlePlaceId:'google_place_id',building:'building',floor:'floor',unit:'unit',street:'street',estate:'estate',landmark:'landmark',pickupInstructions:'pickup_instructions',active:'active',acceptingOrders:'accepting_orders',serviceRadiusKm:'service_radius_km'};
      const sets=[],vals=[]; for(const [k,col] of Object.entries(fields)){if(req.body[k]!==undefined){sets.push(`${col}=$${vals.length+2}`);vals.push(req.body[k]);}}
      if(!sets.length)return res.status(400).json({error:'No branch changes supplied'});
      vals.unshift(req.params.branchId,req.params.id);
      const r=await pool.query(`update business_branches set ${sets.join(',')},updated_at=now() where id=$1 and business_id=$2 returning *`,vals);
      if(!r.rowCount)return res.status(404).json({error:'Branch not found'}); res.json(r.rows[0]);
    }catch(e){res.status(500).json({error:e.message||'Unable to update branch'});}
  });
  app.delete('/api/businesses/:id/branches/:branchId',async(req,res)=>{
    try{const r=await pool.query('update business_branches set active=false,accepting_orders=false,updated_at=now() where id=$1 and business_id=$2 returning id',[req.params.branchId,req.params.id]); if(!r.rowCount)return res.status(404).json({error:'Branch not found'});res.json({ok:true});}
    catch(e){res.status(500).json({error:'Unable to deactivate branch'});}
  });
  app.get('/api/businesses/:id/delivery-pricing',async(req,res)=>{
    try{const advanced=await getFeature(pool,req.params.id);const rules=await getRules(pool,req.params.id);res.json({mode:advanced?'AUTO':'MASTER',editable:!advanced,rules:rules||DEFAULT_RULES});}
    catch(e){res.status(500).json({error:'Unable to load delivery pricing'});}
  });
  app.patch('/api/businesses/:id/delivery-pricing',async(req,res)=>{
    try{
      if(await getFeature(pool,req.params.id)) return res.status(403).json({error:'Advanced package uses automatic platform pricing'});
      const numeric={};
      for(const k of ['base_fee_kes','per_km_kes','per_minute_kes','minimum_fee_kes','maximum_fee_kes','rider_base_kes','rider_per_km_kes','rider_per_minute_kes','rider_minimum_kes','rider_maximum_kes','fuel_reference_kes','fuel_sensitivity','customer_margin','peak_multiplier','service_radius_km','auto_round_kes']) if(req.body[k]!==undefined) numeric[k]=Number(req.body[k]);
      const limits={base_fee_kes:[0,200],per_km_kes:[0,80],per_minute_kes:[0,5],minimum_fee_kes:[50,200],maximum_fee_kes:[100,800],rider_base_kes:[0,150],rider_per_km_kes:[0,50],rider_per_minute_kes:[0,4],rider_minimum_kes:[50,250],rider_maximum_kes:[100,1000],fuel_reference_kes:[100,350],fuel_sensitivity:[0,1],customer_margin:[1,1.5],peak_multiplier:[0.8,1.5],service_radius_km:[1,30],auto_round_kes:[1,50]};
      for(const [k,v] of Object.entries(numeric)){const [lo,hi]=limits[k];if(!Number.isFinite(v)||v<lo||v>hi)return res.status(400).json({error:k+' is outside the allowed pricing range'});}
      if(numeric.minimum_fee_kes!==undefined&&numeric.maximum_fee_kes!==undefined&&numeric.maximum_fee_kes<numeric.minimum_fee_kes)return res.status(400).json({error:'Maximum fee must be at least the minimum fee'});
      const r=await pool.query(`insert into delivery_pricing_rules(business_id,base_fee_kes,per_km_kes,per_minute_kes,minimum_fee_kes,maximum_fee_kes,rider_base_kes,rider_per_km_kes,rider_per_minute_kes,rider_minimum_kes,rider_maximum_kes,fuel_reference_kes,fuel_sensitivity,customer_margin,peak_multiplier,service_radius_km,auto_round_kes)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      on conflict(business_id) do update set base_fee_kes=excluded.base_fee_kes,per_km_kes=excluded.per_km_kes,per_minute_kes=excluded.per_minute_kes,minimum_fee_kes=excluded.minimum_fee_kes,maximum_fee_kes=excluded.maximum_fee_kes,rider_base_kes=excluded.rider_base_kes,rider_per_km_kes=excluded.rider_per_km_kes,rider_per_minute_kes=excluded.rider_per_minute_kes,rider_minimum_kes=excluded.rider_minimum_kes,rider_maximum_kes=excluded.rider_maximum_kes,fuel_reference_kes=excluded.fuel_reference_kes,fuel_sensitivity=excluded.fuel_sensitivity,customer_margin=excluded.customer_margin,peak_multiplier=excluded.peak_multiplier,service_radius_km=excluded.service_radius_km,auto_round_kes=excluded.auto_round_kes,updated_at=now() returning *`,[req.params.id,...Object.values(DEFAULT_RULES).map((v,i)=>req.body[Object.keys(DEFAULT_RULES)[i]]===undefined?v:req.body[Object.keys(DEFAULT_RULES)[i]])]);
      res.json(r.rows[0]);
    }catch(e){res.status(500).json({error:e.message||'Unable to save pricing rules'});}
  });
  app.post('/api/delivery/quote-v2',async(req,res)=>{
    try{const q=await quote(pool,req.body);res.json(q);}
    catch(e){res.status(400).json({error:e.message||'Unable to calculate delivery quote'});}
  });
  app.get('/api/delivery/quote/:id',async(req,res)=>{
    try{const r=await pool.query('select * from delivery_quotes where id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Quote not found'});res.json(r.rows[0]);}
    catch(e){res.status(500).json({error:'Unable to load quote'});}
  });
}
