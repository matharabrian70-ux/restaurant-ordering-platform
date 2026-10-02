function escapeCheckoutHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function checkoutItemOptions(item){
  return Object.entries(item.options||{}).map(x=>escapeCheckoutHtml(x[0])+': '+escapeCheckoutHtml(x[1])).join(' • ')||'Standard item';
}

function checkoutPaymentCard(value,icon,title,description,disabled=false,badge=''){
  return '<label class="checkout-payment">'+
    '<input type="radio" name="payment" value="'+escapeCheckoutHtml(value)+'" '+(value==='M-Pesa'?'checked ':'')+(disabled?'disabled':'')+'>'+
    '<span class="checkout-payment-card">'+
      '<span class="checkout-payment-icon">'+icon+'</span>'+
      '<span class="checkout-payment-copy"><strong>'+title+'</strong><small>'+description+'</small></span>'+
      '<span class="checkout-payment-check">✓</span>'+
    '</span>'+
    (badge?'<span class="checkout-payment-badge">'+badge+'</span>':'')+
  '</label>';
}

async function renderCheckoutUpgrade(){
  const el=document.getElementById('checkout-view');
  if(!el)return;
  const c=getCart();
  if(!c.length){
    el.innerHTML='<div class="checkout-empty"><h2>Your cart is empty.</h2><p>Add something delicious from the menu before checking out.</p><a class="btn" href="menu.html">Browse menu</a></div>';
    return;
  }

  const subtotal=c.reduce((sum,i)=>sum+i.unit*i.qty,0);
  let business={pickup_address:'Savanna Bites, Nairobi, Kenya'};
  try{business=await apiRequest('/api/businesses/'+encodeURIComponent(BUSINESS_ID));}catch{}

  el.innerHTML='<div class="checkout-shell">'+
    '<header class="checkout-top">'+
      '<div><p class="eyebrow">SECURE CHECKOUT</p><h1>Complete your order.</h1><p>Enter your delivery details, review the total and choose how you want to pay.</p></div>'+
      '<div class="checkout-secure"><span>✓</span> Secure payment flow</div>'+
    '</header>'+
    '<div class="checkout-columns">'+
      '<div class="checkout-main">'+
        '<section class="checkout-card">'+
          '<div class="checkout-card-head"><div><p class="eyebrow">YOUR DETAILS</p><h2>Contact information</h2><p>We use these details to confirm and deliver your order.</p></div><span class="checkout-step">1</span></div>'+
          '<form id="checkout-upgrade">'+
            '<div class="checkout-fields">'+
              '<div class="checkout-field"><label for="customer">Full name</label><input id="customer" required autocomplete="name" placeholder="e.g. Brian Mwangi"></div>'+
              '<div class="checkout-field"><label for="phone">Phone number</label><input id="phone" required autocomplete="tel" inputmode="tel" placeholder="07xx xxx xxx"></div>'+
              '<div class="checkout-field full"><label for="email">Email address</label><input id="email" type="email" required autocomplete="email" placeholder="you@example.com"><small class="checkout-field-help">We'll use this for order and payment updates.</small></div>'+
            '</div>'+
        '</section>'+
        '<section class="checkout-card">'+
          '<div class="checkout-card-head"><div><p class="eyebrow">DELIVERY</p><h2>Where should we deliver?</h2><p>Your address is used to calculate the delivery fee.</p></div><span class="checkout-step">2</span></div>'+
          '<div class="checkout-fields">'+
            '<div class="checkout-field full"><label for="delivery-address">Delivery location</label><div class="checkout-location-row"><input id="delivery-address" required autocomplete="street-address" placeholder="House, apartment, estate, street or landmark"><button class="checkout-location-btn" type="button" id="location-button">USE MY LOCATION</button></div><small id="location-status" class="checkout-field-help">For Digital Ordering, your location is used to estimate distance without live route pricing.</small></div>'+
            '<div class="checkout-field full"><label for="note">Delivery note <span style="font-weight:500;color:var(--muted)">(optional)</span></label><input id="note" autocomplete="off" placeholder="Gate code, floor, directions…"></div>'+
          '</div>'+
          '<div id="checkout-quote" class="checkout-quote" hidden><div><strong>Delivery fee calculated</strong><small id="route-summary">Route details will appear here.</small></div><strong id="delivery-fee">KSh 0</strong></div>'+
        '</section>'+
        '<section class="checkout-card">'+
          '<div class="checkout-card-head"><div><p class="eyebrow">PAYMENT</p><h2>Choose a payment method</h2><p>Your payment is started only after the order quote is confirmed.</p></div><span class="checkout-step">3</span></div>'+
          '<div class="checkout-payment-grid">'+
            checkoutPaymentCard('M-Pesa','M','M-Pesa','Fast mobile payment')+
            checkoutPaymentCard('Card','▣','Card','Visa, Mastercard and more')+
          '</div>'+
          '<div class="checkout-payment-grid" style="margin-top:10px">'+
            checkoutPaymentCard('PayPal','P','PayPal','Pay securely with PayPal',true,'COMING SOON')+
          '</div>'+
          '<div class="checkout-paypal-note">PayPal can be added as a live payment rail after the merchant PayPal account, client credentials and server-side create/capture endpoints are configured. We will not show a fake PayPal payment as successful.</div>'+
          '<div class="checkout-legal">'+
            '<label class="checkout-check"><input id="terms-accepted" type="checkbox" required><span>I agree to the <a href="terms.html?businessId='+encodeURIComponent(BUSINESS_ID)+'" target="_blank" rel="noopener">Terms &amp; Conditions</a> and acknowledge the <a href="privacy.html?businessId='+encodeURIComponent(BUSINESS_ID)+'" target="_blank" rel="noopener">Privacy Notice</a>.</span></label>'+
            '<label class="checkout-check"><input id="marketing-opt-in" type="checkbox"><span>Send me optional restaurant offers and updates by SMS/email.</span></label>'+
          '</div>'+
          '<button class="checkout-primary" id="quote-button" type="button">CALCULATE DELIVERY FEE</button>'+
          '<button class="checkout-primary" id="pay-button" type="submit" disabled>Continue to secure payment</button>'+
          '<p id="checkout-error" class="checkout-error muted" aria-live="polite"></p>'+
          '</form>'+
        '</section>'+
      '</div>'+
      '<aside class="checkout-summary">'+
        '<section class="checkout-card">'+
          '<div class="checkout-summary-head"><h2>Your order</h2><a href="menu.html">Edit order</a></div>'+
          '<div class="checkout-items">'+
            c.map(i=>'<article class="checkout-item"><div class="checkout-item-thumb"><img src="'+escapeCheckoutHtml(i.image||'')+'" alt=""></div><div class="checkout-item-copy"><strong>'+escapeCheckoutHtml(i.name)+'</strong><small>'+i.qty+' × '+checkoutItemOptions(i)+'</small></div><span class="checkout-item-price">'+money(i.unit*i.qty)+'</span></article>').join('')+
          '</div>'+
          '<div class="checkout-totals">'+
            '<div class="checkout-total-row"><span>Food subtotal</span><strong>'+money(subtotal)+'</strong></div>'+
            '<div class="checkout-total-row"><span>Delivery</span><strong id="summary-delivery">Calculated next</strong></div>'+
            '<div class="checkout-total-row final"><span>Total</span><strong id="checkout-total">'+money(subtotal)+'</strong></div>'+
          '</div>'+
          '<div class="checkout-route" id="summary-route">Delivery fee will be locked into your order after you calculate the route.</div>'+
          '<div class="checkout-trust"><div><b>✓</b>Verified</div><div><b>↻</b>Trackable</div><div><b>⌁</b>Protected</div></div>'+
        '</section>'+
      '</aside>'+
    '</div>'+
  '</div>';

  const form=document.getElementById('checkout-upgrade');
  let quote=null,customerLat=null,customerLng=null;
  const quoteButton=document.getElementById('quote-button');
  const locationButton=document.getElementById('location-button');
  const locationStatus=document.getElementById('location-status');
  const payButton=document.getElementById('pay-button');
  const error=document.getElementById('checkout-error');

  locationButton.onclick=()=>{
    if(!navigator.geolocation){locationStatus.textContent='Location is not available in this browser.';return;}
    locationButton.disabled=true;locationButton.textContent='LOCATING…';
    navigator.geolocation.getCurrentPosition(p=>{
      customerLat=p.coords.latitude;customerLng=p.coords.longitude;
      locationStatus.textContent='Location captured. You can now calculate the delivery fee.';
      locationButton.textContent='LOCATION CAPTURED ✓';locationButton.disabled=false;
    },()=>{
      locationStatus.textContent='Location permission was not granted. You can enter the delivery address manually.';
      locationButton.textContent='USE MY LOCATION';locationButton.disabled=false;
    },{enableHighAccuracy:true,timeout:10000,maximumAge:60000});
  };

  quoteButton.onclick=async()=>{
    const address=document.getElementById('delivery-address').value.trim();
    if(!address){error.textContent='Enter your delivery location first.';document.getElementById('delivery-address').focus();return;}
    quoteButton.disabled=true;quoteButton.innerHTML='<span class="checkout-spinner"></span> Calculating route…';error.textContent='';
    try{
      quote=await getDeliveryQuote({pickupAddress:business.pickup_address||'Savanna Bites, Nairobi, Kenya',deliveryAddress:address,latitude:customerLat,longitude:customerLng});
      let zone=null;
      if(customerLat!==null&&customerLng!==null){
        try{zone=await apiRequest('/api/delivery/zones/quote',{method:'POST',body:JSON.stringify({businessId:BUSINESS_ID,latitude:customerLat,longitude:customerLng,orderAmount:subtotal})});}catch{}
      }
      if(zone)quote={...quote,deliveryFee:zone.deliveryFee,zoneName:zone.zoneName};
      const fee=Number(quote.deliveryFee||0),total=subtotal+fee;
      document.getElementById('delivery-fee').textContent=money(fee);
      document.getElementById('summary-delivery').textContent=money(fee);
      document.getElementById('checkout-total').textContent=money(total);
      const routeText=Number(quote.km).toFixed(1)+' km · about '+Math.max(1,Math.round(Number(quote.minutes)))+' min · '+(quote.branchName||'Best available branch')+' · '+(quote.pricingMode==='AUTO'?'automatic platform pricing':'restaurant pricing rules');
      document.getElementById('route-summary').textContent=routeText;
      document.getElementById('summary-route').textContent=routeText;
      document.getElementById('checkout-quote').hidden=false;
      payButton.disabled=false;
      error.textContent='Delivery fee locked into this order quote.';
    }catch(err){
      quote=null;payButton.disabled=true;error.textContent=err.message||'Could not calculate delivery fee.';
    }finally{
      quoteButton.disabled=false;quoteButton.textContent='RECALCULATE DELIVERY FEE';
    }
  };

  form.onsubmit=async e=>{
    e.preventDefault();
    if(!quote){error.textContent='Calculate the delivery fee before paying.';return;}
    const payment=document.querySelector('input[name=payment]:checked')?.value||'M-Pesa';
    if(payment==='PayPal'){error.textContent='PayPal is not enabled for this restaurant yet.';return;}
    payButton.disabled=true;quoteButton.disabled=true;payButton.innerHTML='<span class="checkout-spinner"></span> Creating secure payment…';error.textContent='';
    try{
      const order=await createRemoteOrder({
        customer:document.getElementById('customer').value.trim(),
        phone:document.getElementById('phone').value.trim(),
        email:document.getElementById('email').value.trim(),
        note:document.getElementById('note').value.trim(),
        deliveryAddress:document.getElementById('delivery-address').value.trim(),
        payment,items:c,subtotal,total:subtotal+Number(quote.deliveryFee),quoteId:quote.quoteId,
        legal:{termsAccepted:document.getElementById('terms-accepted').checked,privacyNoticeAccepted:document.getElementById('terms-accepted').checked,marketingOptIn:document.getElementById('marketing-opt-in').checked}
      });
      write('doe_last_order',order.id);
      setCustomerOrderToken(order.customerAccessToken);
      const paymentResult=await initializePaystackPayment(order.id);
      if(paymentResult.mode==='redirect'&&paymentResult.authorizationUrl){localStorage.removeItem('doe_cart');location.href=paymentResult.authorizationUrl;return;}
      if(paymentResult.mode==='mobile_money'){localStorage.setItem('doe_last_payment_reference',paymentResult.reference);localStorage.removeItem('doe_cart');location.href='order.html?id='+encodeURIComponent(order.id)+'&payment=pending';return;}
      throw new Error('Payment could not be started');
    }catch(err){
      payButton.disabled=false;quoteButton.disabled=false;payButton.textContent='Continue to secure payment';error.textContent=err.message||'We could not start the payment.';console.error(err);
    }
  };
}
renderCheckoutUpgrade();
