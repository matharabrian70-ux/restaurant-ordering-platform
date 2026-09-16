const REMOTE_STATUSES = ['NEW','ACCEPTED','OUT_FOR_DELIVERY','DELIVERED'];
const REMOTE_LABELS = {
  NEW: 'Order received',
  ACCEPTED: 'Accepted & preparing',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered'
};

function paymentMessage(params, paymentStatus){
  if(params.get('payment')==='success') return 'Payment confirmed. Your order has been sent to the restaurant.';
  if(params.get('payment')==='failed') return 'The payment was not confirmed. You can try again from checkout.';
  if(params.get('payment')==='pending' && paymentStatus!=='PAID') return 'Check your phone and approve the M-Pesa request. We will update this page when Paystack confirms it.';
  return '';
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
    const paymentLabel=paymentStatus==='PAID'?'Payment confirmed':'Payment pending';
    const deliveryQuestion=status==='OUT_FOR_DELIVERY';
    const notice=paymentMessage(params,paymentStatus);
    const rider=o.rider_name?`<div class="panel"><h2>Your rider</h2><p><strong>${o.rider_name}</strong></p><p>${o.vehicle_type||'Delivery vehicle'}${o.number_plate?' · '+o.number_plate:''}</p></div>`:'';
    el.innerHTML=`<div class="track-head"><p class="eyebrow">ORDER ${o.order_number}</p><h1>${deliveryQuestion?'Have you received your order?':'We have your order.'}</h1><p>Payment: <strong>${paymentLabel}</strong> · ${o.payment_method||'Payment method'}</p>${notice?`<p class="panel">${notice}</p>`:''}<p class="muted">${REMOTE_LABELS[status]}</p></div>${rider}<div class="panel tracking"><div class="timeline">${REMOTE_STATUSES.map((s,i)=>`<div class="timeline-step ${i<=statusIndex?'active':''}"><span>${i+1}</span><strong>${REMOTE_LABELS[s]}</strong></div>`).join('')}</div><div class="order-details"><h2>Order summary</h2><div class="summary-row"><span>Customer</span><strong>${o.customer_name}</strong></div><div class="summary-row"><span>Phone</span><strong>${o.phone}</strong></div><div class="summary-row total"><span>Total</span><strong>${money(o.total)}</strong></div></div>${deliveryQuestion?'<div class="panel"><p>Please confirm once you have received your order.</p><button class="btn" type="button" disabled>Confirm delivery (next step)</button></div>':''}</div>`;

    if(paymentStatus!=='PAID' && o.payment_method==='M-Pesa' && localStorage.getItem('doe_last_payment_reference')){
      const reference=localStorage.getItem('doe_last_payment_reference');
      let attempts=0;
      const poll=async()=>{
        if(attempts++>=20)return;
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
