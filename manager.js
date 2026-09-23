const managerRoot = document.getElementById('manager-view');

function managerMoney(value) {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(Number(value || 0));
}
function managerDate(value) { return new Date(value).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }); }
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

let branches=[];
let branchMap=null;
let branchMarker=null;

async function loadBranches(){
  branches=await apiRequest('/api/businesses/'+encodeURIComponent(BUSINESS_ID)+'/branches');
  return branches;
}
function initBranchMap(){
  if(typeof L==='undefined'||branchMap) return;
  branchMap=L.map('branch-map').setView([-1.286389,36.817223],12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(branchMap);
  branchMap.on('click',e=>{
    const lat=e.latlng.lat.toFixed(7),lng=e.latlng.lng.toFixed(7);
    document.getElementById('branch-lat').value=lat;
    document.getElementById('branch-lng').value=lng;
    if(branchMarker)branchMarker.setLatLng(e.latlng);else branchMarker=L.marker(e.latlng).addTo(branchMap);
  });
}
function updateBranchMap(){
  if(!branchMap)return;
  const lat=Number(document.getElementById('branch-lat')?.value),lng=Number(document.getElementById('branch-lng')?.value);
  if(Number.isFinite(lat)&&Number.isFinite(lng)){
    branchMap.setView([lat,lng],15);
    if(branchMarker)branchMarker.setLatLng([lat,lng]);else branchMarker=L.marker([lat,lng]).addTo(branchMap);
  }
}
async function saveBranch(){
  const get=id=>document.getElementById(id)?.value.trim();
  const payload={name:get('branch-name'),address:get('branch-address'),latitude:Number(get('branch-lat')),longitude:Number(get('branch-lng')),building:get('branch-building'),floor:get('branch-floor'),unit:get('branch-unit'),street:get('branch-street'),estate:get('branch-estate'),landmark:get('branch-landmark'),pickupInstructions:get('branch-pickup'),serviceRadiusKm:Number(get('branch-radius')||18),active:true,acceptingOrders:true};
  const status=document.getElementById('branch-status');
  if(!payload.name||!payload.address||!Number.isFinite(payload.latitude)||!Number.isFinite(payload.longitude)){status.textContent='Enter branch details and place the map pin.';return;}
  status.textContent='Saving branch…';
  try{await apiRequest('/api/businesses/'+encodeURIComponent(BUSINESS_ID)+'/branches',{method:'POST',body:JSON.stringify(payload)});status.textContent='Branch saved.';await loadManager();}
  catch(e){status.textContent=e.message||'Could not save branch.';}
}
async function deactivateBranch(id){
  if(!confirm('Deactivate this branch? Existing orders are not changed.'))return;
  try{await apiRequest('/api/businesses/'+encodeURIComponent(BUSINESS_ID)+'/branches/'+encodeURIComponent(id),{method:'DELETE'});await loadManager();}
  catch(e){alert(e.message||'Could not deactivate branch.');}
}
async function savePricing(){
  const status=document.getElementById('pricing-status');
  const fields=['base_fee_kes','per_km_kes','per_minute_kes','minimum_fee_kes','maximum_fee_kes','peak_multiplier'];
  const payload={}; fields.forEach(k=>payload[k]=Number(document.getElementById('price-'+k)?.value));
  status.textContent='Saving pricing rules…';
  try{await apiRequest('/api/businesses/'+encodeURIComponent(BUSINESS_ID)+'/delivery-pricing',{method:'PATCH',body:JSON.stringify(payload)});status.textContent='Pricing rules saved.';}
  catch(e){status.textContent=e.message||'Could not save pricing rules.';}
}
async function createRiderAccount(){
  const get=id=>document.getElementById(id)?.value.trim();
  const payload={businessId:BUSINESS_ID,name:get('new-rider-name'),phone:get('new-rider-phone'),email:get('new-rider-email'),vehicleType:get('new-rider-vehicle'),numberPlate:get('new-rider-plate'),payoutPhone:get('new-rider-payout'),password:document.getElementById('new-rider-password')?.value||''};
  const status=document.getElementById('rider-create-status');
  if(!payload.name||!payload.phone||!payload.vehicleType||!payload.numberPlate||!payload.password){status.textContent='Complete all required rider account fields.';return;}
  status.textContent='Creating rider account…';
  try{await createRemoteRider(payload);status.textContent='Rider account created.';loadManager();}catch(e){status.textContent=e.message||'Could not create rider account.';}
}

async function loadManager(){
  managerRoot.innerHTML='<div class="panel"><p>Loading manager overview…</p></div>';
  try{
    const [orders,features,branches,pricing]=await Promise.all([
      apiRequest('/api/orders?businessId='+encodeURIComponent(BUSINESS_ID)),
      apiRequest('/api/features?businessId='+encodeURIComponent(BUSINESS_ID)),
      loadBranches(),
      apiRequest('/api/businesses/'+encodeURIComponent(BUSINESS_ID)+'/delivery-pricing')
    ]);
    const stats=orders.reduce((s,o)=>{s.orders++;s.revenue+=Number(o.total||0);if(o.payment_status==='PAID')s.paid++;if(o.payment_status==='PENDING')s.pending++;if(o.payment_status==='REFUNDED')s.refunded+=Number(o.total||0);if(o.status==='OUT_FOR_DELIVERY')s.delivery++;if(o.status==='DELIVERED')s.delivered++;return s;},{orders:0,revenue:0,paid:0,pending:0,refunded:0,delivery:0,delivered:0});
    let branchHtml='<section class="panel manager-section"><div class="section-head"><div><p class="eyebrow">BRANCHES & LOCATIONS</p><h2>Fulfillment branches</h2></div><p>Customers do not choose a branch. The delivery engine selects the best active branch automatically.</p></div><div class="orders">'+(branches.length?branches.map(b=>'<article class="order-card"><div><h3>'+esc(b.name)+'</h3><p>'+esc(b.address)+'</p><p>'+Number(b.latitude).toFixed(5)+', '+Number(b.longitude).toFixed(5)+' · '+Number(b.service_radius_km||18)+' km service radius</p><p class="muted">'+esc(b.pickup_instructions||'No pickup instructions')+'</p></div><div><div class="order-status">'+(b.active&&b.accepting_orders?'ACTIVE':'OFF')+'</div><button class="btn" onclick="deactivateBranch(\''+b.id+'\')">DEACTIVATE</button></div></article>').join(''):'<p class="muted">No branches configured.</p>')+'</div><hr><h3>Add branch</h3><div class="field"><label>Branch name</label><input id="branch-name" placeholder="Kilimani Branch"></div><div class="field"><label>Full address</label><input id="branch-address" placeholder="Building, street, Nairobi"></div><div id="branch-map" style="height:280px;border-radius:12px;margin:12px 0"></div><p class="muted">Click the map to place the branch pin. This uses OpenStreetMap for the admin pin picker, so it does not consume Google routing requests.</p><div class="summary-row"><span>Latitude</span><input id="branch-lat" inputmode="decimal" placeholder="-1.286389"></div><div class="summary-row"><span>Longitude</span><input id="branch-lng" inputmode="decimal" placeholder="36.817223"></div><div class="field"><label>Building</label><input id="branch-building"></div><div class="field"><label>Floor</label><input id="branch-floor"></div><div class="field"><label>Shop / unit</label><input id="branch-unit"></div><div class="field"><label>Street</label><input id="branch-street"></div><div class="field"><label>Estate / area</label><input id="branch-estate"></div><div class="field"><label>Landmark</label><input id="branch-landmark"></div><div class="field"><label>Pickup instructions</label><input id="branch-pickup" placeholder="Use rear entrance, counter 2…"></div><div class="field"><label>Delivery radius (km)</label><input id="branch-radius" type="number" min="1" max="30" value="18"></div><button class="btn" onclick="saveBranch()">SAVE BRANCH</button><p id="branch-status" class="muted"></p></section>';
    let pricingHtml='';
    if(!pricing.editable) pricingHtml='<section class="panel manager-section"><div class="section-head"><div><p class="eyebrow">AUTOMATIC DELIVERY PRICING</p><h2>Platform managed</h2></div><p>Advanced clients get automatic pricing. The restaurant cannot alter the rider/customer pricing formula.</p></div><div class="summary-row"><span>Mode</span><strong>AUTO</strong></div><div class="summary-row"><span>Customer fee range</span><strong>'+managerMoney(pricing.rules.minimum_fee_kes)+' – '+managerMoney(pricing.rules.maximum_fee_kes)+'</strong></div><p class="muted">The engine balances route distance, traffic-aware duration, fuel movement and a rider-payment floor.</p></section>';
    else pricingHtml='<section class="panel manager-section"><div class="section-head"><div><p class="eyebrow">MASTER DELIVERY PRICING</p><h2>Restaurant controls</h2></div><p>Basic clients control the master pricing rules. These are still bounded by platform safety limits.</p></div><div class="field"><label>Base fee</label><input id="price-base_fee_kes" type="number" value="'+pricing.rules.base_fee_kes+'"></div><div class="field"><label>Per kilometre</label><input id="price-per_km_kes" type="number" value="'+pricing.rules.per_km_kes+'"></div><div class="field"><label>Per minute</label><input id="price-per_minute_kes" type="number" step="0.1" value="'+pricing.rules.per_minute_kes+'"></div><div class="field"><label>Minimum fee</label><input id="price-minimum_fee_kes" type="number" value="'+pricing.rules.minimum_fee_kes+'"></div><div class="field"><label>Maximum fee</label><input id="price-maximum_fee_kes" type="number" value="'+pricing.rules.maximum_fee_kes+'"></div><div class="field"><label>Peak multiplier</label><input id="price-peak_multiplier" type="number" step="0.01" value="'+pricing.rules.peak_multiplier+'"></div><button class="btn" onclick="savePricing()">SAVE MASTER PRICING</button><p id="pricing-status" class="muted"></p></section>';
    let riderCreateHtml='',riderAnalyticsHtml='';
    if(features.riderModule){
      riderCreateHtml='<section class="panel manager-section"><div class="section-head"><div><p class="eyebrow">RIDER ACCOUNTS</p><h2>Create rider</h2></div><p>Set the rider login and M-Pesa payout number.</p></div><div class="field"><label>Name</label><input id="new-rider-name"></div><div class="field"><label>Phone / login</label><input id="new-rider-phone" placeholder="07xx xxx xxx"></div><div class="field"><label>Email</label><input id="new-rider-email" type="email"></div><div class="field"><label>Vehicle type</label><input id="new-rider-vehicle" value="Motorbike"></div><div class="field"><label>Number plate</label><input id="new-rider-plate"></div><div class="field"><label>M-Pesa payout number</label><input id="new-rider-payout"></div><div class="field"><label>Initial password</label><input id="new-rider-password" type="password"></div><button class="btn" onclick="createRiderAccount()">CREATE RIDER ACCOUNT</button><p id="rider-create-status" class="muted"></p></section>';
      try{const riders=await getAdminRiders();riderAnalyticsHtml='<section class="panel manager-section"><div class="section-head"><div><p class="eyebrow">DELIVERY OPERATIONS</p><h2>Rider performance</h2></div><p>Trips, distance, online status and rider earnings.</p></div><div class="orders">'+(riders.length?riders.map(r=>'<article class="order-card"><div><h3>'+esc(r.name)+'</h3><p>'+esc(r.vehicle_type)+' · '+esc(r.number_plate)+' · '+esc(r.phone||'')+'</p><p><strong>'+r.trip_count+'</strong> trips · <strong>'+Number(r.distance_km||0).toFixed(1)+' km</strong> · <strong>'+managerMoney(r.earnings||0)+'</strong></p></div><div><div class="order-status">'+(r.online?'ONLINE':'OFFLINE')+' · '+(r.busy?'BUSY':'AVAILABLE')+'</div></div></article>').join(''):'<p class="muted">No riders yet.</p>')+'</div></section>';}catch{}
    }
    managerRoot.innerHTML=branchHtml+pricingHtml+riderAnalyticsHtml+'<div class="dashboard-head"><div><p class="eyebrow">SAVANNA BITES • MANAGEMENT</p><h1>Business overview.</h1><p class="muted">Orders, payments, branches, delivery and rider operations.</p></div><div class="status-actions"><a class="btn" href="dashboard.html">Open restaurant</a>'+(features.riderModule?'<a class="btn" href="rider.html">Open riders</a>':'')+'</div></div><section class="manager-stats"><article class="panel"><p class="eyebrow">ORDERS</p><h2>'+stats.orders+'</h2></article><article class="panel"><p class="eyebrow">PAID</p><h2>'+stats.paid+'</h2></article><article class="panel"><p class="eyebrow">REVENUE</p><h2>'+managerMoney(stats.revenue)+'</h2></article><article class="panel"><p class="eyebrow">DELIVERY</p><h2>'+stats.delivery+'</h2></article></section>'+riderCreateHtml+'<section class="panel manager-section"><div class="section-head"><div><p class="eyebrow">FINANCIAL CONTROL</p><h2>Payments & refunds</h2></div><p>Refunds remain separate from order workflow.</p></div><div class="summary-row"><span>Pending payments</span><strong>'+stats.pending+'</strong></div><div class="summary-row"><span>Refunded order value</span><strong>'+managerMoney(stats.refunded)+'</strong></div><div class="summary-row"><span>Delivered orders</span><strong>'+stats.delivered+'</strong></div></section><section class="panel manager-section"><div class="section-head"><div><p class="eyebrow">RECENT ACTIVITY</p><h2>Latest orders</h2></div><a class="text-link" href="archive.html">Open records →</a></div><div class="orders">'+orders.slice(0,10).map(o=>'<article class="order-card"><div><h3>'+esc(o.order_number||o.id)+'</h3><p>'+esc(o.name||'')+' · '+esc(o.phone||'')+'</p><p>'+managerDate(o.created_at)+'</p></div><div><div class="order-status">'+esc(o.payment_status)+'</div><strong>'+managerMoney(o.total)+'</strong><p>'+esc(o.status)+'</p></div></article>').join('')+'</div></section>';
    setTimeout(initBranchMap,50);
  }catch(error){managerRoot.innerHTML='<div class="panel"><h2>Manager data unavailable</h2><p class="muted">'+esc(error.message)+'</p><button class="btn" onclick="loadManager()">Try again</button></div>';}
}
loadManager();
