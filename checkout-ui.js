async function renderCheckoutUpgrade(){
  const el=document.getElementById('checkout-view');
  if(!el)return;
  const c=getCart();
  if(!c.length){el.innerHTML='<div class="empty"><h2>Your cart is empty.</h2><a class="btn" href="menu.html">Browse menu</a></div>';return;}
  const subtotal=c.reduce((sum,i)=>sum+i.unit*i.qty,0);
  let business={pickup_address:'Savanna Bites, Nairobi, Kenya'};
  try{business=await apiRequest('/api/businesses/'+encodeURIComponent(BUSINESS_ID));}catch{}
  el.innerHTML=`<div class="checkout-layout">
    <section>
      <p class="eyebrow">CHECKOUT</p><h1>Complete your order.</h1>
      <div class="panel"><h2>Your items</h2>
      ${c.map(i=>`<div class="summary-row"><span>${i.qty} × ${i.name}<small style="display:block">${Object.entries(i.options||{}).map(x=>x[0]+': '+x[1]).join(' • ')}</small></span><strong>${money(i.unit*i.qty)}</strong></div>`).join('')}
      <div class="summary-row"><span>Food subtotal</span><strong>${money(subtotal)}</strong></div>
      <div class="summary-row"><span>Delivery fee</span><strong id="delivery-fee">Enter your delivery address</strong></div>
      <div class="summary-row total"><span>Total</span><strong id="checkout-total">${money(subtotal)}</strong></div>
      <p id="route-summary" class="muted"></p></div>
    </section>
    <section class="panel"><h2>Delivery details</h2>
      <form id="checkout-upgrade">
        <div class="field"><label>Name</label><input id="customer" required placeholder="Your name"></div>
        <div class="field"><label>Phone</label><input id="phone" required placeholder="07xx xxx xxx"></div>
        <div class="field"><label>Email</label><input id="email" type="email" required placeholder="you@example.com"></div>
        <div class="field"><label>Delivery location</label><input id="delivery-address" required placeholder="House, apartment, estate, street or landmark"><button class="btn secondary" type="button" id="location-button">USE MY LOCATION</button><small id="location-status" class="muted">For Digital Ordering, your location is used to estimate distance without live route pricing.</small></div>
        <div class="field"><label>Delivery note</label><input id="note" placeholder="Gate code, floor, directions…"></div>
        <div class="option-group payment"><h4>Payment method</h4><label><input type="radio" name="payment" value="M-Pesa" checked> M-Pesa</label><label><input type="radio" name="payment" value="Card"> Card</label><p class="muted">The delivery price is calculated from the route and current pricing inputs before payment.</p></div>
        <button class="btn wide" id="quote-button" type="button">CALCULATE DELIVERY FEE</button>
        <button class="btn wide" id="pay-button" type="submit" disabled>Continue to payment</button>
      </form>
      <p id="checkout-error" class="muted"></p>
    </section>
  </div>`;

  let quote=null,customerLat=null,customerLng=null;
  const quoteButton=document.getElementById('quote-button');
  const locationButton=document.getElementById('location-button');
  const locationStatus=document.getElementById('location-status');
  locationButton.onclick=()=>{if(!navigator.geolocation){locationStatus.textContent='Location is not available in this browser.';return}locationButton.disabled=true;locationButton.textContent='LOCATING…';navigator.geolocation.getCurrentPosition(p=>{customerLat=p.coords.latitude;customerLng=p.coords.longitude;locationStatus.textContent='Location captured. The delivery calculator can use it.';locationButton.textContent='LOCATION CAPTURED ✓';locationButton.disabled=false},()=>{locationStatus.textContent='Location permission was not granted. Please enable it or use a delivery address supported by the active pricing mode.';locationButton.textContent='USE MY LOCATION';locationButton.disabled=false},{enableHighAccuracy:true,timeout:10000,maximumAge:60000})};
  const payButton=document.getElementById('pay-button');
  const error=document.getElementById('checkout-error');
  quoteButton.onclick=async()=>{
    const address=document.getElementById('delivery-address').value.trim();
    if(!address){error.textContent='Enter your delivery location first.';return;}
    quoteButton.disabled=true; error.textContent=customerLat!==null?'Calculating delivery fee…':'Calculating delivery fee…';
    try{
      quote=await getDeliveryQuote({pickupAddress:business.pickup_address||'Savanna Bites, Nairobi, Kenya',deliveryAddress:address,latitude:customerLat,longitude:customerLng});
      document.getElementById('delivery-fee').textContent=money(quote.deliveryFee);
      document.getElementById('checkout-total').textContent=money(subtotal+Number(quote.deliveryFee));
      document.getElementById('route-summary').textContent=`${Number(quote.km).toFixed(1)} km · about ${Math.max(1,Math.round(Number(quote.minutes)))} min · ${quote.branchName||'Best available branch'} · ${quote.pricingMode==='AUTO'?'automatic platform pricing':'restaurant pricing rules'}`;
      payButton.disabled=false;
      error.textContent='Delivery fee locked into this order quote.';
    }catch(err){quote=null;payButton.disabled=true;error.textContent=err.message||'Could not calculate delivery fee.';}
    finally{quoteButton.disabled=false;}
  };
  document.getElementById('checkout-upgrade').onsubmit=async e=>{
    e.preventDefault();
    if(!quote){error.textContent='Calculate the delivery fee before paying.';return;}
    payButton.disabled=true;quoteButton.disabled=true;error.textContent='Creating your order…';
    try{
      const order=await createRemoteOrder({
        customer:document.getElementById('customer').value.trim(),
        phone:document.getElementById('phone').value.trim(),
        email:document.getElementById('email').value.trim(),
        note:document.getElementById('note').value.trim(),
        deliveryAddress:document.getElementById('delivery-address').value.trim(),
        payment:document.querySelector('input[name=payment]:checked').value,
        items:c,subtotal,total:subtotal+Number(quote.deliveryFee),quoteId:quote.quoteId
      });
      write('doe_last_order',order.id);
      error.textContent='Starting secure payment…';
      const payment=await initializePaystackPayment(order.id);
      if(payment.mode==='redirect'&&payment.authorizationUrl){localStorage.removeItem('doe_cart');location.href=payment.authorizationUrl;return;}
      if(payment.mode==='mobile_money'){localStorage.setItem('doe_last_payment_reference',payment.reference);localStorage.removeItem('doe_cart');location.href='order.html?id='+encodeURIComponent(order.id)+'&payment=pending';return;}
      throw new Error('Payment could not be started');
    }catch(err){payButton.disabled=false;quoteButton.disabled=false;error.textContent=err.message||'We could not start the payment.';console.error(err);}
  };
}
renderCheckoutUpgrade();