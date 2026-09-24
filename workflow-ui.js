const REMOTE_ORDER_STATUSES=['NEW','ACCEPTED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'];
const REMOTE_ORDER_LABELS={NEW:'Payment confirmed — waiting for restaurant',ACCEPTED:'Your order is being prepared',OUT_FOR_DELIVERY:'Out for delivery',DELIVERED:'Delivered',CANCELLED:'Cancelled'};

async function getPlatformFeatures(){
  return apiRequest('/api/features?businessId='+encodeURIComponent(BUSINESS_ID));
}

async function dashboardOrders(){
  const q=document.getElementById('dashboard-search')?.value.trim()||'';
  return apiRequest('/api/orders?businessId='+encodeURIComponent(BUSINESS_ID)+'&q='+encodeURIComponent(q));
}
async function acceptRemoteOrder(id){
  try{await apiRequest('/api/orders/'+encodeURIComponent(id)+'/status',{method:'POST',body:JSON.stringify({status:'ACCEPTED'})});await renderManager();}
  catch(err){alert(err.message||'Could not accept order.');}
}
async function sendRemoteOrder(id){
  const select=document.getElementById('rider-'+id);
  if(!select?.value){alert('Select an available rider first.');return;}
  try{await apiRequest('/api/orders/'+encodeURIComponent(id)+'/assign-rider',{method:'POST',body:JSON.stringify({riderId:select.value})});await renderManager();}
  catch(err){alert(err.message||'Could not assign rider.');}
}
async function renderManager(){
  const el=document.getElementById('dashboard-view');
  if(!el)return;
  el.innerHTML='<div class="panel"><h2>Loading restaurant dashboard…</h2></div>';
  try{
    const features=await getPlatformFeatures();
    const orders=await dashboardOrders();
    const riders=features.riderModule ? await getAdminRiders() : [];
    const paid=orders.filter(o=>o.payment_status==='PAID').length;
    const pending=orders.filter(o=>o.payment_status==='PENDING').length;
    const delivering=orders.filter(o=>o.status==='OUT_FOR_DELIVERY').length;
    const delivered=orders.filter(o=>o.status==='DELIVERED').length;
    el.innerHTML=`<div class="dashboard-head"><div><p class="eyebrow">SAVANNA BITES • RESTAURANT</p><h1>Order control.</h1><p class="muted">Live orders, payment states and rider availability.</p></div><div><a class="btn" href="rider.html">Rider portal</a> <a class="btn" href="manager.html">Manager</a></div></div>
      <div class="dashboard-stats"><div class="panel"><h2>${paid}</h2><p class="muted">Paid</p></div><div class="panel"><h2>${pending}</h2><p class="muted">Payment pending</p></div><div class="panel"><h2>${delivering}</h2><p class="muted">Out for delivery</p></div><div class="panel"><h2>${delivered}</h2><p class="muted">Delivered</p></div></div>
      ${features.riderModule ? `<section class="panel"><div class="dashboard-toolbar"><div><h2>Rider operations</h2><p class="muted">Online status, availability, completed trips, distance covered and delivery earnings.</p></div><button class="btn" onclick="renderManager()">REFRESH</button></div><div class="orders">${riders.length?riders.map(r=>`<article class="order-card"><div><h3>${r.name}</h3><p>${r.phone||''}${r.email?' · '+r.email:''}</p><p>${r.vehicle_type||'Vehicle'} · ${r.number_plate||'No plate'}</p><p><strong>${r.trip_count||0}</strong> trips · <strong>${Number(r.distance_km||0).toFixed(1)} km</strong> covered · <strong>${money(r.earnings||0)}</strong> earnings</p></div><div><div class="order-status">${r.online?'ONLINE':'OFFLINE'} · ${r.busy?'BUSY':'AVAILABLE'}</div><p class="muted">Payout: ${r.payout_phone||r.phone||'Not set'}</p><button class="btn" onclick="viewRiderTrips('${r.id}')">VIEW TRIPS</button></div></article>`).join(''):'<div class="empty"><h2>No riders yet.</h2><p>Create rider accounts from the advanced module.</p></div>'}</div><div id="rider-trip-detail"></div></section>` : ''}
      <section class="panel" style="margin-top:1rem"><div class="dashboard-toolbar"><h2>Orders</h2><div class="search-row"><input id="dashboard-search" placeholder="Search name, phone, email or order #" value="${qEscape(new URLSearchParams(location.search).get('q')||'')}"><button class="btn" onclick="renderManager()">SEARCH</button></div></div></section>
      <div class="orders" style="margin-top:1rem">${orders.length?orders.map(o=>{const available=riders.filter(r=>r.available);return `<article class="order-card remote-order-card"><div><h3>${o.order_number} · ${o.name}</h3><p>${o.phone}${o.email?' · '+o.email:''}</p><p>${o.payment_method||'Payment'} · <span class="payment-pill">${o.payment_status}</span> · ${REMOTE_ORDER_LABELS[o.status]||o.status}</p><p>${o.delivery_note||'No delivery note'}</p><p><strong>${money(o.total)}</strong></p></div><div><div class="order-status">${REMOTE_ORDER_LABELS[o.status]||o.status}</div>${o.status==='NEW'&&o.payment_status==='PAID'?`<div class="status-actions"><button onclick="acceptRemoteOrder('${o.id}')">ACCEPT ORDER</button></div>`:''}${features.riderModule && o.status==='ACCEPTED'?`<div class="status-actions"><select id="rider-${o.id}"><option value="">Choose available rider</option>${available.map(r=>`<option value="${r.id}">${r.name} · ${r.vehicle_type}</option>`).join('')}</select><button onclick="sendRemoteOrder('${o.id}')">OUT FOR DELIVERY</button></div>`:''}${o.status==='OUT_FOR_DELIVERY'?`<p class="muted">Rider: ${o.rider_name||'Assigned'}${o.rider_plate?' · '+o.rider_plate:''}</p>`:''}${o.status==='CANCELLED'?`<p class="muted">Customer cancelled before acceptance.</p>`:''}<a class="text-link" href="order.html?id=${encodeURIComponent(o.id)}">Customer tracking →</a></div></article>`}).join(''):'<div class="empty"><h2>No orders yet.</h2><p>Place a test-mode order from the customer side.</p></div>'}</div>`;
  }catch(err){el.innerHTML=`<div class="empty"><h2>Dashboard unavailable.</h2><p>${err.message||'Please refresh.'}</p></div>`;}
}
function qEscape(value){return String(value||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
if(document.getElementById('dashboard-view'))renderManager();

async function viewRiderTrips(riderId){
  const el=document.getElementById('rider-trip-detail'); if(!el)return;
  el.innerHTML='<div class="panel"><h2>Loading rider trips…</h2></div>';
  try{
    const trips=await getAdminRiderTrips(riderId);
    el.innerHTML='<div class="panel"><h2>Trip history</h2>'+ (trips.length?trips.map(t=>'<div class="summary-row"><span><strong>'+t.order_number+'</strong><small style="display:block">'+(t.delivery_address||'')+' · '+(Number(t.route_distance_meters||0)/1000).toFixed(1)+' km · '+(t.status||'')+'</small></span><strong>'+money(t.rider_earning||0)+'</strong></div>').join(''):'<p class="muted">No trips found.</p>')+'</div>';
  }catch(err){el.innerHTML='<div class="panel"><p class="muted">'+(err.message||'Could not load trips.')+'</p></div>';}
}
