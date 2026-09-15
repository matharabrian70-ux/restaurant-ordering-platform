function renderCheckoutUpgrade(){
  const el=document.getElementById('checkout-view');
  if(!el)return;
  const c=getCart();
  if(!c.length){el.innerHTML='<div class="empty"><h2>Your cart is empty.</h2><a class="btn" href="menu.html">Browse menu</a></div>';return;}
  const total=c.reduce((s,i)=>s+i.unit*i.qty,0);
  el.innerHTML=`<div class="checkout-layout"><section><p class="eyebrow">CHECKOUT</p><h1>Complete your order.</h1><div class="panel"><h2>Your items</h2>${c.map(i=>`<div class="summary-row"><span>${i.qty} × ${i.name}<small style="display:block">${Object.entries(i.options||{}).map(x=>x[0]+': '+x[1]).join(' • ')}</small></span><strong>${money(i.unit*i.qty)}</strong></div>`).join('')}<div class="summary-row total"><span>Total</span><strong>${money(total)}</strong></div></div></section><section class="panel"><h2>Customer details</h2><form id="checkout-upgrade"><div class="field"><label>Name</label><input id="customer" required placeholder="Your name"></div><div class="field"><label>Phone</label><input id="phone" required placeholder="07xx xxx xxx"></div><div class="field"><label>Email</label><input id="email" type="email" required placeholder="you@example.com"></div><div class="field"><label>Delivery / pickup note</label><input id="note" placeholder="e.g. Westlands, apartment 4B"></div><div class="option-group payment"><h4>Payment method</h4><label><input type="radio" name="payment" value="M-Pesa" checked> M-Pesa</label><label><input type="radio" name="payment" value="Card"> Card</label><label><input type="radio" name="payment" value="PayPal"> PayPal</label></div><button class="btn wide" type="submit">Place order ${money(total)} <small>(demo payment)</small></button></form><p id="checkout-error" class="muted"></p></section></div>`;

  document.getElementById('checkout-upgrade').onsubmit=async e=>{
    e.preventDefault();
    const button=e.currentTarget.querySelector('button');
    const error=document.getElementById('checkout-error');
    button.disabled=true;
    error.textContent='Sending your order…';
    try{
      const order=await createRemoteOrder({
        customer:document.getElementById('customer').value.trim(),
        phone:document.getElementById('phone').value.trim(),
        email:document.getElementById('email').value.trim(),
        note:document.getElementById('note').value.trim(),
        payment:document.querySelector('input[name=payment]:checked').value,
        items:c,
        total
      });
      write('doe_last_order',order.id);
      localStorage.removeItem('doe_cart');
      location.href='order.html?id='+encodeURIComponent(order.id);
    }catch(err){
      button.disabled=false;
      error.textContent='We could not place the order. Please try again.';
      console.error(err);
    }
  };
}
renderCheckoutUpgrade();
