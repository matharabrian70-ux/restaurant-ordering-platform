const REMOTE_ORDER_STATUSES=['NEW','ACCEPTED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'];
const REMOTE_ORDER_LABELS={NEW:'Payment confirmed — waiting for restaurant',ACCEPTED:'Your order is being prepared',OUT_FOR_DELIVERY:'Out for delivery',DELIVERED:'Delivered',CANCELLED:'Cancelled'};

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
    const [orders,riders]=await Promise.all([dashboardOrders(),getRemoteRiders()]);
    const paid=orders.filter(o=>o.payment_status==='PAID').length;
    const pending=orders.filter(o=>o.payment_status==='PENDING').length;
    const delivering=orders.filter(o=>o.status==='OUT_FOR_DELIVERY').length;
    const delivered=orders.filter(o=>o.status==='DELIVERED').length;
    el.innerHTML=`<div class="dashboard-head"><div><p class="eyebrow">SAVANNA BITES • RESTAURANT</p><h1>Order control.</h1><p class="muted">Live orders, payment states and rider availability.</p></div><div><a class="btn" href="rider.html">Rider portal</a> <a class="btn" href="manager.html">Manager</a></div></div>
      <div class="dashboard-stats"><div class="panel"><h2>${paid}</h2><p class="muted">Paid</p></div><div class="panel"><h2>${pending}</h2><p class="muted">Payment pending</p></div><div class="panel"><h2>${delivering}</h2><p class="muted">Out for delivery</p></div><div class="panel"><h2>${delivered}</h2><p class="muted">Delivered</p></div></div>
      <section class="panel"><div class="dashboard-toolbar"><div><h2>Rider availability</h2><p class="muted">Riders are stored centrally, so different devices see the same list.</p></div><button class="btn" onclick="renderManager()">REFRESH</button></div><div class="rider-strip">${riders.length?riders.map(r=>`<div class="rider-chip"><strong>${r.name}</strong><span>${r.available?'AVAILABLE':'DELIVERING'}</span><small>${r.vehicle_type} · ${r.number_plate}</small><small>${r.id} · ${r.trip_count||0} trips</small></div>`).join(''):'<p class="muted">No riders created yet.</p>'}</div></section>
      <section class="panel" style="margin-top:1rem"><div class="dashboard-toolbar"><h2>Orders</h2><div class="search-row"><input id="dashboard-search" placeholder="Search name, phone, email or order #" value="${qEscape(new URLSearchParams(location.search).get('q')||'')}"><button class="btn" onclick="renderManager()">SEARCH</button></div></div></section>
      <div class="orders" style="margin-top:1rem">${orders.length?orders.map(o=>{const available=riders.filter(r=>r.available);return `<article class="order-card remote-order-card"><div><h3>${o.order_number} · ${o.name}</h3><p>${o.phone}${o.email?' · '+o.email:''}</p><p>${o.payment_method||'Payment'} · <span class="payment-pill">${o.payment_status}</span> · ${REMOTE_ORDER_LABELS[o.status]||o.status}</p><p>${o.delivery_note||'No delivery note'}</p><p><strong>${money(o.total)}</strong></p></div><div><div class="order-status">${REMOTE_ORDER_LABELS[o.status]||o.status}</div>${o.status==='NEW'&&o.payment_status==='PAID'?`<div class="status-actions"><button onclick="acceptRemoteOrder('${o.id}')">ACCEPT ORDER</button></div>`:''}${o.status==='ACCEPTED'?`<div class="status-actions"><select id="rider-${o.id}"><option value="">Choose available rider</option>${available.map(r=>`<option value="${r.id}">${r.name} · ${r.vehicle_type}</option>`).join('')}</select><button onclick="sendRemoteOrder('${o.id}')">OUT FOR DELIVERY</button></div>`:''}${o.status==='OUT_FOR_DELIVERY'?`<p class="muted">Rider: ${o.rider_name||'Assigned'}${o.rider_plate?' · '+o.rider_plate:''}</p>`:''}${o.status==='CANCELLED'?`<p class="muted">Customer cancelled before acceptance.</p>`:''}<a class="text-link" href="order.html?id=${encodeURIComponent(o.id)}">Customer tracking →</a></div></article>`}).join(''):'<div class="empty"><h2>No orders yet.</h2><p>Place a test-mode order from the customer side.</p></div>'}</div>`;
  }catch(err){el.innerHTML=`<div class="empty"><h2>Dashboard unavailable.</h2><p>${err.message||'Please refresh.'}</p></div>`;}
}
function qEscape(value){return String(value||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
if(document.getElementById('dashboard-view'))renderManager();
