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
let MENU_CATEGORY_STATE={categories:[],activeId:'all'};
let menuScrollHandler=null;
function menuCategorySlug(value,index=0){return 'menu-category-'+String(value||'category-'+index).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')+'-'+index;}
function normalizeMenuCategories(products,categories){
  const source=Array.isArray(categories)?categories:[];
  const ordered=[...source].sort((a,b)=>Number(a.sort_order??a.sortOrder??0)-Number(b.sort_order??b.sortOrder??0)||String(a.name||'').localeCompare(String(b.name||'')));
  const result=[],seen=new Set();
  ordered.forEach(c=>{const id=String(c.id);if(!seen.has(id)){seen.add(id);result.push({id,name:String(c.name||'Menu')});}});
  products.forEach(p=>{const name=String(p.category||'Menu').trim()||'Menu';const pid=p.category_id?String(p.category_id):'';const exists=pid&&result.some(c=>c.id===pid);const byName=result.find(c=>c.name.toLowerCase()===name.toLowerCase());if(!exists&&!byName)result.push({id:pid||'name:'+name.toLowerCase(),name});});
  return result;
}
function setActiveMenuCategory(id){
  MENU_CATEGORY_STATE.activeId=id||'all';
  document.querySelectorAll('[data-menu-category-nav]').forEach(b=>{const active=b.dataset.menuCategoryNav===MENU_CATEGORY_STATE.activeId;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'true':'false');if(active)b.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});});
}
function syncMenuCategoryFromScroll(){
  const grid=document.getElementById('menu-grid'),bar=document.getElementById('menu-category-bar');
  if(!grid||!bar)return;
  const sections=[...grid.querySelectorAll('[data-menu-category-section]')];
  if(!sections.length){setActiveMenuCategory('all');return;}
  const gridTop=grid.getBoundingClientRect().top+window.scrollY;
  if(window.scrollY<gridTop-160){setActiveMenuCategory('all');return;}
  const threshold=bar.getBoundingClientRect().bottom+34;
  let current=sections[0].dataset.menuCategorySection;
  sections.forEach(section=>{if(section.getBoundingClientRect().top<=threshold)current=section.dataset.menuCategorySection;});
  setActiveMenuCategory(current);
}
function bindMenuCategoryNavigation(){
  if(menuScrollHandler)window.removeEventListener('scroll',menuScrollHandler);
  menuScrollHandler=()=>{if(!window.__menuCategoryTick){window.__menuCategoryTick=requestAnimationFrame(()=>{window.__menuCategoryTick=0;syncMenuCategoryFromScroll();});}};
  window.addEventListener('scroll',menuScrollHandler,{passive:true});
  window.addEventListener('resize',syncMenuCategoryFromScroll,{passive:true});
  document.querySelectorAll('[data-menu-category-nav]').forEach(button=>button.addEventListener('click',()=>{
    const id=button.dataset.menuCategoryNav;
    if(id==='all'){document.getElementById('menu-grid')?.scrollIntoView({behavior:'smooth',block:'start'});setActiveMenuCategory('all');return;}
    const section=[...document.querySelectorAll('[data-menu-category-section]')].find(x=>x.dataset.menuCategorySection===id);
    if(section){section.scrollIntoView({behavior:'smooth',block:'start'});setActiveMenuCategory(id);}
  }));
  syncMenuCategoryFromScroll();
}
function renderSignatureMenu(products,categories=[]){
  const grid=document.getElementById('menu-grid');if(!grid)return;
  MENU_PRODUCTS.clear();products.forEach(p=>MENU_PRODUCTS.set(String(p.id),p));
  const categoryList=normalizeMenuCategories(products,categories);
  MENU_CATEGORY_STATE.categories=categoryList;
  const grouped=categoryList.map((category,index)=>({category,index,products:products.filter(p=>{
    const pid=p.category_id?String(p.category_id):'',name=String(p.category||'Menu').trim().toLowerCase();
    return (pid&&pid===category.id)||(!pid&&name===category.name.toLowerCase())||(category.id.startsWith('name:')&&name===category.name.toLowerCase());
  })})).filter(x=>x.products.length);
  const nav=document.getElementById('menu-category-nav');
  if(nav)nav.innerHTML='<button type="button" class="menu-category-pill active" data-menu-category-nav="all" aria-current="true">All</button>'+grouped.map(x=>'<button type="button" class="menu-category-pill" data-menu-category-nav="'+escapeMenuHtml(x.category.id)+'" aria-current="false">'+escapeMenuHtml(x.category.name)+'</button>').join('');
  grid.innerHTML=grouped.map(x=>{
    const sectionId=menuCategorySlug(x.category.id,x.index);
    return '<section class="menu-category-section" id="'+sectionId+'" data-menu-category-section="'+escapeMenuHtml(x.category.id)+'"><div class="menu-category-heading"><span class="eyebrow">MENU CATEGORY</span><h2>'+escapeMenuHtml(x.category.name)+'</h2></div><div class="menu-category-products">'+x.products.map(p=>{
      const id=escapeMenuHtml(p.id),name=escapeMenuHtml(p.name),category=escapeMenuHtml(p.category||x.category.name),desc=escapeMenuHtml(p.desc||''),image=escapeMenuHtml(p.image||'');
      const featured=p.featured?'<span class="signature-badge signature-featured"><span class="signature-star">★</span> FEATURED</span>':'';
      return '<article class="signature-menu-card"><div class="signature-menu-photo"><img src="'+image+'" alt="'+name+'" loading="lazy"><div class="signature-menu-image-top"><span class="signature-category-chip">'+category+'</span>'+featured+'</div></div><div class="signature-menu-body"><div class="signature-menu-copy"><h3>'+name+'</h3><p class="signature-description">'+desc+'</p><div class="signature-meta"><strong class="signature-price">'+money(p.price)+'</strong><span class="signature-available"><span class="signature-dot"></span> AVAILABLE</span></div></div><div class="signature-menu-actions"><button type="button" class="signature-add-btn" data-menu-add="'+id+'"><span class="signature-add-icon">+</span><span>'+(Array.isArray(p.options)&&p.options.length?'CHOOSE':'ADD')+'</span></button></div></div></article>';
    }).join('')+'</div></section>';
  }).join('')||'<div class="empty-state">No menu items are available right now.</div>';
  bindMenuCategoryNavigation();
}
function renderMenu(){renderSignatureMenu(PRODUCTS,[])}
function addMenuProduct(id){
  const p=MENU_PRODUCTS.get(String(id));
  if(!p)return;
  if(Array.isArray(p.options)&&p.options.length){
    location.href='product.html?id='+encodeURIComponent(p.id);
    return;
  }
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
function renderProductData(p){
  const el=document.getElementById('product-view');if(!el)return;
  if(!p){el.innerHTML='<div class="empty">Product not found.</div>';return}
  const e=escapeMenuHtml;
  const options=Array.isArray(p.options)?p.options:[];
  el.innerHTML=`<div class="product-layout"><img src="${e(p.image||'')}" alt="${e(p.name)}"><div class="product-info"><p class="eyebrow">${e(p.category||'Menu')}</p><h1>${e(p.name)}</h1><p class="desc">${e(p.desc||'')}</p><h2>${money(p.price)}</h2><form id="product-form">${options.map((o,i)=>`<div class="option-group"><h4>${e(o.name)}</h4>${(Array.isArray(o.choices)?o.choices:[]).map((ch,j)=>`<label><input type="radio" name="option${i}" value="${e(ch[0])}" data-price="${Number(ch[2])||0}" ${j===0?'checked':''}> ${e(ch[1])} ${Number(ch[2])? '— '+money(ch[2]):''}</label>`).join('')}</div>`).join('')}<div class="qty"><label for="qty">Quantity</label><input id="qty" type="number" min="1" value="1"></div><button class="btn wide" type="submit">Add to cart</button></form></div></div>`;
  document.getElementById('product-form').onsubmit=event=>{
    event.preventDefault();
    const opts={};let extra=0;
    options.forEach((o,i)=>{const x=document.querySelector(`input[name="option${i}"]:checked`);if(x){opts[o.name]=x.value;extra+=Number(x.dataset.price||0)}});
    addItem({id:p.id,name:p.name,base:Number(p.price||0),unit:Number(p.price||0)+extra,qty:Math.max(1,Number(document.getElementById('qty').value)||1),options:opts,image:p.image||''});
  };
}
async function renderProduct(){
  const el=document.getElementById('product-view');if(!el)return;
  const id=new URLSearchParams(location.search).get('id')||'burger';
  const local=product(id);
  if(local){renderProductData(local);return}
  try{
    const businessId=window.TENANT_BUSINESS_ID || (typeof BUSINESS_ID!=='undefined'?BUSINESS_ID:'11111111-1111-4111-8111-111111111111');
    const response=await fetch((window.PLATFORM_API_ORIGIN || 'https://restaurant-ordering-api-ow3p.onrender.com')+'/api/menu/public?businessId='+encodeURIComponent(businessId));
    if(!response.ok)throw new Error('Menu item could not be loaded');
    const data=await response.json();
    const remote=(data.products||[]).find(p=>String(p.id)===String(id));
    renderProductData(remote?{id:remote.id,name:remote.name,category:remote.category_name||remote.category||'Menu',price:Number(remote.price||0),image:remote.image_url||'',desc:remote.description||'',options:Array.isArray(remote.options)?remote.options:[]}:null);
  }catch{el.innerHTML='<div class="empty"><h2>Menu item unavailable.</h2><p>Please return to the menu and try again.</p><a class="btn" href="menu.html">Back to menu</a></div>'}
}
function renderCart(){
  const el=document.getElementById('cart-view');if(!el)return;
  const c=getCart();
  if(!c.length){el.innerHTML='<div class="cart-empty-premium"><div class="cart-empty-icon">🛒</div><p class="eyebrow">YOUR ORDER</p><h1>Your cart is waiting.</h1><p>Add something delicious from the menu and come back here when you are ready.</p><a class="cart-premium-btn" href="menu.html">Browse the menu <span>→</span></a></div>';return}
  const total=c.reduce((s,i)=>s+i.unit*i.qty,0);
  el.innerHTML=`<div class="cart-layout-premium">
    <section class="cart-items-panel">
      <div class="cart-section-head"><div><p class="eyebrow">YOUR ORDER</p><h1>Almost there!</h1><p class="cart-subtitle">Great food is just a few clicks away.</p></div><button class="clear-cart-btn" type="button" data-action="clearCart()"><span>⌫</span> Clear cart</button></div>
      <div class="cart-items-list">${c.map((i,n)=>`<article class="cart-item-premium">
        <img src="${escapeMenuHtml(i.image||'')}" alt="${escapeMenuHtml(i.name)}">
        <div class="cart-item-premium-main"><div><h3>${escapeMenuHtml(i.name)}</h3><p>${escapeMenuHtml(Object.entries(i.options||{}).map(x=>x[0]+': '+x[1]).join(' • ')||'Standard item')}</p><strong>${money(i.unit*i.qty)}</strong></div>
          <div class="cart-item-premium-actions"><div class="quantity-control"><button type="button" aria-label="Decrease quantity" data-action="changeQty(${n},-1)">−</button><span>${i.qty}</span><button type="button" aria-label="Increase quantity" data-action="changeQty(${n},1)">+</button></div><button class="remove-premium" type="button" data-action="removeItem(${n})">Remove</button></div>
        </div>
      </article>`).join('')}</div>
      <a class="back-menu-link" href="menu.html">← Add more products</a>
    </section>
    <aside class="cart-summary-premium">
      <div class="summary-top"><p class="eyebrow">ORDER SUMMARY</p><h2>Ready when you are.</h2></div>
      <div class="summary-row-premium"><span>Items</span><strong>${c.reduce((s,i)=>s+i.qty,0)}</strong></div>
      <div class="summary-row-premium"><span>Subtotal</span><strong>${money(total)}</strong></div>
      <div class="summary-total-premium"><span>Total</span><strong>${money(total)}</strong></div>
      <a class="cart-checkout-btn" href="checkout.html">Continue to checkout <span>→</span></a>
      <div class="promo-field"><span>◇</span><input aria-label="Promo code" placeholder="Have a promo code?"><button type="button">Apply</button></div>
      <div class="cart-assurances"><div><span>✓</span><strong>Secure<br>Checkout</strong></div><div><span>↗</span><strong>Freshly<br>Prepared</strong></div><div><span>✦</span><strong>Quality<br>Ingredients</strong></div></div>
    </aside>
  </div>`;
}
function clearCart(){localStorage.removeItem('doe_cart');updateCount();renderCart();}
function renderCartHero(specials){
  const hero=document.getElementById('cart-special-hero');if(!hero)return;
  const items=(Array.isArray(specials)?specials:[]).filter(x=>x&&x.image);
  if(!items.length)return;
  let index=0,timer=null;
  const paint=()=>{
    const item=items[index%items.length];
    const img=hero.querySelector('.cart-special-image');
    const name=hero.querySelector('[data-special-name]');
    const desc=hero.querySelector('[data-special-desc]');
    const dots=hero.querySelector('[data-special-dots]');
    if(img){img.classList.add('is-changing');setTimeout(()=>{img.onload=()=>img.classList.remove('is-changing');img.src=item.image;img.alt=item.name||'Today’s special';},140);}
    if(name)name.textContent=item.name||'Today’s Special';
    if(desc)desc.textContent=item.desc||'Freshly made. Unforgettable taste.';
    if(dots)dots.innerHTML=items.map((_,i)=>'<button type="button" aria-label="Show special '+(i+1)+'" class="'+(i===index?'active':'')+'" data-special-dot="'+i+'"></button>').join('');
  };
  hero.onclick=e=>{const b=e.target.closest('[data-special-dot]');if(!b)return;index=Number(b.dataset.specialDot)||0;paint();reset();};
  const reset=()=>{if(timer)clearInterval(timer);if(items.length>1)timer=setInterval(()=>{index=(index+1)%items.length;paint()},6000)};
  paint();reset();
}
async function loadCartSpecials(){
  const hero=document.getElementById('cart-special-hero');if(!hero)return;
  try{
    const businessId=window.TENANT_BUSINESS_ID || (typeof BUSINESS_ID!=='undefined'?BUSINESS_ID:'11111111-1111-4111-8111-111111111111');
    const response=await fetch((window.PLATFORM_API_ORIGIN || 'https://restaurant-ordering-api-ow3p.onrender.com')+'/api/menu/public?businessId='+encodeURIComponent(businessId),{headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error('Menu API unavailable');
    const data=await response.json();
    const products=Array.isArray(data.products)?data.products:[];
    const specials=products.filter(p=>{
      const category=String(p.category_name||p.category||'').toLowerCase();
      return Boolean(p.image_url&&(p.featured||p.is_featured||p.is_special||p.today_special||p.todaySpecial||/today.?s special|specials?/.test(category)));
    }).map(p=>({name:p.name,image:p.image_url,desc:p.description||'Freshly made. Unforgettable taste.'}));
    const fallback=products.filter(p=>p.image_url).slice(0,3).map(p=>({name:p.name,image:p.image_url,desc:p.description||'Freshly made. Unforgettable taste.'}));
    renderCartHero(specials.length?specials:fallback);
  }catch(error){
    console.warn('Today’s specials could not be loaded.',error);
    renderCartHero(PRODUCTS.slice(0,3).map(p=>({name:p.name,image:p.image,desc:p.desc||'Freshly made. Unforgettable taste.'})));
  }
}
function renderCheckout(){if(document.body?.dataset.page==='checkout')return;const el=document.getElementById('checkout-view');if(!el)return;const c=getCart();if(!c.length){el.innerHTML='<div class="empty"><h2>Your cart is empty.</h2><a class="btn" href="menu.html">Browse menu</a></div>';return}const subtotal=c.reduce((s,i)=>s+i.unit*i.qty,0);el.innerHTML=`<div class="checkout-layout"><section><p class="eyebrow">CHECKOUT</p><h1>Complete your order.</h1><div class="panel"><h2>Your items</h2>${c.map(i=>`<div class="summary-row"><span>${i.qty} × ${i.name}<small style="display:block">${Object.entries(i.options||{}).map(x=>x[0]+': '+x[1]).join(' • ')}</small></span><strong>${money(i.unit*i.qty)}</strong></div>`).join('')}<div class="summary-row total"><span>Total</span><span>${money(subtotal)}</span></div></div></section><section class="panel"><h2>Customer details</h2><form id="checkout-form"><div class="field"><label>Name</label><input id="customer" required placeholder="Your name"></div><div class="field"><label>Phone</label><input id="phone" required placeholder="07xx xxx xxx"></div><div class="field"><label>Delivery / pickup note</label><input id="note" placeholder="e.g. Westlands, apartment 4B"></div><div class="option-group payment"><h4>Payment method</h4><label><input type="radio" name="payment" value="M-Pesa" checked> M-Pesa</label><label><input type="radio" name="payment" value="Card"> Card</label><label><input type="radio" name="payment" value="PayPal"> PayPal</label></div><button class="btn wide">Pay ${money(subtotal)} <small>(demo)</small></button></form></section></div>`;document.getElementById('checkout-form').onsubmit=e=>{e.preventDefault();const order={id:'SB-'+Date.now().toString().slice(-6),customer:document.getElementById('customer').value,phone:document.getElementById('phone').value,note:document.getElementById('note').value,payment:document.querySelector('input[name=payment]:checked').value,items:c,total:subtotal,status:'New',paymentStatus:'Demo paid',created:new Date().toISOString()};const orders=read('doe_orders',[]);orders.unshift(order);write('doe_orders',orders);write('doe_last_order',order.id);localStorage.removeItem('doe_cart');location.href='order.html?id='+order.id}}
function statusIndex(status){return ['New','Preparing','Ready','Completed'].indexOf(status)}
function renderOrder(){const el=document.getElementById('order-view');if(!el)return;const id=new URLSearchParams(location.search).get('id')||localStorage.getItem('doe_last_order');const o=read('doe_orders',[]).find(x=>x.id===id);if(!o){el.innerHTML='<div class="empty"><h2>Order not found.</h2><a class="btn" href="menu.html">Start an order</a></div>';return}const statuses=['New','Preparing','Ready','Completed'];el.innerHTML=`<div class="track-head"><p class="eyebrow">ORDER ${o.id}</p><h1>We have your order.</h1><p>Payment: <strong>${o.paymentStatus}</strong> · ${o.payment}</p></div><div class="panel tracking"><div class="timeline">${statuses.map((s,i)=>`<div class="timeline-step ${i<=statusIndex(o.status)?'active':''}"><span>${i+1}</span><strong>${s}</strong></div>`).join('')}</div><div class="order-details"><h2>Order summary</h2>${o.items.map(i=>`<div class="summary-row"><span>${i.qty} × ${i.name}<small style="display:block">${Object.entries(i.options||{}).map(x=>x[0]+': '+x[1]).join(' • ')}</small></span><strong>${money(i.unit*i.qty)}</strong></div>`).join('')}<div class="summary-row total"><span>Total</span><strong>${money(o.total)}</strong></div></div></div><p class="muted">Demo mode: the restaurant dashboard can change your order status, and refreshing this page will show the new status.</p>`}
function renderDashboard(){const el=document.getElementById('dashboard-view');if(!el)return;const orders=read('doe_orders',[]);const statuses=['New','Preparing','Ready','Completed'];el.innerHTML=`<div class="dashboard-head"><div><p class="eyebrow">SAVANNA BITES • RESTAURANT</p><h1>Incoming orders.</h1><p class="muted">Prototype business dashboard</p></div><a class="btn" href="menu.html">Customer menu</a></div><div class="orders">${orders.length?orders.map(o=>`<article class="order-card"><div><h3>${o.id} · ${o.customer}</h3><p>${o.phone} · ${o.payment} · ${o.paymentStatus}</p><p>${o.items.map(i=>`${i.qty}× ${i.name}`).join(', ')}</p><p>${o.note||'No delivery note'}</p></div><div><div class="order-status">${o.status}</div><strong>${money(o.total)}</strong><div class="status-actions">${statuses.map(s=>`<button class="${o.status===s?'selected':''}" data-action="setStatus('${o.id}','${s}')">${s}</button>`).join('')}</div><a class="text-link" href="order.html?id=${o.id}">Customer tracking →</a></div></article>`).join(''):'<div class="empty"><h2>No orders yet.</h2><p>Place a demo order from the customer side to see it arrive here.</p></div>'}</div>`}
function setStatus(id,status){const orders=read('doe_orders',[]);const o=orders.find(x=>x.id===id);if(o)o.status=status;write('doe_orders',orders);renderDashboard()}
document.addEventListener('click',e=>{const b=e.target.closest('[data-order-product]');if(b){e.preventDefault();location.href='product.html?id='+encodeURIComponent(b.dataset.orderProduct)}});
async function loadLiveRestaurantMenu(){
try{
const response=await fetch((window.PLATFORM_API_ORIGIN || 'https://restaurant-ordering-api-ow3p.onrender.com')+'/api/menu/public?businessId='+encodeURIComponent(window.TENANT_BUSINESS_ID || (typeof BUSINESS_ID!=='undefined'?BUSINESS_ID:'11111111-1111-4111-8111-111111111111')), { headers: { Accept: 'application/json' } });
if(!response.ok)throw new Error('Menu API unavailable');
const data=await response.json();
const products=(data.products||[]).map(p=>({id:p.id,name:p.name,category:p.category_name||p.category||'Menu',category_id:p.category_id||null,price:Number(p.price||0),image:p.image_url||'',desc:p.description||'',options:Array.isArray(p.options)?p.options:[],featured:Boolean(p.featured)}));
if(products.length){renderSignatureMenu(products,data.categories||[]);}
const strip=document.getElementById('promotions-strip');if(strip){const promos=data.promotions||[];strip.innerHTML=promos.length?'<div class="promo-heading"><p class="eyebrow">WHAT’S ON</p><h2>Good things, right now.</h2></div><div class="promo-list">'+promos.slice(0,6).map(p=>'<article><span>'+escapeMenuHtml(String(p.type||'OFFER').replaceAll('_',' '))+'</span><h3>'+escapeMenuHtml(p.name||'Offer')+'</h3><p>'+escapeMenuHtml(p.banner_text||'Limited-time restaurant promotion')+'</p></article>').join('')+'</div>':'<div class="menu-service-note"><span><i class="live-dot"></i><strong>Made fresh to order</strong></span><span>Pick a category and start building your order.</span></div>';}
const offer=(data.promotions||[])[0],hero=document.querySelector('.hero-card small');if(offer&&hero){hero.textContent=offer.banner_text||offer.name;const strong=hero.parentElement?.querySelector('strong');if(strong)strong.textContent=offer.name}
}catch(error){
  // Never leave the customer with an unexplained blank menu when the API is down.
  // The local/demo catalog remains visible and the customer gets a clear status message.
  renderSignatureMenu(PRODUCTS);
  const strip=document.getElementById('promotions-strip');
  if(strip){
    strip.innerHTML='<div class="menu-service-note" aria-label="Menu temporarily unavailable"><span><i class="live-dot"></i><strong>Menu is loading</strong></span><span>Please try again in a moment — your menu will refresh automatically.</span></div>';
  }
}
}
updateCount();renderMenu();renderProduct();renderCart();renderCheckout();renderOrder();renderDashboard();
loadLiveRestaurantMenu();
loadCartSpecials();
