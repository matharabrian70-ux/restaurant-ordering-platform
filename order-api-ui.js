function escapeOrderHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
const ORDER_API_BASE = 'https://restaurant-ordering-api-ow3p.onrender.com';
const REMOTE_STATUSES = ['NEW','ACCEPTED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'];
const REMOTE_LABELS = { NEW:'Order received', ACCEPTED:'Accepted & preparing', OUT_FOR_DELIVERY:'On its way', DELIVERED:'Delivered', CANCELLED:'Order cancelled' };
let customerLiveMap=null,customerLiveMarker=null,customerLiveDestinationMarker=null,customerLiveMapOrderId=null;

function paymentMessage(params,paymentStatus){
  if(params.get('payment')==='success') return 'Payment confirmed. Your order has been sent to the restaurant.';
  if(params.get('payment')==='failed') return 'The payment was not confirmed. You can try again from checkout.';
  if(params.get('payment')==='pending'&&paymentStatus!=='PAID') return 'Check your phone and approve the M-Pesa request. Paystack may take up to 180 seconds to receive the final result from the mobile-money network.';
  return '';
}
function refundStatusLabel(status){return ({PENDING:'Refund initiated',PROCESSING:'Refund processing',PROCESSED:'Refund processed',FAILED:'Refund failed', 'NEEDS-ATTENTION':'Refund needs attention'}[String(status||'').toUpperCase()]||status||'Refund update');}
function refundTimingText(status){
  const s=String(status||'').toUpperCase();
  if(s==='PROCESSED') return 'Paystack says a processed refund may still take up to 10 business days to reach the customer.';
  if(s==='FAILED') return 'Paystack could not process this refund. The transaction remains successful and the refund amount is credited back to the business.';
  if(s==='NEEDS-ATTENTION') return 'Paystack needs additional customer bank details before the refund can continue.';
  return 'Paystack currently states that customers can expect refunds within 3–10 working days. The exact timing depends on the payment processor and bank.';
}
async function loadRefunds(id){return fetch(`${ORDER_API_BASE}/api/orders/${encodeURIComponent(id)}/refunds`,{headers:{Authorization:'Bearer '+getCustomerOrderToken()}}).then(r=>r.ok?r.json():[]).catch(()=>[]);}
async function destroyCustomerLiveMap(){
  if(customerLiveMap){try{customerLiveMap.remove();}catch{}}
  customerLiveMap=null;customerLiveMarker=null;customerLiveDestinationMarker=null;customerLiveMapOrderId=null;
}
async function initCustomerLiveMap(order){
  const panel=document.getElementById('customer-live-tracking');
  if(!panel||!order||order.status!=='OUT_FOR_DELIVERY')return;
  await destroyCustomerLiveMap();
  const mapEl=document.getElementById('customer-live-map');
  const statusEl=document.getElementById('customer-live-map-status');
  if(!mapEl)return;
  try{
    const L=await loadLeaflet();
    const response=await fetch(ORDER_API_BASE+'/api/orders/'+encodeURIComponent(order.id)+'/live-location',{headers:{Authorization:'Bearer '+getCustomerOrderToken()}});
    if(!response.ok){
      if(statusEl)statusEl.textContent='Waiting for rider location…';
      customerLiveMap=L.map(mapEl,{zoomControl:true,attributionControl:true}).setView(
        [Number(order.delivery_lat)||-1.286389,Number(order.delivery_lng)||36.817223],14
      );
    }else{
      const loc=await response.json();
      customerLiveMap=L.map(mapEl,{zoomControl:true,attributionControl:true}).setView([Number(loc.latitude),Number(loc.longitude)],15);
      customerLiveMarker=L.marker([Number(loc.latitude),Number(loc.longitude)],{title:'Rider live location'}).addTo(customerLiveMap).bindPopup('<strong>Rider location</strong><br>Live position');
      if(statusEl)statusEl.textContent='RIDER LIVE · UPDATED '+new Date(loc.updated_at||Date.now()).toLocaleTimeString();
    }
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(customerLiveMap);
    if(Number.isFinite(Number(order.delivery_lat))&&Number.isFinite(Number(order.delivery_lng))){
      customerLiveDestinationMarker=L.marker([Number(order.delivery_lat),Number(order.delivery_lng)],{title:'Delivery destination'}).addTo(customerLiveMap).bindPopup('<strong>Delivery destination</strong>');
    }
    customerLiveMapOrderId=String(order.id);
  }catch(err){
    if(statusEl)statusEl.textContent='Live map unavailable';
  }
}
function updateCustomerLiveLocation(data){
  if(!data||!customerLiveMap||String(data.orderId)!==String(customerLiveMapOrderId))return;
  const point=[Number(data.latitude),Number(data.longitude)];
  if(!Number.isFinite(point[0])||!Number.isFinite(point[1]))return;
  if(!customerLiveMarker){
    customerLiveMarker=window.L?.marker(point,{title:'Rider live location'}).addTo(customerLiveMap).bindPopup('<strong>Rider location</strong><br>Live position');
  }else customerLiveMarker.setLatLng(point);
  const statusEl=document.getElementById('customer-live-map-status');
  if(statusEl)statusEl.textContent='RIDER LIVE · UPDATED '+new Date(data.updatedAt||Date.now()).toLocaleTimeString();
}

async function cancelCustomerOrder(id){
  if(!confirm('Cancel this order? You can cancel only before the restaurant accepts it.'))return;
  const button=document.getElementById('cancel-order-btn'); if(button)button.disabled=true;
  try{const result=await cancelRemoteOrder(id);localStorage.removeItem('doe_last_payment_reference');await renderRemoteOrder();if(result.refund)showRefundMessage('Your order was cancelled and the refund has been initiated through Paystack.');else if(result.order?.payment_status==='PENDING')alert('Order cancelled. Because payment had not completed, no refund was needed.');}
  catch(err){if(button)button.disabled=false;alert(err.message||'We could not cancel this order.');}
}
function showRefundMessage(text){const existing=document.getElementById('refund-toast');if(existing)existing.remove();const el=document.createElement('div');el.id='refund-toast';el.className='panel';el.style.cssText='position:fixed;left:20px;right:20px;bottom:20px;z-index:30;box-shadow:0 15px 40px rgba(0,0,0,.18)';const strong=document.createElement('strong');strong.textContent=String(text||'');el.appendChild(strong);document.body.appendChild(el);setTimeout(()=>el.remove(),5000);}

async function markOrderReceived(id,b){id=id||new URLSearchParams(location.search).get('id')||localStorage.getItem('doe_last_order');if(!id)return;b.disabled=true;b.textContent="UPDATING…";try{await fetch(ORDER_API_BASE+"/api/orders/"+encodeURIComponent(id)+"/confirm-delivery",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+getCustomerOrderToken()}});await renderRemoteOrder(false)}catch(err){b.disabled=false;b.textContent="MARK DELIVERED";alert(err.message||"Could not update the order.")}}
async function connectCustomerEvents(orderId){
  const old=window.customerOrderEvents; if(old)old.close();
  try{
    const tokenResponse=await fetch(ORDER_API_BASE+'/api/realtime-token',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getCustomerOrderToken()},body:JSON.stringify({scope:'CUSTOMER_ORDER',orderId})});
    const tokenData=await tokenResponse.json().catch(()=>({}));
    if(!tokenResponse.ok||!tokenData?.token)throw new Error('Realtime token unavailable');
    const source=new EventSource(ORDER_API_BASE+'/api/events?realtimeToken='+encodeURIComponent(tokenData.token));
    window.customerOrderEvents=source;
    source.addEventListener('order.updated',()=>renderRemoteOrder(false));
    source.addEventListener('delivery.location',e=>{try{updateCustomerLiveLocation(JSON.parse(e.data||'{}'));}catch{}});
    source.addEventListener('refund.updated',()=>renderRemoteOrder(false));
    source.onerror=()=>{source.close();setTimeout(()=>connectCustomerEvents(orderId),3000);};
  }catch{setTimeout(()=>connectCustomerEvents(orderId),3000);}
}

async function renderRemoteOrder(showLoading=true){
  const el=document.getElementById('order-view');if(!el)return;
  const params=new URLSearchParams(location.search);const id=params.get('id')||localStorage.getItem('doe_last_order');
  if(!id){el.innerHTML='<div class="empty"><h2>Order not found.</h2><a class="btn" href="menu.html">Start an order</a></div>';return;}
  if(showLoading)el.innerHTML='<div class="panel"><p class="eyebrow">ORDER</p><h1>Loading your order…</h1></div>';
  try{
    const [o,refunds]=await Promise.all([getRemoteOrder(id),loadRefunds(id)]);
    const status=REMOTE_STATUSES.includes(o.status)?o.status:'NEW';const statusIndex=REMOTE_STATUSES.indexOf(status);const paymentStatus=String(o.payment_status||'PENDING').toUpperCase();const paymentLabel=paymentStatus==='PAID'?'Payment confirmed':paymentStatus==='REFUNDED'?'Payment refunded':'Payment pending';const deliveryQuestion=status==='OUT_FOR_DELIVERY';const canCancel=status==='NEW';const notice=paymentMessage(params,paymentStatus);
    const deliveryStatus=o.delivery_status||'NONE';
    const receiptToken=params.get('receipt')||'';
    const receiptPanel=paymentStatus==='PAID'&&receiptToken?'<div class="panel receipt-customer-panel"><p class="eyebrow">RECEIPT</p><h2>Your restaurant receipt is ready.</h2><p class="muted">Open or save the professionally branded receipt with the restaurant logo and layout.</p><a class="btn" target="_blank" rel="noopener" href="'+ORDER_API_BASE+'/api/receipts/public/'+encodeURIComponent(receiptToken)+'/html">OPEN RECEIPT</a></div>':'';
    const rider=o.rider_name?`<div class="panel"><h2>Your rider</h2><p><strong>${escapeOrderHtml(o.rider_name)}</strong></p><p>${escapeOrderHtml(o.vehicle_type||'Delivery vehicle')}${o.number_plate?' · '+o.number_plate:''}</p>${o.rider_phone?`<p>${escapeOrderHtml(o.rider_phone)}</p>`:''}<p class="muted">Delivery status: ${escapeOrderHtml(deliveryStatus.replaceAll('_',' '))}</p></div>`:'';
    const cancelPanel=canCancel?`<div class="panel"><h2>Need to cancel?</h2><p class="muted">You can cancel while the restaurant is still reviewing the order. Once accepted, cancellation from the customer side is disabled.</p><button id="cancel-order-btn" class="btn" type="button" data-action="cancelCustomerOrder('${o.id}')">CANCEL ORDER</button></div>`:'';
    const refundNotice=refunds.length?`<div class="panel refund-customer-panel"><p class="eyebrow">REFUND STATUS</p><h2>${escapeOrderHtml(refundStatusLabel(refunds[0].status))}</h2><p><strong>${money(refunds[0].amount)} ${refunds[0].currency||'KES'}</strong></p><p class="muted">${refundTimingText(refunds[0].status)}</p>${refunds.map(r=>`<div class="summary-row"><span>${escapeOrderHtml(refundStatusLabel(r.status))}</span><strong>${money(r.amount)}</strong></div>`).join('')}</div>`:'';
    el.innerHTML=`<div class="track-head"><p class="eyebrow">ORDER ${escapeOrderHtml(o.order_number)}</p><h1>${status==='CANCELLED'?'Order cancelled':deliveryQuestion?'Have you received your order?':'We have your order.'}</h1><p>Payment: <strong>${escapeOrderHtml(paymentLabel)}</strong> · ${escapeOrderHtml(o.payment_method||'Payment method')}</p>${notice?`<p class="panel">${notice}</p>`:''}<p class="muted">${escapeOrderHtml(REMOTE_LABELS[status])}</p></div>${receiptPanel}${refundNotice}${rider}<div class="panel tracking"><div class="timeline">${REMOTE_STATUSES.filter(s=>s!=='CANCELLED').map((s,i)=>`<div class="timeline-step ${s===status||i<=statusIndex?'active':''}"><span>${i+1}</span><strong>${escapeOrderHtml(REMOTE_LABELS[s])}</strong></div>`).join('')}</div><div class="order-details"><h2>Order summary</h2><div class="summary-row"><span>Customer</span><strong>${escapeOrderHtml(o.customer_name)}</strong></div><div class="summary-row"><span>Phone</span><strong>${escapeOrderHtml(o.phone)}</strong></div><div class="summary-row"><span>Food subtotal</span><strong>${money(o.food_subtotal||o.subtotal)}</strong></div><div class="summary-row"><span>Delivery fee</span><strong>${money(o.delivery_fee||0)}</strong></div><div class="summary-row"><span>Delivery distance</span><strong>${Number(o.route_distance_meters||0)?(Number(o.route_distance_meters)/1000).toFixed(1)+' km':'—'}</strong></div><div class="summary-row total"><span>Total</span><strong>${money(o.total)}</strong></div></div>${deliveryQuestion?'<div class="panel order-received-panel"><p>Please confirm once you have received your order.</p><button class="btn order-received-action" type="button" data-action="markOrderReceived(null,this)">MARK DELIVERED</button></div>':''}</div>${cancelPanel}`;
    if(status==='OUT_FOR_DELIVERY'&&o.rider_name)initCustomerLiveMap(o); else destroyCustomerLiveMap();
    connectCustomerEvents(id);
    if(paymentStatus!=='PAID'&&paymentStatus!=='REFUNDED'&&o.payment_method==='M-Pesa'&&localStorage.getItem('doe_last_payment_reference')&&status!=='CANCELLED'){
      const reference=localStorage.getItem('doe_last_payment_reference');let attempts=0;const poll=async()=>{if(attempts++>=60)return;const check=await verifyPaystackPayment(reference,id).catch(()=>null);if(check?.status==='success'){localStorage.removeItem('doe_last_payment_reference');if(check.receiptToken){const u=new URL(location.href);u.searchParams.set('receipt',check.receiptToken);history.replaceState({},'',u.toString());}await renderRemoteOrder(false);return;}setTimeout(poll,3000);};setTimeout(poll,3000);
    }
  }catch(err){console.error(err);el.innerHTML='<div class="empty"><h2>We could not load this order.</h2><p>Please refresh and try again.</p><a class="btn" href="menu.html">Back to menu</a></div>';}
}
renderRemoteOrder();
