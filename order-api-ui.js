const ORDER_API_BASE = 'https://restaurant-ordering-api-ow3p.onrender.com';
const REMOTE_STATUSES = ['NEW','ACCEPTED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'];
const REMOTE_LABELS = { NEW:'Order received', ACCEPTED:'Accepted & preparing', OUT_FOR_DELIVERY:'Out for delivery', DELIVERED:'Delivered', CANCELLED:'Order cancelled' };

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
async function loadRefunds(id){return fetch(`${ORDER_API_BASE}/api/orders/${encodeURIComponent(id)}/refunds`).then(r=>r.ok?r.json():[]).catch(()=>[]);}

async function cancelCustomerOrder(id){
  if(!confirm('Cancel this order? You can cancel only before the restaurant accepts it.'))return;
  const button=document.getElementById('cancel-order-btn'); if(button)button.disabled=true;
  try{const result=await cancelRemoteOrder(id);localStorage.removeItem('doe_last_payment_reference');await renderRemoteOrder();if(result.refund)showRefundMessage('Your order was cancelled and the refund has been initiated through Paystack.');else if(result.order?.payment_status==='PENDING')alert('Order cancelled. Because payment had not completed, no refund was needed.');}
  catch(err){if(button)button.disabled=false;alert(err.message||'We could not cancel this order.');}
}
function showRefundMessage(text){const existing=document.getElementById('refund-toast');if(existing)existing.remove();document.body.insertAdjacentHTML('beforeend',`<div id="refund-toast" class="panel" style="position:fixed;left:20px;right:20px;bottom:20px;z-index:30;box-shadow:0 15px 40px rgba(0,0,0,.18)"><strong>${text}</strong></div>`);setTimeout(()=>document.getElementById('refund-toast')?.remove(),5000);}

function connectCustomerEvents(orderId){
  const old=window.customerOrderEvents; if(old)old.close();
  const source=new EventSource(`${ORDER_API_BASE}/api/events?businessId=${encodeURIComponent(window.CUSTOMER_ORDER_BUSINESS_ID||'11111111-1111-4111-8111-111111111111')}&orderId=${encodeURIComponent(orderId)}`);
  window.customerOrderEvents=source;
  source.addEventListener('order.updated',()=>renderRemoteOrder(false));
  source.addEventListener('refund.updated',()=>renderRemoteOrder(false));
  source.onerror=()=>{source.close();setTimeout(()=>connectCustomerEvents(orderId),3000);};
}

async function renderRemoteOrder(showLoading=true){
  const el=document.getElementById('order-view');if(!el)return;
  const params=new URLSearchParams(location.search);const id=params.get('id')||localStorage.getItem('doe_last_order');
  if(!id){el.innerHTML='<div class="empty"><h2>Order not found.</h2><a class="btn" href="menu.html">Start an order</a></div>';return;}
  if(showLoading)el.innerHTML='<div class="panel"><p class="eyebrow">ORDER</p><h1>Loading your order…</h1></div>';
  try{
    const [o,refunds]=await Promise.all([getRemoteOrder(id),loadRefunds(id)]);
    const status=REMOTE_STATUSES.includes(o.status)?o.status:'NEW';const statusIndex=REMOTE_STATUSES.indexOf(status);const paymentStatus=String(o.payment_status||'PENDING').toUpperCase();const paymentLabel=paymentStatus==='PAID'?'Payment confirmed':paymentStatus==='REFUNDED'?'Payment refunded':'Payment pending';const deliveryQuestion=status==='OUT_FOR_DELIVERY';const canCancel=status==='NEW';const notice=paymentMessage(params,paymentStatus);
    const rider=o.rider_name?`<div class="panel"><h2>Your rider</h2><p><strong>${o.rider_name}</strong></p><p>${o.vehicle_type||'Delivery vehicle'}${o.number_plate?' · '+o.number_plate:''}</p>${o.rider_phone?`<p>${o.rider_phone}</p>`:''}</div>`:'';
    const cancelPanel=canCancel?`<div class="panel"><h2>Need to cancel?</h2><p class="muted">You can cancel while the restaurant is still reviewing the order. Once accepted, cancellation from the customer side is disabled.</p><button id="cancel-order-btn" class="btn" type="button" onclick="cancelCustomerOrder('${o.id}')">CANCEL ORDER</button></div>`:'';
    const refundNotice=refunds.length?`<div class="panel refund-customer-panel"><p class="eyebrow">REFUND STATUS</p><h2>${refundStatusLabel(refunds[0].status)}</h2><p><strong>${money(refunds[0].amount)} ${refunds[0].currency||'KES'}</strong></p><p class="muted">${refundTimingText(refunds[0].status)}</p>${refunds.map(r=>`<div class="summary-row"><span>${refundStatusLabel(r.status)}</span><strong>${money(r.amount)}</strong></div>`).join('')}</div>`:'';
    el.innerHTML=`<div class="track-head"><p class="eyebrow">ORDER ${o.order_number}</p><h1>${status==='CANCELLED'?'Order cancelled':deliveryQuestion?'Have you received your order?':'We have your order.'}</h1><p>Payment: <strong>${paymentLabel}</strong> · ${o.payment_method||'Payment method'}</p>${notice?`<p class="panel">${notice}</p>`:''}<p class="muted">${REMOTE_LABELS[status]}</p></div>${refundNotice}${rider}<div class="panel tracking"><div class="timeline">${REMOTE_STATUSES.filter(s=>s!=='CANCELLED').map((s,i)=>`<div class="timeline-step ${s===status||i<=statusIndex?'active':''}"><span>${i+1}</span><strong>${REMOTE_LABELS[s]}</strong></div>`).join('')}</div><div class="order-details"><h2>Order summary</h2><div class="summary-row"><span>Customer</span><strong>${o.customer_name}</strong></div><div class="summary-row"><span>Phone</span><strong>${o.phone}</strong></div><div class="summary-row total"><span>Total</span><strong>${money(o.total)}</strong></div></div>${deliveryQuestion?'<div class="panel"><p>Please confirm once you have received your order.</p><button class="btn" type="button" disabled>Confirm delivery (next step)</button></div>':''}</div>${cancelPanel}`;
    connectCustomerEvents(id);
    if(paymentStatus!=='PAID'&&paymentStatus!=='REFUNDED'&&o.payment_method==='M-Pesa'&&localStorage.getItem('doe_last_payment_reference')&&status!=='CANCELLED'){
      const reference=localStorage.getItem('doe_last_payment_reference');let attempts=0;const poll=async()=>{if(attempts++>=60)return;const check=await verifyPaystackPayment(reference).catch(()=>null);if(check?.status==='success'){localStorage.removeItem('doe_last_payment_reference');await renderRemoteOrder(false);return;}setTimeout(poll,3000);};setTimeout(poll,3000);
    }
  }catch(err){console.error(err);el.innerHTML='<div class="empty"><h2>We could not load this order.</h2><p>Please refresh and try again.</p><a class="btn" href="menu.html">Back to menu</a></div>';}
}
renderRemoteOrder();
