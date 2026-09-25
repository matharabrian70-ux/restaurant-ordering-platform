const PRODUCTS = [
  {id:'burger',name:'Smoky Savanna Burger',category:'Mains',price:850,image:'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=85',desc:'Char-grilled beef, smoky sauce, crisp lettuce and house pickles.',options:[{name:'Fries',choices:[['none','No fries',0],['regular','Regular fries',150],['loaded','Loaded fries',250]]},{name:'Drink',choices:[['none','No drink',0],['soda','Soda',100],['juice','Fresh juice',180]]}]},
  {id:'chicken',name:'Peri-Peri Chicken',category:'Mains',price:1100,image:'https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=900&q=85',desc:'Flame-grilled chicken with our signature peri-peri glaze.',options:[{name:'Heat level',choices:[['mild','Mild',0],['medium','Medium',0],['hot','Hot',0]]},{name:'Side',choices:[['chips','Seasoned chips',200],['rice','Coconut rice',180],['salad','Garden salad',150]]}]},
  {id:'pizza',name:'Garden Fire Pizza',category:'Mains',price:1250,image:'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=85',desc:'Mozzarella, roasted peppers, mushrooms, herbs and chili oil.',options:[{name:'Size',choices:[['medium','Medium',0],['large','Large',350]]}]},
  {id:'fries',name:'Loaded Savanna Fries',category:'Sides',price:450,image:'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=85',desc:'Crispy fries topped with house sauce and herbs.',options:[{name:'Extra sauce',choices:[['no','No extra sauce',0],['yes','Extra sauce',80]]}]},
  {id:'juice',name:'Fresh Passion Juice',category:'Drinks',price:280,image:'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=900&q=85',desc:'Fresh passion fruit juice served chilled.',options:[{name:'Ice',choices:[['normal','Normal ice',0],['less','Less ice',0],['none','No ice',0]]}]},
  {id:'cake',name:'Chocolate Fudge Cake',category:'Desserts',price:500,image:'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=85',desc:'Rich chocolate cake with a smooth fudge finish.',options:[]}
];
const money=n=>'KSh '+Number(n).toLocaleString();
const read=(key,fallback=[])=>JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback));
const write=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
function getCart(){return read('doe_cart',[])}
function saveCart(c){write('doe_cart',c);updateCount()}
function updateCount(){const n=getCart().reduce((s,i)=>s+i.qty,0);document.querySelectorAll('#cart-count').forEach(x=>x.textContent=n)}
function product(id){return PRODUCTS.find(p=>p.id===id)}
function addItem(item){const c=getCart();const key=JSON.stringify(item.options||{});const existing=c.find(x=>x.id===item.id&&JSON.stringify(x.options||{})===key);if(existing)existing.qty+=item.qty;else c.push(item);saveCart(c);location.href='cart.html'}
function removeItem(index){const c=getCart();c.splice(index,1);saveCart(c);renderCart()}
function changeQty(index,delta){const c=getCart();c[index].qty=Math.max(1,c[index].qty+delta);saveCart(c);renderCart()}
const MENU_PRODUCTS = new Map();
function escapeMenuHtml(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function renderSignatureMenu(products){
  const grid=document.getElementById('menu-grid');
  if(!grid)return;
  MENU_PRODUCTS.clear();
  products.forEach(p=>MENU_PRODUCTS.set(String(p.id),p));
  grid.innerHTML=products.map(p=>{
    const id=escapeMenuHtml(p.id);
    const name=escapeMenuHtml(p.name);
    const category=escapeMenuHtml(p.category||'Menu');
    const desc=escapeMenuHtml(p.desc||'');
    const image=escapeMenuHtml(p.image||'');
    const featured=p.featured?'<span class="signature-badge signature-featured"><span class="signature-star">★</span> FEATURED</span>':'';
    return `<article class="signature-menu-card">
      <div class="signature-menu-photo">
        <img src="${image}" alt="${name}" loading="lazy">
        <div class="signature-menu-wash"></div>
        <div class="signature-menu-copy">
          <p class="signature-category">${category}</p>
          <h3>${name}</h3>
          <p class="signature-description">${desc}</p>
          <div class="signature-meta">
            <strong class="signature-price">${money(p.price)}</strong>
            <div class="signature-badges">
              <span class="signature-badge signature-available"><span class="signature-dot"></span> AVAILABLE</span>
              ${featured}
            </div>
          </div>
        </div>
      </div>
      <div class="signature-menu-actions">
        <button type="button" class="signature-add-btn" data-menu-add="${id}"><span class="signature-cart-icon">🛒</span> ADD TO CART</button>
      </div>
    </article>`;
  }).join('');
}
function renderMenu(){renderSignatureMenu(PRODUCTS)}
function addMenuProduct(id){
  const p=MENU_PRODUCTS.get(String(id));
  if(!p)return;
  addItem({
    id:p.id,
    name:p.name,
    base:Number(p.price||0),
    unit:Number(p.price||0),
    qty:1,
    options:{},
    image:p.image||''
  });
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-menu-add]');
  if(b){e.preventDefault();addMenuProduct(b.dataset.menuAdd)}
});
function renderProduct(){const el=document.getElementById('product-view');if(!el)return;const id=new URLSearchParams(location.search).get('id')||'burger';const p=product(id);if(!p){el.innerHTML='<div class="empty">Product not found.</div>';return}el.innerHTML=`<div class="product-layout"><img src="${p.image}" alt="${p.name}"><div class="product-info"><p class="eyebrow">${p.category}</p><h1>${p.name}</h1><p class="desc">${p.desc}</p><h2>${money(p.price)}</h2><form id="product-form">${p.options.map((o,i)=>`<div class="option-group"><h4>${o.name}</h4>${o.choices.map((c,j)=>`<label><input type="radio" name="option${i}" value="${c[0]}" data-price="${c[2]}" ${j===0?'checked':''}> ${c[1]} ${c[2]?'— '+money(c[2]):''}</label>`).join('')}</div>`).join('')}<div class="qty"><label for="qty">Quantity</label><input id="qty" type="number" min="1" value="1"></div><button class="btn wide" type="submit">Add to cart</button></form></div></div>`;document.getElementById('product-form').onsubmit=e=>{e.preventDefault();const opts={};let extra=0;p.options.forEach((o,i)=>{const x=document.querySelector(`input[name=option${i}]:checked`);if(x){opts[o.name]=x.value;extra+=Number(x.dataset.price)}});addItem({id:p.id,name:p.name,base:p.price,unit:p.price+extra,qty:Math.max(1,Number(document.getElementById('qty').value)||1),options:opts,image:p.image})}}
function renderCart(){const el=document.getElementById('cart-view');if(!el)return;const c=getCart();if(!c.length){el.innerHTML='<div class="empty"><h2>Your cart is empty.</h2><p>Add products from the menu or directly from the homepage.</p><a class="btn" href="menu.html">Browse menu</a></div>';return}const total=c.reduce((s,i)=>s+i.unit*i.qty,0);el.innerHTML=`<div class="cart-layout"><section><p class="eyebrow">YOUR ORDER</p><h1>Cart</h1>${c.map((i,n)=>`<article class="cart-item"><img src="${i.image}" alt=""><div class="cart-item-main"><h3>${i.name}</h3><p>${Object.entries(i.options||{}).map(x=>x[0]+': '+x[1]).join(' • ')||'Standard item'}</p><strong>${money(i.unit*i.qty)}</strong><div class="cart-controls"><button onclick="changeQty(${n},-1)">−</button><span>${i.qty}</span><button onclick="changeQty(${n},1)">+</button><button class="remove" onclick="removeItem(${n})">Remove</button></div></div></article>`).join('')}</section><aside class="panel cart-summary"><h2>Summary</h2><div class="summary-row"><span>Items</span><strong>${c.reduce((s,i)=>s+i.qty,0)}</strong></div><div class="summary-row total"><span>Total</span><strong>${money(total)}</strong></div><a class="btn wide" href="checkout.html">Continue to checkout</a><a class="text-link" href="menu.html">← Add more products</a></aside></div>`}
function renderCheckout(){const el=document.getElementById('checkout-view');if(!el)return;const c=getCart();if(!c.length){el.innerHTML='<div class="empty"><h2>Your cart is empty.</h2><a class="btn" href="menu.html">Browse menu</a></div>';return}const subtotal=c.reduce((s,i)=>s+i.unit*i.qty,0);el.innerHTML=`<div class="checkout-layout"><section><p class="eyebrow">CHECKOUT</p><h1>Complete your order.</h1><div class="panel"><h2>Your items</h2>${c.map(i=>`<div class="summary-row"><span>${i.qty} × ${i.name}<small style="display:block">${Object.entries(i.options||{}).map(x=>x[0]+': '+x[1]).join(' • ')}</small></span><strong>${money(i.unit*i.qty)}</strong></div>`).join('')}<div class="summary-row total"><span>Total</span><span>${money(subtotal)}</span></div></div></section><section class="panel"><h2>Customer details</h2><form id="checkout-form"><div class="field"><label>Name</label><input id="customer" required placeholder="Your name"></div><div class="field"><label>Phone</label><input id="phone" required placeholder="07xx xxx xxx"></div><div class="field"><label>Delivery / pickup note</label><input id="note" placeholder="e.g. Westlands, apartment 4B"></div><div class="option-group payment"><h4>Payment method</h4><label><input type="radio" name="payment" value="M-Pesa" checked> M-Pesa</label><label><input type="radio" name="payment" value="Card"> Card</label><label><input type="radio" name="payment" value="PayPal"> PayPal</label></div><button class="btn wide">Pay ${money(subtotal)} <small>(demo)</small></button></form></section></div>`;document.getElementById('checkout-form').onsubmit=e=>{e.preventDefault();const order={id:'SB-'+Date.now().toString().slice(-6),customer:document.getElementById('customer').value,phone:document.getElementById('phone').value,note:document.getElementById('note').value,payment:document.querySelector('input[name=payment]:checked').value,items:c,total:subtotal,status:'New',paymentStatus:'Demo paid',created:new Date().toISOString()};const orders=read('doe_orders',[]);orders.unshift(order);write('doe_orders',orders);write('doe_last_order',order.id);localStorage.removeItem('doe_cart');location.href='order.html?id='+order.id}}
function statusIndex(status){return ['New','Preparing','Ready','Completed'].indexOf(status)}
function renderOrder(){const el=document.getElementById('order-view');if(!el)return;const id=new URLSearchParams(location.search).get('id')||localStorage.getItem('doe_last_order');const o=read('doe_orders',[]).find(x=>x.id===id);if(!o){el.innerHTML='<div class="empty"><h2>Order not found.</h2><a class="btn" href="menu.html">Start an order</a></div>';return}const statuses=['New','Preparing','Ready','Completed'];el.innerHTML=`<div class="track-head"><p class="eyebrow">ORDER ${o.id}</p><h1>We have your order.</h1><p>Payment: <strong>${o.paymentStatus}</strong> · ${o.payment}</p></div><div class="panel tracking"><div class="timeline">${statuses.map((s,i)=>`<div class="timeline-step ${i<=statusIndex(o.status)?'active':''}"><span>${i+1}</span><strong>${s}</strong></div>`).join('')}</div><div class="order-details"><h2>Order summary</h2>${o.items.map(i=>`<div class="summary-row"><span>${i.qty} × ${i.name}<small style="display:block">${Object.entries(i.options||{}).map(x=>x[0]+': '+x[1]).join(' • ')}</small></span><strong>${money(i.unit*i.qty)}</strong></div>`).join('')}<div class="summary-row total"><span>Total</span><strong>${money(o.total)}</strong></div></div></div><p class="muted">Demo mode: the restaurant dashboard can change your order status, and refreshing this page will show the new status.</p>`}
function renderDashboard(){const el=document.getElementById('dashboard-view');if(!el)return;const orders=read('doe_orders',[]);const statuses=['New','Preparing','Ready','Completed'];el.innerHTML=`<div class="dashboard-head"><div><p class="eyebrow">SAVANNA BITES • RESTAURANT</p><h1>Incoming orders.</h1><p class="muted">Prototype business dashboard</p></div><a class="btn" href="menu.html">Customer menu</a></div><div class="orders">${orders.length?orders.map(o=>`<article class="order-card"><div><h3>${o.id} · ${o.customer}</h3><p>${o.phone} · ${o.payment} · ${o.paymentStatus}</p><p>${o.items.map(i=>`${i.qty}× ${i.name}`).join(', ')}</p><p>${o.note||'No delivery note'}</p></div><div><div class="order-status">${o.status}</div><strong>${money(o.total)}</strong><div class="status-actions">${statuses.map(s=>`<button class="${o.status===s?'selected':''}" onclick="setStatus('${o.id}','${s}')">${s}</button>`).join('')}</div><a class="text-link" href="order.html?id=${o.id}">Customer tracking →</a></div></article>`).join(''):'<div class="empty"><h2>No orders yet.</h2><p>Place a demo order from the customer side to see it arrive here.</p></div>'}</div>`}
function setStatus(id,status){const orders=read('doe_orders',[]);const o=orders.find(x=>x.id===id);if(o)o.status=status;write('doe_orders',orders);renderDashboard()}
document.addEventListener('click',e=>{const b=e.target.closest('[data-order-product]');if(b){e.preventDefault();location.href='product.html?id='+encodeURIComponent(b.dataset.orderProduct)}});
let restaurantMenuEvents=null;
function startRestaurantRealtime(){
  if(restaurantMenuEvents)return;
  const businessId=typeof BUSINESS_ID!=='undefined'?BUSINESS_ID:'11111111-1111-4111-8111-111111111111';
  const connect=()=>{
    restaurantMenuEvents=new EventSource('https://restaurant-ordering-api-ow3p.onrender.com/api/events?businessId='+encodeURIComponent(businessId));
    restaurantMenuEvents.addEventListener('menu.updated',()=>loadLiveRestaurantMenu());
    restaurantMenuEvents.addEventListener('promotion.updated',()=>loadLiveRestaurantMenu());
    restaurantMenuEvents.onerror=()=>{if(restaurantMenuEvents){restaurantMenuEvents.close();restaurantMenuEvents=null;}setTimeout(connect,3000);};
  };
  connect();
}
async function loadLiveRestaurantMenu(){
try{
const response=await fetch('https://restaurant-ordering-api-ow3p.onrender.com/api/menu/public?businessId='+encodeURIComponent(typeof BUSINESS_ID!=='undefined'?BUSINESS_ID:'11111111-1111-4111-8111-111111111111'));
if(!response.ok)return;const data=await response.json();
const products=(data.products||[]).map(p=>({id:p.id,name:p.name,category:p.category_name||p.category||'Menu',price:Number(p.price||0),image:p.image_url||'',desc:p.description||'',options:Array.isArray(p.options)?p.options:[]}));
if(products.length){renderSignatureMenu(products);}
const strip=document.getElementById('promotions-strip');if(strip){const promos=data.promotions||[];strip.innerHTML=promos.length?'<div class="promo-heading"><p class="eyebrow">RESTAURANT OFFERS</p><h2>Today\'s specials.</h2></div><div class="promo-list">'+promos.slice(0,6).map(p=>'<article><span>'+String(p.type||'OFFER').replaceAll('_',' ')+'</span><h3>'+p.name+'</h3><p>'+(p.banner_text||'Limited-time restaurant promotion')+'</p></article>').join('')+'</div>':'<div class="promo-heading"><p class="eyebrow">SAVANNA BITES</p><h2>Fresh from the kitchen.</h2></div>';}
const offer=(data.promotions||[])[0],hero=document.querySelector('.hero-card small');if(offer&&hero){hero.textContent=offer.banner_text||offer.name;const strong=hero.parentElement?.querySelector('strong');if(strong)strong.textContent=offer.name}
}catch{}
}
updateCount();renderMenu();renderProduct();renderCart();renderCheckout();renderOrder();renderDashboard();
loadLiveRestaurantMenu();
