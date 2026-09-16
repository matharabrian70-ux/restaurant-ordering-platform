const REMOTE_STATUSES = ['NEW','ACCEPTED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'];
const REMOTE_LABELS = { NEW:'Order received', ACCEPTED:'Accepted & preparing', OUT_FOR_DELIVERY:'Out for delivery', DELIVERED:'Delivered', CANCELLED:'Order cancelled' };

function paymentMessage(params, paymentStatus){
  if(params.get('payment')==='success') return 'Payment confirmed. Your order has been sent to the restaurant.';
  if(params.get('payment')==='failed') return 'The payment was not confirmed. You can try again from checkout.';
  if(params.get('payment')==='pending' && paymentStatus!=='PAID') return 'Check your phone and approve the M-Pesa request. Paystack may take up to 180 seconds to receive the final result from the mobile-money network.';
  return '';
}

async function cancelCustomerOrder(id){
  if(!confirm('Cancel this order? You can cancel only before the restaurant accepts it.')) return;
  const button=document.getElementById('cancel-order-btn');
  if(button) button.disabled=true;
  try{
    const result=await cancelRemoteOrder(id);
    localStorage.removeItem('doe_last_payment_reference');
    renderRemoteOrder();
    if(result.refund) alert('Order cancelled. A refund has been initiated through Paystack.');
    else if(result.order?.payment_status==='PENDING') alert('Order cancelled. Because payment had not completed, no refund was needed.');
  }catch(err){
    if(button) button.disabled=false;
    alert(err.message || 'We could not cancel this order.');
  }
}

async function renderRemoteOrder(){
  const el=document.getElementById('order-view');
  if(!el)return;
  const params=new URLSearchParams(location.search);
  const id=params.get('id')||localStorage.getItem('doe_last_order');
  if(!id){el.innerHTML='<div class="empty"><h2>Order not found.</h2><a class="btn" href="menu.html">Start an order</a></div>';return;}
  el.innerHTML='<div class="panel"><p class="eyebrow">ORDER</p><h1>Loading your order…</h1></div>';
  try{
    const o=await getRemoteOrder(id);
    const status=REMOTE_STATUSES.includes(o.status)?o.status:'NEW';
    const statusIndex=REMOTE_STATUSES.indexOf(status);
    const paymentStatus=String(o.payment_status||'PENDING').toUpperCase();
    const paymentLabel=paymentStatus==='PAID'?'Payment confirmed':paymentStatus==='REFUNDED'?'Payment refunded':'Payment pending';
    const deliveryQuestion=status==='OUT_FOR_DELIVERY';
    const canCancel=status==='NEW';
    const notice=paymentMessage(params,paymentStatus);
    const rider=o.rider_name?`<div class="panel"><h2>Your rider</h2><p><strong>${o.rider_name}</strong></p><p>${o.vehicle_type||'Delivery vehicle'}${o.number_plate?' · '+o.number_plate:''}</p>${o.rider_phone?`<p>${o.rider_phone}</p>`:''}</div>`:'';
    const cancelPanel=canCancel?`<div class="panel"><h2>Need to cancel?</h2><p class="muted">You can cancel while the restaurant is still reviewing the order. Once accepted, cancellation from the customer side is disabled.</p><button id="cancel-order-btn" class="btn" type="button" onclick="cancelCustomerOrder('${o.id}')">CANCEL ORDER</button></div>`:'';
    const refundNotice=paymentStatus==='REFUNDED'?'<div class="panel"><strong>Refund initiated/processed.</strong><p class="muted">Your payment has been marked as refunded in the ordering system. The time for the funds to reach you depends on Paystack and the payment processor.</p></div>':'';
    el.innerHTML=`<div class="track-head"><p class="eyebrow">ORDER ${o.order_number}</p><h1>${status==='CANCELLED'?'Order cancelled':deliveryQuestion?'Have you received your order?':'We have your order.'}</h1><p>Payment: <strong>${paymentLabel}</strong> · ${o.payment_method||'Payment method'}</p>${notice?`<p class="panel">${notice}</p>`:''}<p class="muted">${REMOTE_LABELS[status]}</p></div>${refundNotice}${rider}<div class="panel tracking"><div class="timeline">${REMOTE_STATUSES.filter(s=>s!=='CANCELLED').map((s,i)=>`<div class="timeline-step ${s===status||i<=statusIndex?'active':''}"><span>${i+1}</span><strong>${REMOTE_LABELS[s]}</strong></div>`).join('')}</div><div class="order-details"><h2>Order summary</h2><div class="summary-row"><span>Customer</span><strong>${o.customer_name}</strong></div><div class="summary-row"><span>Phone</span><strong>${o.phone}</strong></div><div class="summary-row total"><span>Total</span><strong>${money(o.total)}</strong></div></div>${deliveryQuestion?'<div class="panel"><p>Please confirm once you have received your order.</p><button class="btn" type="button" disabled>Confirm delivery (next step)</button></div>':''}</div>${cancelPanel}`;

    if(paymentStatus!=='PAID' && paymentStatus!=='REFUNDED' && o.payment_method==='M-Pesa' && localStorage.getItem('doe_last_payment_reference') && status!=='CANCELLED'){
      const reference=localStorage.getItem('doe_last_payment_reference');
      let attempts=0;
      const poll=async()=>{
        if(attempts++>=60)return;
        const check=await verifyPaystackPayment(reference).catch(()=>null);
        if(check?.status==='success'){
          localStorage.removeItem('doe_last_payment_reference');
          renderRemoteOrder();
          return;
        }
        setTimeout(poll,3000);
      };
      setTimeout(poll,3000);
    }
  }catch(err){
    console.error(err);
    el.innerHTML='<div class="empty"><h2>We could not load this order.</h2><p>Please refresh and try again.</p><a class="btn" href="menu.html">Back to menu</a></div>';
  }
}
renderRemoteOrder();
