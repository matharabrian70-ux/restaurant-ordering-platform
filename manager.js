const root=document.getElementById('manager-view'),B=BUSINESS_ID;
window.__cspSetState=(name,value)=>{if(name==='T')T=value;else if(name==='orderFilter')orderFilter=value;else if(name==='orderSearch')orderSearch=value;};let D={},T='overview',photoData='',heroPhotoData='',selectedRiders={},currentManager=null,orderFilter='NEW',orderSearch='',managerEvents=null,alertedOrders=new Map(),riderInviteResult='';
const managerFeature=(key)=>Boolean(D.features?.[key]);
const ALERT_KEY='savanna_manager_alerts';
const ALERT_SOUNDS={classic:'Classic Ding',double:'Double Bell',chime:'Professional Chime',priority:'Priority Ping',service:'Service Bell'};
function alertPrefs(){try{const p=JSON.parse(localStorage.getItem(ALERT_KEY)||'{}');return {enabled:p.enabled!==false,sound:ALERT_SOUNDS[p.sound]?p.sound:'classic',volume:Number.isFinite(Number(p.volume))?Math.max(0,Math.min(1,Number(p.volume))):.85}}catch{return {enabled:true,sound:'classic',volume:.85}}}
function saveAlertPrefs(p){localStorage.setItem(ALERT_KEY,JSON.stringify(p));}
let alertAudioContext=null;
function primeAlertAudio(){try{alertAudioContext=alertAudioContext||new (window.AudioContext||window.webkitAudioContext)();if(alertAudioContext.state==='suspended')alertAudioContext.resume();}catch{}}
function tone(ctx,gain,oscType,freq,start,duration,slide=0){const o=ctx.createOscillator(),g=ctx.createGain();o.type=oscType;o.frequency.setValueAtTime(freq,start);if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(40,freq+slide),start+duration);g.gain.setValueAtTime(.0001,start);g.gain.exponentialRampToValueAtTime(gain,start+.012);g.gain.exponentialRampToValueAtTime(.0001,start+duration);o.connect(g).connect(ctx.destination);o.start(start);o.stop(start+duration+.02)}
function playOrderAlert(force=false){const p=alertPrefs();if(!force&&!p.enabled)return;try{primeAlertAudio();const ctx=alertAudioContext;if(!ctx)return;const now=ctx.currentTime+.01,v=.22*p.volume;const s=p.sound;if(s==='classic'){tone(ctx,v,'sine',880,now,.16,90);tone(ctx,v*.75,'sine',1175,now+.12,.22,70)}else if(s==='double'){tone(ctx,v,'sine',740,now,.14,50);tone(ctx,v,'sine',740,now+.18,.14,50);tone(ctx,v*.8,'sine',1047,now+.36,.22,80)}else if(s==='chime'){tone(ctx,v*.8,'sine',659,now,.18,40);tone(ctx,v,'sine',784,now+.12,.24,40);tone(ctx,v*.8,'sine',988,now+.28,.34,60)}else if(s==='priority'){tone(ctx,v,'triangle',988,now,.12,120);tone(ctx,v,'triangle',1319,now+.11,.16,100);tone(ctx,v*.8,'sine',1568,now+.24,.25,80)}else{tone(ctx,v,'sine',587,now,.16,30);tone(ctx,v,'sine',784,now+.12,.2,50);tone(ctx,v*.75,'sine',988,now+.27,.32,40)}}catch{}}
function startManagerRealtime(){
  if(managerEvents||!currentManager)return;
  const connect=async()=>{
    if(!currentManager)return;
    try{
      const tokenData=await api('/api/realtime-token',{method:'POST',body:JSON.stringify({scope:'MANAGER'})});
      if(!tokenData?.token)throw new Error('Realtime token unavailable');
      managerEvents=new EventSource(API_BASE_URL+'/api/events?realtimeToken='+encodeURIComponent(tokenData.token));
    const refresh=()=>{clearTimeout(window.managerRealtimeRetry);(Promise.resolve()).then(()=>load());};
    managerEvents.addEventListener('order.updated',e=>{try{const d=JSON.parse(e.data||'{}');if(d.status==='NEW'&&d.paymentStatus==='PAID'){const key=String(d.orderId||'');if(!alertedOrders.has(key)){alertedOrders.set(key,Date.now());playOrderAlert();setTimeout(()=>alertedOrders.delete(key),15000)}}refresh();}catch{}});
    if(managerFeature('riderModule')) managerEvents.addEventListener('rider.updated',()=>syncRiderListInPlace());
    ['delivery.updated','refund.updated','payment.updated','station.updated','menu.updated','promotion.updated','branch.updated'].forEach(name=>managerEvents.addEventListener(name,refresh));
    managerEvents.onerror=()=>{if(managerEvents){managerEvents.close();managerEvents=null;}window.managerRealtimeRetry=setTimeout(connect,3000);};
    }catch(e){
      managerEvents=null;
      window.managerRealtimeRetry=setTimeout(connect,3000);
    }
  };
  connect();
}
function updateAlertSetting(key,value){const p=alertPrefs();p[key]=value;saveAlertPrefs(p);render();primeAlertAudio();}
function alertsPanel(){const p=alertPrefs();return '<section class="manager-panel alert-settings-panel"><div class="panel-title"><div><span class="eyebrow">ORDER ALERTS</span><h2>Notification sound</h2><p>New paid orders can announce themselves automatically while this manager page is open.</p></div><span class="alert-status '+(p.enabled?'on':'off')+'"><i></i>'+(p.enabled?'ALERTS ON':'ALERTS OFF')+'</span></div><div class="alert-settings-grid"><label class="alert-toggle"><span><b>Automatic alerts</b><small>Play a sound when a new paid order arrives.</small></span><input type="checkbox" '+(p.enabled?'checked':'')+' data-change="updateAlertSetting(\'enabled\',this.checked)"></label><label><span>Notification sound</span><select data-change="updateAlertSetting(\'sound\',this.value)">'+Object.entries(ALERT_SOUNDS).map(([k,v])=>'<option value="'+k+'" '+(p.sound===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label><label><span>Alert volume</span><input type="range" min="0" max="100" value="'+Math.round(p.volume*100)+'" data-input="document.getElementById(\'alert-volume-value\').textContent=this.value+\'%\'" data-change="updateAlertSetting(\'volume\',Number(this.value)/100)"><b id="alert-volume-value">'+Math.round(p.volume*100)+'%</b></label><button type="button" class="btn secondary" data-action="primeAlertAudio();playOrderAlert(true)">TEST SOUND</button></div><p class="alert-browser-note">The alert preference is on by default. Your browser may require one tap/click on the page before it permits audible Web Audio.</p></section>';
}
const money=v=>new Intl.NumberFormat('en-KE',{style:'currency',currency:'KES'}).format(Number(v||0));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=(p,o={})=>apiRequest(p,o);
const NAV_ITEMS=[['overview','⌂','Overview'],['orders','▤','Orders'],['dispatch','⇄','Dispatch','riderModule'],['menu','☷','Menu'],['promotions','%','Promotions'],['branches','⌖','Branches','branchRouting'],['delivery','⌁','Delivery'],['riders','♟','Riders','riderModule'],['receipts','▥','Receipts'],['payments','¤','Payments'],['refunds','↩','Refunds'],['sms','✉','SMS','sms'],['privacy','⚖','Privacy & compliance'],['station','▣','Order station'],['phase-g','◈','Advanced Operations','advancedDelivery'],['phase-h','✦','Intelligence','advancedAnalytics']];
const visibleNavItems=()=>NAV_ITEMS.filter(x=>!x[3]||managerFeature(x[3]));
const nav=(k,l)=>'<button class="manager-tab '+(T===k?'active':'')+'" data-action="T=\''+k+'\';'+(k==='privacy'?'loadPrivacySettings().then(()=>render())':'render()')+'" aria-current="'+(T===k?'page':'false')+'"><span class="manager-tab-icon" aria-hidden="true">'+(NAV_ITEMS.find(x=>x[0]===k)?.[1]||'•')+'</span><span>'+l+'</span></button>';
const managerSidebar=()=>'<aside class="manager-sidebar" aria-label="Manager sections"><div class="manager-sidebar-label">RESTAURANT CONTROL</div><nav class="manager-sidebar-nav">'+visibleNavItems().map(x=>nav(x[0],x[2])).join('')+'</nav><div class="manager-sidebar-footer"><span>LIVE CONTROL CENTRE</span><small>Restaurant operations</small></div></aside>';
const managerMobileSections=()=>'<details class="manager-mobile-sections"><summary><span>☰</span> Manager sections</summary><div class="manager-mobile-section-list">'+visibleNavItems().map(x=>nav(x[0],x[2])).join('')+'</div></details>';
async function load(){
  if(!getManagerToken()) return showLogin();
  try{ currentManager=await api('/api/manager/me'); }catch(e){ return showLogin(); }
  root.innerHTML='<div class="manager-loading"><div class="manager-spinner"></div><h2>Loading control centre…</h2></div>';
  try{
    const featureState=await api('/api/features?businessId='+encodeURIComponent(B));
    const riderEnabled=Boolean(featureState?.features?.riderModule);
    const x=await Promise.all([
      api('/api/orders?businessId='+B),
      riderEnabled?api('/api/riders?businessId='+B):Promise.resolve([]),
      api('/api/menu?businessId='+B),
      api('/api/businesses/'+B+'/branches'),
      api('/api/businesses/'+B+'/delivery-pricing'),
      api('/api/manager/delivery-zones'),
      api('/api/stations?businessId='+B),
      api('/api/businesses/'+B+'/branding'),
      api('/api/manager/receipt-settings'),
      riderEnabled?api('/api/manager/dispatch').catch(()=>({riderConnected:false,riders:[],unassigned:[],active:[],summary:{}})):Promise.resolve({riderConnected:false,riders:[],unassigned:[],active:[],summary:{}}),
      api('/api/manager/refunds'),
      api('/api/manager/payments')
    ]);
    D={features:featureState.features||{},orders:x[0],riders:x[1],menu:x[2],branches:x[3],pricing:x[4],deliveryZones:x[5]||[],stations:x[6]||[],branding:x[7]?.branding||{},receiptConfig:x[8]?.config||{},dispatch:x[9]||{},refunds:x[10]||[],payments:x[11]||[],smsConfig:{}};
    try{D.menu.coupons=await api('/api/menu/coupons?businessId='+encodeURIComponent(B));}catch{D.menu.coupons=[];}
    render();
    startManagerRealtime();
    startManagerLiveFallback();
    loadSmsSettings().then(()=>{if(T==='sms')render();});
  }catch(e){
    root.innerHTML='<section class="manager-error"><h2>Manager system unavailable</h2><p>'+esc(e.message)+'</p><button class="btn" data-action="load()">TRY AGAIN</button></section>';
  }
}
function showLogin(message=''){
  root.innerHTML='<section class="manager-login"><div class="manager-login-card"><span class="manager-kicker"><i></i> '+esc(window.TENANT_THEME?.name||'RESTAURANT')+'</span><h1>Manager sign in</h1><p>Use your restaurant manager account. Order-control devices use QR pairing and do not sign in here.</p>'+(message?'<div class="login-error">'+esc(message)+'</div>':'')+'<form id="manager-login-form"><label>Email<input id="manager-email" type="email" autocomplete="username" required></label><label>Password<div class="password-field"><input id="manager-password" type="password" autocomplete="current-password" required><button type="button" class="password-toggle" data-action="toggleManagerPassword()" aria-label="Show password">SHOW</button></div></label><button class="btn wide">SIGN IN</button></form><div class="login-divider"><span>OR</span></div><div class="google-login" id="manager-google-btn" aria-label="Continue with Google"></div><p class="google-note">Google will ask which account you want to use before continuing.</p></div></section>';
  bindManagerLoginForm();
  googleManagerLogin();
}
async function toggleManagerPassword(){
  const input=document.getElementById('manager-password');
  const button=document.querySelector('.password-toggle');
  if(!input||!button)return;
  input.type=input.type==='password'?'text':'password';
  button.textContent=input.type==='password'?'SHOW':'HIDE';
  button.setAttribute('aria-label',input.type==='password'?'Show password':'Hide password');
}
let googleManagerInitialized=false;
async function loadGoogleIdentity(){
  if(window.google?.accounts?.id)return;
  await new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-google-identity]');
    if(existing){
      existing.addEventListener('load',resolve,{once:true});
      existing.addEventListener('error',()=>reject(new Error('Google sign-in could not load.')),{once:true});
      return;
    }
    const script=document.createElement('script');
    script.src='https://accounts.google.com/gsi/client';
    script.async=true;
    script.defer=true;
    script.dataset.googleIdentity='true';
    script.onload=resolve;
    script.onerror=()=>reject(new Error('Google sign-in could not load.'));
    document.head.appendChild(script);
  });
}
async function googleManagerLogin(){
  const container=document.getElementById('manager-google-btn');
  if(!container)return;
  try{
    container.setAttribute('aria-busy','true');
    const cfg=await api('/api/manager/google/config');
    if(!cfg.clientId) throw new Error('Google sign-in is not configured on the server yet.');
    await loadGoogleIdentity();
    if(!googleManagerInitialized){
      google.accounts.id.initialize({
        client_id:cfg.clientId,
        callback:async response=>{
          try{
            const data=await api('/api/manager/google',{method:'POST',body:JSON.stringify({businessId:B,credential:response.credential})});
            setManagerToken(data.token);
            await (Promise.resolve()).then(()=>load());
          }catch(e){
            const note=document.querySelector('.google-note');
            if(note)note.textContent=e.message;
          }
        }
      });
      googleManagerInitialized=true;
    }
    container.innerHTML='';
    google.accounts.id.renderButton(container,{
      type:'standard',
      theme:'outline',
      size:'large',
      text:'continue_with',
      shape:'rectangular',
      width:380,
      logo_alignment:'center'
    });
    container.setAttribute('aria-busy','false');
  }catch(e){
    container.setAttribute('aria-busy','false');
    const note=document.querySelector('.google-note');
    if(note)note.textContent=e.message;
  }
}
function bindManagerLoginForm(){
  const form=document.getElementById('manager-login-form');
  if(!form||form.dataset.bound)return;
  form.dataset.bound='1';
  form.addEventListener('submit',loginManager);
}
async function loginManager(e){
  e.preventDefault();const b=e.submitter;b.disabled=true;b.textContent='SIGNING IN…';
  try{await managerLogin(document.getElementById('manager-email').value.trim(),document.getElementById('manager-password').value);await (Promise.resolve()).then(()=>load());}
  catch(x){b.disabled=false;b.textContent='SIGN IN';showLogin(x.message);}
}
async function logoutManager(){
  try{await api('/api/manager/logout',{method:'POST'});}catch{}
  managerLogoutLocal();currentManager=null;showLogin('You have been signed out.');
}

async function loadPrivacySettings(){
  try{const [privacyConfig,privacyRequests]=await Promise.all([api('/api/manager/privacy'),api('/api/manager/privacy/requests')]);D.privacyConfig=privacyConfig;D.privacyRequests=privacyRequests||[];}catch(e){D.privacyConfig=null;D.privacyRequests=[];}
}
async function savePrivacySettings(){
  const cfg={controllerLegalName:document.getElementById('privacy-controller-name').value,controllerAddress:document.getElementById('privacy-controller-address').value,privacyContact:document.getElementById('privacy-contact').value,dpoContact:document.getElementById('privacy-dpo').value,supportEmail:document.getElementById('privacy-support-email').value,supportPhone:document.getElementById('privacy-support-phone').value,complaintsEmail:document.getElementById('privacy-complaints-email').value,contractingPartyNotice:document.getElementById('privacy-contracting-party').value,marketingEnabled:document.getElementById('privacy-marketing').checked,retentionCustomerDays:Number(document.getElementById('privacy-customer-retention').value),retentionOrderDays:Number(document.getElementById('privacy-order-retention').value),liveGpsRetentionHours:Number(document.getElementById('privacy-gps-retention').value),odpcControllerStatus:document.getElementById('privacy-odpc-controller').value,odpcProcessorStatus:document.getElementById('privacy-odpc-processor').value,odpcControllerCertificate:document.getElementById('privacy-odpc-controller-cert').value,odpcProcessorCertificate:document.getElementById('privacy-odpc-processor-cert').value};try{D.privacyConfig=await api('/api/manager/privacy',{method:'PUT',body:JSON.stringify(cfg)});alert('Privacy settings saved');T='privacy';render();}catch(e){alert(e.message||'Could not save privacy settings')}}
async function loadSmsSettings(){
  try{
    const [settings,log]=await Promise.all([api('/api/manager/sms-settings'),api('/api/manager/sms-log')]);
    D.smsConfig=settings;
    D.smsLog=Array.isArray(log)?log:[];
  }catch(e){
    D.smsConfig={error:e.message};
    D.smsLog=[];
  }
}

async function loadPhase4Ops(){
  try{D.dispatch=await api('/api/manager/dispatch')}catch(e){D.dispatch={error:e.message,riders:[],unassigned:[],active:[],summary:{}}}
  try{D.refunds=await api('/api/manager/refunds')}catch(e){D.refunds=[]}
}
async function dispatchAssign(orderId,button){
  const select=document.getElementById('dispatch-rider-'+orderId);
  const riderId=select?.value||'';
  if(!riderId)return alert('Choose an available rider first.');
  button.disabled=true;button.textContent='ASSIGNING…';
  try{await api('/api/orders/'+encodeURIComponent(orderId)+'/assign-rider',{method:'POST',body:JSON.stringify({riderId})});await load();}
  catch(e){button.disabled=false;button.textContent='ASSIGN RIDER';alert(e.message||'Unable to assign rider.');}
}
function dispatchRiderOptions(order){
  const riders=(D.dispatch?.riders||[]).filter(r=>r.available);
  const sorted=[...riders].sort((a,b)=>{
    const da=riderDistanceMeters(a,order),db=riderDistanceMeters(b,order);
    if(da!==db)return da-db;
    return String(a.name||'').localeCompare(String(b.name||''));
  });
  return sorted.length?'<option value="">SELECT AVAILABLE RIDER</option>'+sorted.map((r,i)=>{
    const d=riderDistanceLabel(r,order);
    return '<option value="'+esc(r.id)+'">'+(i===0?'★ ':'')+esc(r.name)+' · '+esc(r.vehicle_type||'Vehicle')+(r.number_plate?' · '+esc(r.number_plate):'')+' · '+esc(d)+'</option>';
  }).join(''):'<option value="">NO RIDERS AVAILABLE</option>';
}
function dispatch(){
  if(!managerFeature('riderModule')) return '<section class="manager-panel"><div class="empty-state">Rider Dashboard is not included in this restaurant package.</div></section>';
  const d=D.dispatch||{},s=d.summary||{},riders=d.riders||[],unassigned=d.unassigned||[],active=d.active||[];
  if(d.error)return '<section class="manager-panel"><div class="login-error">'+esc(d.error)+'</div><button class="btn" data-action="load()">TRY AGAIN</button></section>';
  const riderConnected=Boolean(d.riderConnected); unassigned.forEach(o=>detailRegister('order',o.id,o)); active.forEach(o=>detailRegister('order',o.id,o));
  const available=riders.filter(r=>r.available);
  const queueHtml=unassigned.length
    ? unassigned.map(o=>'<article class="dispatch-order-card" data-detail-type="order" data-detail-id="'+esc(o.id)+'"><div class="dispatch-order-main"><div><b>'+esc(o.order_number)+'</b><span>'+esc(o.customer_name||'Customer')+' · '+esc(o.customer_phone||'')+'</span><small>'+esc(o.delivery_address||'Delivery address unavailable')+(o.branch_name?' · '+esc(o.branch_name):'')+'</small></div><div class="dispatch-order-value"><strong>'+money(o.delivery_fee)+'</strong><small>delivery fee</small></div></div><div class="dispatch-order-actions"><select id="dispatch-rider-'+esc(o.id)+'">'+dispatchRiderOptions(o)+'</select><button class="btn btn-small" data-action="dispatchAssign(\''+o.id+'\',this)">ASSIGN RIDER</button></div></article>').join('')
    : '<div class="empty-state">No accepted orders are waiting for rider assignment.</div>';
  const activeHtml=active.length
    ? active.map(o=>'<article class="dispatch-active-card" data-detail-type="order" data-detail-id="'+esc(o.id)+'"><div class="dispatch-active-head"><div><b>'+esc(o.order_number)+'</b><span>'+esc(o.rider_name)+' · '+esc(o.vehicle_type||'Vehicle')+(o.number_plate?' · '+esc(o.number_plate):'')+'</span></div><span class="status-chip '+String(o.rider_event_status||o.delivery_status||'ASSIGNED').toLowerCase()+'">'+esc(o.rider_event_status||o.delivery_status||'ASSIGNED')+'</span></div><div class="dispatch-active-grid"><span><small>CUSTOMER</small><b>'+esc(o.customer_name||'Customer')+'</b></span><span><small>DESTINATION</small><b>'+esc(o.delivery_address||'—')+'</b></span><span><small>DISTANCE</small><b>'+((Number(o.route_distance_meters||0)/1000).toFixed(1))+' km</b></span><span><small>RIDER EARNING</small><b>'+money(o.rider_earning)+'</b></span></div><div class="dispatch-active-actions"><button class="btn btn-small secondary" data-action="openRiderProfile(\''+o.rider_id+'\')">RIDER PROFILE</button><button class="btn btn-small secondary" data-action="reassignOrder(\''+o.id+'\',this)">REASSIGN</button><button class="btn btn-small secondary" data-action="cancelRiderAssignment(\''+o.id+'\',this)">CANCEL ASSIGNMENT</button></div></article>').join('')
    : '<div class="empty-state">No active rider deliveries right now.</div>';
  const riderHtml=riders.length
    ? riders.map(r=>'<article class="dispatch-rider-card"><div class="dispatch-rider-avatar">'+(r.profile_image_url?'<img src="'+esc(r.profile_image_url)+'" alt="">':esc((r.name||'?')[0]))+'</div><div class="dispatch-rider-body"><div><b>'+esc(r.name)+'</b><span>'+esc(r.vehicle_type||'Vehicle')+(r.number_plate?' · '+esc(r.number_plate):'')+'</span></div><span class="dispatch-rider-state '+(r.available?'available':r.trip_id?'busy':r.online?'online':'offline')+'"><i></i>'+(r.available?'AVAILABLE':r.trip_id?'ON DELIVERY':r.online?'ONLINE':'OFFLINE')+'</span><small>'+(r.trip_id?(esc(r.order_number||'Active trip')+' · '+esc(r.delivery_event_status||r.delivery_status||'ASSIGNED')):(r.liveLocation?'GPS LIVE':'No recent GPS'))+'</small></div></article>').join('')
    : '<div class="empty-state">No riders are configured.</div>';
  return '<div class="dispatch-page">'+
    '<div class="dispatch-hero"><div><span class="manager-kicker"><i></i> RESTAURANT OPERATIONS OS</span><h2>Dispatch.</h2><p>One live control surface for riders, assignments, delivery progress and exceptions.</p></div><div class="dispatch-connection '+(riderConnected?'connected':'manual')+'"><i></i>'+(riderConnected?'RIDER DASHBOARD CONNECTED':'MANUAL / STATION DISPATCH')+'</div></div>'+
    '<div class="dispatch-summary"><article><span>AVAILABLE</span><strong>'+Number(s.available||0)+'</strong><small>Online and ready</small></article><article><span>BUSY</span><strong>'+Number(s.busy||0)+'</strong><small>Active deliveries</small></article><article class="'+(Number(s.unassigned||0)?'attention':'')+'"><span>WAITING</span><strong>'+Number(s.unassigned||0)+'</strong><small>Orders need a rider</small></article><article><span>LIVE GPS</span><strong>'+Number(s.liveLocations||0)+'</strong><small>Recent rider positions</small></article></div>'+
    '<section class="manager-panel dispatch-section"><div class="panel-title"><div><span class="eyebrow">DISPATCH QUEUE</span><h2>Orders waiting for a rider</h2><p>Paid orders already accepted by the restaurant but not currently assigned.</p></div><button class="btn btn-small secondary" data-action="load()">↻ REFRESH</button></div>'+queueHtml+'</section>'+
    '<section class="manager-panel dispatch-section"><div class="panel-title"><div><span class="eyebrow">ACTIVE DELIVERIES</span><h2>Live rider operations</h2><p>Assignment state, delivery progress and the latest rider location are shown here.</p></div></div>'+activeHtml+'</section>'+
    '<section class="manager-panel dispatch-section"><div class="panel-title"><div><span class="eyebrow">RIDER FLEET</span><h2>Availability</h2><p>Live status for every rider attached to this restaurant.</p></div></div><div class="dispatch-rider-grid">'+riderHtml+'</div></section>'+
  '</div>';
}
function payments(){
  const rows=D.payments||[];
  const paid=rows.filter(r=>String(r.status||'').toUpperCase()==='PAID');
  const pending=rows.filter(r=>['PENDING','PROCESSING'].includes(String(r.status||'').toUpperCase()));
  const refunded=rows.filter(r=>String(r.status||'').toUpperCase()==='REFUNDED');
  const total=paid.reduce((s,r)=>s+Number(r.amount||0),0);
  const statusChip=r=>'<span class="payment-status '+String(r.status||'').toLowerCase()+'">'+esc(r.status||'UNKNOWN')+'</span>';
  return '<section class="payments-page"><div class="panel-title"><div><span class="eyebrow">PAYMENTS CONTROL</span><h2>Payments.</h2><p>Restaurant-scoped payment ledger. Provider references and statuses are read from the payment system; verification never trusts the browser alone.</p></div><button class="btn btn-small secondary" data-action="load()">↻ REFRESH</button></div>'+
    '<div class="payment-summary"><article><span>CONFIRMED</span><strong>'+paid.length+'</strong><small>'+money(total)+'</small></article><article><span>AWAITING</span><strong>'+pending.length+'</strong><small>Pending / processing</small></article><article><span>REFUNDED</span><strong>'+refunded.length+'</strong><small>Provider-refunded payments</small></article><article><span>ALL TRANSACTIONS</span><strong>'+rows.length+'</strong><small>Latest 300</small></article></div>'+
    '<section class="manager-panel payment-ledger-panel"><div class="panel-title"><div><span class="eyebrow">TRANSACTION LEDGER</span><h3>Latest payment activity</h3></div></div>'+
    (rows.length?'<div class="payment-list">'+rows.map(r=>'<article class="payment-card"><div class="payment-main"><div><b>'+esc(r.order_number)+'</b><span>'+esc(r.customer_name||'Customer')+' · '+esc(r.payment_method||'Paystack')+'</span><small>'+esc(r.customer_phone||'')+' · '+new Date(r.created_at).toLocaleString('en-KE')+'</small></div><div class="payment-amount"><strong>'+money(r.amount)+'</strong>'+statusChip(r)+'</div></div><div class="payment-meta"><span>Provider <b>'+esc(r.provider||'PAYSTACK')+'</b></span><span>Reference <b>'+esc(r.provider_reference||'Not assigned')+'</b></span><span>Order <b>'+esc(r.order_status||'UNKNOWN')+'</b></span><span>Confirmed <b>'+esc(r.confirmed_at?new Date(r.confirmed_at).toLocaleString('en-KE'):'Not yet')+'</b></span></div><div class="payment-actions">'+(r.status!=='PAID'&&r.status!=='REFUNDED'&&r.provider_reference?'<button class="btn btn-small secondary" data-action="verifyManagerPayment(\''+r.id+'\',this)">VERIFY WITH PROVIDER</button>':'')+'</div></article>').join('')+'</div>':'<div class="empty-state">No payment transactions have been recorded yet.</div>')+
    '</section></section>';
}
async function verifyManagerPayment(id,button){
  const old=button.textContent;button.disabled=true;button.textContent='VERIFYING…';
  try{const result=await api('/api/manager/payments/'+encodeURIComponent(id)+'/verify',{method:'POST'});await load();if(result.status!=='success')alert('Provider status: '+String(result.status||'pending').toUpperCase());}
  catch(e){button.disabled=false;button.textContent=old;alert(e.message||'Unable to verify payment.');}
}
function privacyCompliance(){
 const c=D.privacyConfig||{},rows=D.privacyRequests||[];
 const v=(k,d='')=>esc(c[k]??d);
 return '<section class="manager-panel"><div class="panel-title"><div><span class="eyebrow">PRIVACY & COMPLIANCE</span><h2>Restaurant privacy controls.</h2><p>Configure the real legal contacts, retention settings and ODPC registration status used by the customer notices. Do not enter placeholder details for a commercial launch.</p></div></div>'+
 '<div class="form-grid"><label>Legal controller name<input id="privacy-controller-name" value="'+v('controller_legal_name')+'"></label><label>Privacy contact email<input id="privacy-contact" value="'+v('privacy_contact_email')+'"></label><label>DPO contact email<input id="privacy-dpo" value="'+v('dpo_contact_email')+'"></label><label>Legal address<input id="privacy-controller-address" value="'+v('controller_address')+'"></label><label>Support email<input id="privacy-support-email" value="'+v('support_email')+'"></label><label>Support phone<input id="privacy-support-phone" value="'+v('support_phone')+'"></label><label>Complaints email<input id="privacy-complaints-email" value="'+v('complaints_email')+'"></label><label>Contracting-party notice<textarea id="privacy-contracting-party" rows="3">'+v('contracting_party_notice')+'</textarea></label></div>'+
 '<div class="form-grid"><label>Customer-data retention (days)<input id="privacy-customer-retention" type="number" min="30" max="3650" value="'+Number(c.retention_customer_days||730)+'"></label><label>Order-data retention (days)<input id="privacy-order-retention" type="number" min="365" max="3650" value="'+Number(c.retention_order_days||2555)+'"></label><label>Live GPS retention (hours)<input id="privacy-gps-retention" type="number" min="1" max="168" value="'+Number(c.live_gps_retention_hours||24)+'"></label><label><input id="privacy-marketing" type="checkbox" '+(c.marketing_enabled!==false?'checked':'')+'> Marketing enabled for this restaurant</label></div>'+
 '<div class="form-grid"><label>ODPC controller status<select id="privacy-odpc-controller"><option>NOT_REVIEWED</option><option>IN_PROGRESS</option><option>REGISTERED</option><option>NOT_REQUIRED</option></select></label><label>ODPC processor status<select id="privacy-odpc-processor"><option>NOT_REVIEWED</option><option>IN_PROGRESS</option><option>REGISTERED</option><option>NOT_REQUIRED</option></select></label><label>Controller certificate/reference<input id="privacy-odpc-controller-cert" value="'+v('odpc_controller_certificate')+'"></label><label>Processor certificate/reference<input id="privacy-odpc-processor-cert" value="'+v('odpc_processor_certificate')+'"></label></div>'+
 '<button class="btn" data-action="savePrivacySettings()">SAVE PRIVACY SETTINGS</button></section>'+
 '<section class="manager-panel"><div class="panel-title"><div><span class="eyebrow">DATA RIGHTS</span><h2>Customer requests.</h2><p>Requests must be verified before completion or rejection. Use the customer export tool for verified access requests.</p></div><button class="btn btn-small secondary" data-action="loadPrivacySettings().then(()=>render())">REFRESH</button></div>'+
 (rows.length?rows.map(r=>'<article class="refund-card"><div><b>'+esc(r.request_type)+'</b><span>'+esc(r.requester_name||'Customer')+' · '+esc(r.requester_email||r.requester_phone||'No contact')+'</span><small>Due '+new Date(r.due_at).toLocaleDateString('en-KE')+' · '+esc(r.status)+'</small></div><div><button class="btn btn-small" data-action="completePrivacyRequest(\''+r.id+'\')">COMPLETE</button></div></article>').join(''):'<div class="empty-state">No data-rights requests.</div>')+'</section>';
}
async function completePrivacyRequest(id){const verificationNote=prompt('Record the identity-verification evidence and legal basis for completion/rejection:');if(!verificationNote)return;const responseNote=prompt('Response note for the customer:')||'';try{await api('/api/manager/privacy/requests/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:'COMPLETED',verificationNote,responseNote})});await loadPrivacySettings();render();}catch(e){alert(e.message||'Unable to complete request')}}

function refunds(){
  const rows=D.refunds||[];
  return '<section class="manager-panel refunds-page"><div class="panel-title"><div><span class="eyebrow">PAYMENTS CONTROL</span><h2>Refunds.</h2><p>Restaurant-scoped refund history from the payment system. Automatic refunds and their provider status appear here.</p></div><button class="btn btn-small secondary" data-action="load()">↻ REFRESH</button></div>'+
    (rows.length?'<div class="refund-list">'+rows.map(r=>'<article class="refund-card"><div><b>'+esc(r.order_number)+'</b><span>'+esc(r.customer_name||'Customer')+'</span><small>'+esc(r.provider||'PAYSTACK')+' · '+esc(r.transaction_reference||'No transaction reference')+'</small></div><div><strong>'+money(r.amount)+'</strong><span class="refund-status '+String(r.status||'').toLowerCase()+'">'+esc(r.status||'UNKNOWN')+'</span><small>'+new Date(r.created_at).toLocaleString('en-KE')+'</small></div></article>').join('')+'</div>':'<div class="empty-state">No refunds have been recorded for this restaurant.</div>')+
  '</section>';
}

function render(){const o=D.orders||[],m=D.menu||{products:[]},paid=o.filter(x=>x.payment_status==='PAID'&&x.status!=='CANCELLED'),rev=paid.reduce((s,x)=>s+Number(x.total||0),0),today=o.filter(x=>new Date(x.created_at).toDateString()===new Date().toDateString());let body=T==='overview'?overview():T==='orders'?orders():T==='dispatch'?dispatch():T==='menu'?menu():T==='promotions'?promos():T==='branches'?branches():T==='delivery'?delivery():T==='riders'?riders():T==='receipts'?receipts():T==='payments'?payments():T==='refunds'?refunds():T==='sms'?smsSettings():T==='privacy'?privacyCompliance():T==='phase-g'?'<div id="manager-phase-g-mount"></div>':T==='phase-h'?'<div id="manager-phase-h-mount"></div>':station();root.innerHTML='<section class="manager-shell"><header class="manager-header"><div><span class="manager-kicker"><i></i> RESTAURANT CONTROL CENTRE</span><h1>'+esc(window.TenantTheme?.name?.()||'Restaurant')+'.</h1><p>Professional restaurant controls from phone, tablet, laptop or desktop.</p></div></header>'+managerMobileSections()+'<div class="manager-layout">'+managerSidebar()+'<main class="manager-main">'+(T==='overview'?'<section class="manager-summary"><article><span>Today\'s orders</span><strong>'+today.length+'</strong></article><article><span>Revenue</span><strong>'+money(rev)+'</strong></article><article><span>Menu items</span><strong>'+m.products.length+'</strong></article><article><span>Riders available</span><strong>'+D.riders.filter(x=>x.available).length+'</strong></article></section>':'')+'<div class="manager-content">'+body+'</div></main></div></section>';if(T==='phase-g'&&typeof window.mountPhaseG==='function')window.mountPhaseG(document.getElementById('manager-phase-g-mount'));if(T==='phase-h'&&typeof window.mountPhaseH==='function')window.mountPhaseH(document.getElementById('manager-phase-h-mount'))}

async function saveSmsSettings(){
  const button=document.getElementById('sms-save-button');if(button)button.disabled=true;
  try{
    const senderId=document.getElementById('sms-sender-id')?.value.trim()||'';
    const assignmentTemplate=document.getElementById('sms-template')?.value.trim()||'';
    const enabled=Boolean(document.getElementById('sms-enabled')?.checked);
    D.smsConfig=await api('/api/manager/sms-settings',{method:'PUT',body:JSON.stringify({senderId,assignmentTemplate,enabled})});
    alert('SMS settings saved');
    render();
  }catch(e){alert(e.message)}finally{if(button)button.disabled=false}
}
async function sendSmsTest(){
  const phone=document.getElementById('sms-test-phone')?.value.trim()||'';
  const message=document.getElementById('sms-test-message')?.value.trim()||'';
  if(!phone)return alert('Enter a Kenyan phone number for the test');
  const button=document.getElementById('sms-test-button');if(button)button.disabled=true;
  try{
    const result=await api('/api/manager/sms-test',{method:'POST',body:JSON.stringify({phone,message})});
    if(String(result.environment||'').toLowerCase()==='sandbox'){
      alert('SMS accepted by Africa\'s Talking Sandbox. Check the Sandbox simulator/inbox. It will not arrive on the real phone. Message ID: '+(result.messageId||'n/a'));
    }else{
      alert('SMS accepted by Africa\'s Talking. Message ID: '+(result.messageId||'n/a'));
    }
  }catch(e){alert(e.message)}finally{if(button)button.disabled=false}
}
function smsSettings(){
  const s=D.smsConfig||{};
  const template=s.assignmentTemplate||'You have a new delivery assignment from {restaurant}. Order {order}. Open your Rider Dashboard to view and accept it.';
  const effective=s.effectiveSenderId||'Not configured';
  const environment=String(s.environment||'production').toUpperCase();
  const sandboxNote=environment==='SANDBOX'
    ? '<div class="sms-sandbox-note"><strong>PHASE 1 · SANDBOX TESTING</strong><span>Messages go to the Africa\'s Talking simulator, not a real phone. Sender IDs are intentionally not attached in Sandbox.</span></div>'
    : '';
  return '<section class="manager-panel sms-settings-panel"><div class="panel-title"><div><span class="eyebrow">SMS NOTIFICATIONS</span><h2>Rider assignment messages</h2><p>Configure how this restaurant’s riders are notified when they are assigned a delivery.</p></div><div class="sms-status-stack"><span class="sms-environment-badge">'+esc(environment)+'</span><span class="sms-effective-badge">'+esc(effective)+'</span></div></div>'+sandboxNote+
  '<div class="sms-settings-grid"><section><h3>Sender ID</h3><p class="sms-help">The restaurant override is used when it is set. Otherwise the platform Sender ID from Render is used. Only use a Sender ID that Africa\'s Talking has approved for this account.</p><label>Restaurant Sender ID<input id="sms-sender-id" maxlength="11" value="'+esc(s.senderId||'')+'" placeholder="Leave blank to use system default"></label><small>Maximum 11 characters, no spaces. The ID must already be registered with Africa\'s Talking.</small><div class="sms-system-default"><span>System default</span><strong>'+esc(s.systemSenderId||'Not configured')+'</strong></div></section>'+
  '<section><h3>Assignment message</h3><label class="sms-toggle"><input id="sms-enabled" type="checkbox" '+(s.enabled!==false?'checked':'')+'><span><b>Send SMS automatically</b><small>Send immediately after a rider is assigned.</small></span></label><label>Message template<textarea id="sms-template" maxlength="320">'+esc(template)+'</textarea></label><small>Variables: {restaurant}, {order}, {rider}, {dashboard}</small></section></div>'+
  '<div class="sms-settings-actions"><button id="sms-save-button" class="btn" data-action="saveSmsSettings()">SAVE SMS SETTINGS</button></div>'+
  '<div class="sms-test-box"><div><span class="eyebrow">TEST WITHOUT AN ORDER</span><h3>Send a test SMS</h3><p>Use this to test the provider without creating an order or calculating a Google route.</p></div><div class="sms-test-grid"><label>Test phone number<input id="sms-test-phone" inputmode="tel" placeholder="+2547XXXXXXXX"></label><label>Test message<textarea id="sms-test-message" maxlength="918" placeholder="Leave blank to use your saved assignment template with a demo order."></textarea></label><button id="sms-test-button" class="btn secondary" data-action="sendSmsTest()">SEND TEST SMS</button></div></div>'+
  smsLogPanel()+'</section>';
}
function smsLogPanel(){
  const rows=Array.isArray(D.smsLog)?D.smsLog:[];
  const statusClass=v=>String(v||'').toLowerCase();
  return '<div class="sms-log-box"><div class="panel-title"><div><span class="eyebrow">PHASE 2 · DELIVERY LOG</span><h3>Recent SMS activity</h3><p>Every test and rider-assignment message is recorded here for this restaurant.</p></div><button class="btn btn-small secondary" data-action="loadSmsSettings().then(()=>render())">REFRESH LOG</button></div>'+
    (rows.length?'<div class="sms-log-list">'+rows.map(x=>'<article class="sms-log-row"><div class="sms-log-main"><strong>'+esc(x.purpose||'SMS')+'</strong><span>'+esc(x.recipient||'')+(x.rider_name?' · '+esc(x.rider_name):'')+(x.order_number?' · '+esc(x.order_number):'')+'</span><small>'+esc(x.message||'')+'</small></div><div class="sms-log-meta"><b class="sms-log-status '+statusClass(x.status)+'">'+esc(x.status||'UNKNOWN')+'</b><span>'+esc(x.sender_id||'Platform default')+'</span><time>'+esc(new Date(x.created_at).toLocaleString())+'</time>'+(x.error_message?'<em>'+esc(x.error_message)+'</em>':'')+'</div></article>').join('')+'</div>':'<div class="empty-state">No SMS activity yet.</div>')+
    '</div>';
}
function overview(){const o=D.orders||[],n=o.filter(x=>x.status==='NEW'&&x.payment_status==='PAID').length,p=o.filter(x=>x.status==='ACCEPTED').length,d=o.filter(x=>x.status==='OUT_FOR_DELIVERY').length,c=o.filter(x=>x.status==='DELIVERED').length;return '<div class="manager-grid two"><section class="manager-panel"><div class="panel-title"><div><span class="eyebrow">ORDER FLOW</span><h2>Today\'s operation</h2></div><button class="btn btn-small" data-action="T=\'orders\';render()">OPEN ORDERS</button></div><div class="flow-grid"><button data-action="orderFilter=\'NEW\';T=\'orders\';render()"><b>'+n+'</b><span>New paid</span></button><button data-action="orderFilter=\'ACCEPTED\';T=\'orders\';render()"><b>'+p+'</b><span>Preparing</span></button><button data-action="orderFilter=\'OUT_FOR_DELIVERY\';T=\'orders\';render()"><b>'+d+'</b><span>Out for delivery</span></button></div></section><section class="manager-panel"><div class="panel-title"><div><span class="eyebrow">QUICK ACTIONS</span><h2>Restaurant controls</h2></div></div><div class="quick-grid"><button class="quick-action" data-action="T=\'menu\';render()">＋ Add menu item</button><button class="quick-action" data-action="T=\'promotions\';render()">＋ Create offer</button><button class="quick-action" data-action="T=\'riders\';render()">＋ Add rider</button><button class="quick-action" data-action="T=\'station\';render()">▣ Configure order station</button></div></section></div>'+alertsPanel()+'<section class="manager-panel"><div class="panel-title"><div><span class="eyebrow">LATEST ACTIVITY</span><h2>Recent orders</h2></div></div>'+rows(o.slice(0,8))+'</section>'}
function rows(a){if(!a.length)return '<div class="empty-state">No orders yet.</div>';return '<div class="order-table">'+a.map(function(o){detailRegister('order',o.id,o);return '<div class="order-row" data-detail-type="order" data-detail-id="'+esc(o.id)+'"><div><b>'+esc(o.order_number)+'</b><span>'+esc(o.name)+' · '+esc(o.phone)+'</span></div><div><span class="status-chip '+o.status.toLowerCase()+'">'+esc(o.status)+'</span><strong>'+money(o.total)+'</strong></div></div>';}).join('')+'</div>'}
function orders(){const o=D.orders||[],counts={NEW:o.filter(x=>x.status==='NEW'&&x.payment_status==='PAID').length,ACCEPTED:o.filter(x=>x.status==='ACCEPTED').length,OUT_FOR_DELIVERY:o.filter(x=>x.status==='OUT_FOR_DELIVERY').length,DELIVERED:o.filter(x=>x.status==='DELIVERED').length,CANCELLED:o.filter(x=>x.status==='CANCELLED').length};let list=o.filter(x=>{const match=orderFilter==='NEW'?(x.status==='NEW'&&x.payment_status==='PAID'):orderFilter==='ALL'?true:x.status===orderFilter;const q=orderSearch.trim().toLowerCase();return match&&(!q||[x.order_number,x.name,x.phone,x.email].some(v=>String(v||'').toLowerCase().includes(q)));}).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));const label=orderFilter==='NEW'?'New':orderFilter==='ACCEPTED'?'Preparing':orderFilter==='OUT_FOR_DELIVERY'?'Delivery':orderFilter==='DELIVERED'?'Completed':orderFilter==='CANCELLED'?'Cancelled':'All';return '<section class="orders-page"><div class="orders-hero"><div><span class="manager-kicker"><i></i> LIVE ORDER STATION</span><h2>Orders.</h2><p>Receive, confirm and move every restaurant order forward.</p></div><div class="orders-actions"><span class="alert-status '+(alertPrefs().enabled?'on':'off')+'"><i></i> '+(alertPrefs().enabled?'Alerts on':'Alerts off')+'</span><button class="btn secondary" data-action="primeAlertAudio();load()">↻ REFRESH</button></div></div><div class="orders-summary"><article class="accent"><span>NEW PAID ORDERS</span><strong>'+counts.NEW+'</strong><small>Need restaurant action</small></article><article><span>PREPARING</span><strong>'+counts.ACCEPTED+'</strong><small>Accepted orders</small></article><article><span>OUT FOR DELIVERY</span><strong>'+counts.OUT_FOR_DELIVERY+'</strong><small>Currently with riders</small></article><article><span>COMPLETED</span><strong>'+counts.DELIVERED+'</strong><small>Delivered orders</small></article></div><div class="orders-toolbar"><div class="order-filters">'+[['NEW','New'],['ACCEPTED','Preparing'],['OUT_FOR_DELIVERY','Delivery'],['DELIVERED','Completed'],['CANCELLED','Cancelled'],['ALL','All']].map(x=>'<button class="order-filter '+(orderFilter===x[0]?'active':'')+'" data-action="orderFilter=\''+x[0]+'\';render()">'+x[1]+' <b>'+ (x[0]==='ALL'?o.length:counts[x[0]]) +'</b></button>').join('')+'</div><div class="order-search"><input id="order-search-input" value="'+esc(orderSearch)+'" placeholder="Search order, customer or phone" onkeydown="if(event.key===\'Enter\'){orderSearch=this.value;render()}"><button class="btn" data-action="orderSearch=document.getElementById(\'order-search-input\').value;render()">SEARCH</button></div></div><div class="orders-status-strip"><span><i></i><b>System online</b> Real-time connection active</span><span><b>'+o.filter(x=>x.payment_status==='PAID').length+'</b> paid orders</span><span><b>'+o.filter(x=>x.payment_status!=='PAID').length+'</b> awaiting payment</span><span><b>'+D.riders.filter(x=>x.available).length+'</b> riders available</span><button data-action="T=\'riders\';render()">Manage rider operations →</button></div><div class="orders-list-heading"><div><span class="eyebrow">'+label.toUpperCase()+'</span><h3>'+list.length+' orders</h3></div><small>Live · synced automatically</small></div><div class="orders-list">'+(list.map(orderCard).join('')||'<div class="empty-state">No orders match this view.</div>')+'</div></section>'}
function riderDistanceMeters(r,order){
  const lat=Number(r.latitude),lng=Number(r.longitude);
  const blat=Number(order?.branch_latitude),blng=Number(order?.branch_longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||!Number.isFinite(blat)||!Number.isFinite(blng))return Infinity;
  const rad=Math.PI/180,R=6371000,dLat=(blat-lat)*rad,dLng=(blng-lng)*rad;
  const a=Math.sin(dLat/2)**2+Math.cos(lat*rad)*Math.cos(blat*rad)*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function sortRiders(a,orderId=null){
  const order=orderId?(D.orders||[]).find(o=>String(o.id)===String(orderId)):null;
  return [...a].sort((x,y)=>{
    if(Boolean(x.available)!==Boolean(y.available))return x.available?-1:1;
    const dx=riderDistanceMeters(x,order),dy=riderDistanceMeters(y,order);
    if(dx!==dy)return dx-dy;
    return String(x.name||'').localeCompare(String(y.name||''));
  });
}
function riderDistanceLabel(r,order){
  const d=riderDistanceMeters(r,order);
  return Number.isFinite(d)?(d/1000).toFixed(1)+' km away':'GPS unavailable';
}

function picker(id){
  const selected=selectedRiders[id]||'';
  const order=(D.orders||[]).find(o=>String(o.id)===String(id));
  return '<div class="rider-picker compact">'+sortRiders(D.riders,id).map((r,i)=>'<button type="button" class="rider-square compact '+(r.available?'is-available':'is-unavailable')+(selected===r.id?' selected':'')+'" '+(r.available?'data-action="selectRider(&quot;'+id+'&quot;,&quot;'+r.id+'&quot;)"':'disabled')+'><div class="rider-avatar">'+(r.profile_image_url?'<img src="'+esc(r.profile_image_url)+'" alt="">':esc((r.name||'?')[0]))+'</div><div class="rider-square-main"><b>'+esc(r.name)+'</b><span>'+esc(r.vehicle_type||'Vehicle')+'</span><small>'+esc(r.number_plate||'')+'</small><small class="rider-distance">'+esc(riderDistanceLabel(r,order))+'</small></div><div class="availability"><i></i>'+(r.available?'AVAILABLE':'UNAVAILABLE')+'</div>'+(r.available&&i===0?'<em>PRIORITY</em>':'')+'</button>').join('')+'</div><div class="assign-bar"><span>'+(selected?'Selected: '+esc(D.riders.find(r=>r.id===selected)?.name||'Rider'):'Tap a rider square to select')+'</span><button type="button" class="btn btn-small '+(selected?'':'disabled')+'" '+(selected?'data-action="assignSelected(&quot;'+id+'&quot;,this)"':'disabled')+'>ASSIGN RIDER</button></div>';
}
function selectRider(orderId,riderId){selectedRiders[orderId]=riderId;render();}
function activeAssignmentActions(o){
  const canChange=['ASSIGNED','ACCEPTED','ARRIVED_AT_RESTAURANT'].includes(String(o.rider_delivery_status||''));
  if(!o.rider_name)return '';
  return '<div class="dispatch-current"><span class="eyebrow">CURRENT RIDER</span><b>'+esc(o.rider_name)+'</b><small>'+esc(String(o.rider_delivery_status||'ASSIGNED').replaceAll('_',' '))+'</small></div>'+
    (canChange?'<div class="dispatch-actions"><button type="button" class="btn btn-small" data-action="reassignOrder(\''+o.id+'\',this)">REASSIGN</button><button type="button" class="btn btn-small secondary" data-action="cancelRiderAssignment(\''+o.id+'\',this)">CANCEL ASSIGNMENT</button></div>':'');
}
function orderCard(o){
  let a='';
  if(o.status==='NEW'&&o.payment_status==='PAID') a='<button class="btn" data-action="accept(\''+o.id+'\',this)">✓ ACCEPT ORDER</button>';
  else if(o.status==='ACCEPTED') a=o.rider_name?activeAssignmentActions(o):'<div class="dispatch-panel"><div class="dispatch-label">Available riders — longest wait since last delivery gets priority</div>'+picker(o.id)+'</div>';
  else if(o.status==='OUT_FOR_DELIVERY') a=activeAssignmentActions(o)+'<div class="completed-action"><i></i> DELIVERY IN PROGRESS</div>';
  else if(o.status==='DELIVERED') a='<div class="completed-action done">✓ COMPLETED</div>';
  else if(o.status==='CANCELLED') a='<div class="completed-action done">CANCELLED</div>';
  else a='<div class="waiting-action">Awaiting payment</div>';
  detailRegister('order',o.id,o); return '<article class="manager-order '+(o.status==='NEW'&&o.payment_status==='PAID'?'new':'')+'" data-detail-type="order" data-detail-id="'+esc(o.id)+'"><div class="manager-order-main"><div class="order-top"><div><b>'+esc(o.order_number)+'</b><span>'+new Date(o.created_at).toLocaleString('en-KE',{dateStyle:'medium',timeStyle:'short'})+'</span></div><span class="status-chip '+o.status.toLowerCase()+'">'+esc(o.status)+'</span></div>'+(o.payment_status==='PAID'?'<div class="payment-confirmed"><span>✓ PAYMENT CONFIRMED</span><span>'+esc(o.payment_method||'Paystack')+'</span></div>':'')+'<div class="customer-line"><div class="customer-avatar">'+esc((o.name||'?')[0])+'</div><div><b>'+esc(o.name)+'</b><span>'+esc(o.phone)+'</span></div></div>'+(o.delivery_note?'<div class="order-note"><b>Customer note</b><span>'+esc(o.delivery_note)+'</span></div>':'')+'</div><div class="manager-order-side"><span>ORDER TOTAL</span><strong>'+money(o.total)+'</strong><small>'+esc(o.payment_status)+' · '+esc(o.payment_method||'Paystack')+'</small>'+a+'</div></article>';
}
async function accept(id,b){b.disabled=true;b.classList.add('done');b.textContent='ACCEPTED';try{await api('/api/orders/'+id+'/status',{method:'POST',body:JSON.stringify({status:'ACCEPTED'})});await load()}catch(e){b.disabled=false;b.classList.remove('done');b.textContent='✓ ACCEPT ORDER';alert(e.message)}}
async function assignSelected(id,b){
  const riderId=selectedRiders[id];if(!riderId)return;
  b.disabled=true;b.classList.add('done');b.textContent='ASSIGNING…';
  try{await api('/api/orders/'+id+'/assign-rider',{method:'POST',body:JSON.stringify({riderId})});b.textContent='✓ ASSIGNED';delete selectedRiders[id];await (Promise.resolve()).then(()=>load());}
  catch(e){b.disabled=false;b.classList.remove('done');b.textContent='ASSIGN RIDER';alert(e.message);}
}
async function cancelRiderAssignment(id,b){
  if(!confirm('Cancel this rider assignment? The order will return to the reassignment stage.'))return;
  b.disabled=true;b.textContent='CANCELLING…';
  try{await api('/api/orders/'+id+'/cancel-rider-assignment',{method:'POST',body:JSON.stringify({})});await load();}
  catch(e){b.disabled=false;b.textContent='CANCEL ASSIGNMENT';alert(e.message);}
}
async function reassignOrder(id,b){
  const available=sortRiders(D.riders||[]).filter(r=>r.available);
  if(!available.length){alert('No other rider is currently available.');return;}
  const names=available.map((r,i)=>`${i+1}. ${r.name} — ${r.vehicle_type||'Vehicle'}`).join('\n');
  const choice=prompt('Enter the number of the rider to assign:\n\n'+names);
  const index=Number(choice)-1;
  const selected=available[index];
  if(!selected)return;
  b.disabled=true;b.textContent='REASSIGNING…';
  try{await api('/api/orders/'+id+'/reassign-rider',{method:'POST',body:JSON.stringify({riderId:selected.id})});await load();}
  catch(e){b.disabled=false;b.textContent='REASSIGN';alert(e.message);}
}
let newMenuVariables=[];
let variableDraftProductId=null;

function cleanMenuVariableName(value){return String(value??'').trim().slice(0,80)}
function cleanMenuVariableChoice(value){return String(value??'').trim().slice(0,120)}
function makeVariableKey(value){return String(value??'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||('choice-'+Date.now())}
function cloneMenuVariables(options){return Array.isArray(options)?JSON.parse(JSON.stringify(options)):[]}
function readVariableDraftInputs(fallback=[],targetId='new-variable-groups'){
  const root=document.getElementById(targetId);
  if(!root)return cloneMenuVariables(fallback);
  const groups=[...root.querySelectorAll('[data-variable-group]')];
  return groups.map(group=>{
    const nameInput=group.querySelector('[data-variable-field="name"]');
    const choices=[...group.querySelectorAll('.menu-variable-choice')].map(choice=>{
      const key=choice.querySelector('[data-variable-field="key"]')?.value||'';
      const label=choice.querySelector('[data-variable-field="label"]')?.value||'';
      const price=Number(choice.querySelector('[data-variable-field="price"]')?.value||0);
      return [key,label,Number.isFinite(price)?price:0];
    });
    return {name:nameInput?.value||'',choices};
  });
}
function renderVariableGroups(targetId='new-variable-groups',draft=newMenuVariables){
  const el=document.getElementById(targetId);if(!el)return;
  const editMode=targetId==='edit-variable-groups';
  const removeGroupFn=editMode?'removeEditVariableGroup':'removeVariableGroup';
  const addChoiceFn=editMode?'addEditVariableChoice':'addVariableChoice';
  const removeChoiceFn=editMode?'removeEditVariableChoice':'removeVariableChoice';
  el.innerHTML=draft.length?draft.map((g,gi)=>`
    <div class="menu-variable-group" data-variable-group="${gi}">
      <div class="menu-variable-group-head">
        <input class="variable-draft-input" data-group-index="${gi}" data-variable-field="name" value="${esc(g.name||'')}" placeholder="Variable name e.g. Size" maxlength="80">
        <button type="button" class="btn btn-small secondary" data-action="${removeGroupFn}(${gi})">REMOVE</button>
      </div>
      <div class="menu-variable-choice-help"><b>How this works:</b> Key is an internal identifier; Customer label is what customers see. You can leave Key blank and it will be generated automatically from the label.</div>
      <div class="menu-variable-choices">
        ${(g.choices||[]).map((ch,ci)=>`
          <div class="menu-variable-choice">
            <input class="variable-draft-input" data-group-index="${gi}" data-choice-index="${ci}" data-variable-field="key" value="${esc(ch?.[0]||'')}" placeholder="Internal key e.g. small (optional)" maxlength="80" title="Internal identifier. Leave blank to generate it automatically from the customer label.">
            <input class="variable-draft-input" data-group-index="${gi}" data-choice-index="${ci}" data-variable-field="label" value="${esc(ch?.[1]||'')}" placeholder="Customer label e.g. Small" maxlength="120" title="This is the name customers will see.">
            <input class="variable-draft-input" data-group-index="${gi}" data-choice-index="${ci}" data-variable-field="price" type="number" min="0" max="100000" step=".01" value="${Number(ch?.[2]||0)}" placeholder="Extra KES e.g. 200">
            <button type="button" class="btn btn-small secondary" data-action="${removeChoiceFn}(${gi},${ci})" aria-label="Remove choice">×</button>
          </div>`).join('')}
      </div>
      <button type="button" class="btn btn-small" data-action="${addChoiceFn}(${gi})">+ ADD CHOICE</button>
    </div>`).join(''):'<p class="muted menu-variable-empty">No variables yet. Add one when customers need to choose a size, side, spice level, portion, add-on or other variation.</p>';
}
function bindMenuVariableControls(){
  if(window.__menuVariableControlsBound)return;
  window.__menuVariableControlsBound=true;
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-menu-variable-add]');
    if(!button)return;
    event.preventDefault();
    event.stopPropagation();
    if(button.dataset.menuVariableAdd==='new')addVariableGroup();
    else if(button.dataset.menuVariableAdd==='edit')addEditVariableGroup();
  });
}
bindMenuVariableControls();
function addVariableGroup(){newMenuVariables=readVariableDraftInputs(newMenuVariables,'new-variable-groups');newMenuVariables.push({name:'',choices:[['','',0]]});renderVariableGroups();}
function removeVariableGroup(index){newMenuVariables=readVariableDraftInputs(newMenuVariables,'new-variable-groups');newMenuVariables.splice(index,1);renderVariableGroups();}
function addVariableChoice(index){newMenuVariables=readVariableDraftInputs(newMenuVariables,'new-variable-groups');newMenuVariables[index]=newMenuVariables[index]||{name:'',choices:[]};newMenuVariables[index].choices.push(['','',0]);renderVariableGroups();}
function removeVariableChoice(gi,ci){newMenuVariables=readVariableDraftInputs(newMenuVariables,'new-variable-groups');if(newMenuVariables[gi]){newMenuVariables[gi].choices.splice(ci,1);if(!newMenuVariables[gi].choices.length)newMenuVariables[gi].choices.push(['','',0]);}renderVariableGroups();}
function normalizeManagerVariables(draft){
  const groups=cloneMenuVariables(draft);
  const seen=new Set();
  return groups.map((g)=>{
    const name=cleanMenuVariableName(g.name);
    if(!name)throw new Error('Every variable needs a name.');
    const groupKey=name.toLowerCase();if(seen.has(groupKey))throw new Error('Variable names must be unique.');seen.add(groupKey);
    const choices=(g.choices||[]).map(ch=>{
      const label=cleanMenuVariableChoice(ch?.[1]);if(!label)throw new Error('Every variable choice needs a customer label.');
      const key=String(ch?.[0]||makeVariableKey(label)).trim().slice(0,80);
      const price=Number(ch?.[2]||0);if(!Number.isFinite(price)||price<0)throw new Error('Variable price adjustments cannot be negative.');
      return [key,label,price];
    });
    if(!choices.length)throw new Error(`"${name}" needs at least one choice.`);
    const choiceKeys=new Set();choices.forEach(ch=>{const k=ch[0].toLowerCase();if(!k||choiceKeys.has(k))throw new Error(`Choice keys in "${name}" must be unique.`);choiceKeys.add(k);});
    return {name,choices};
  });
}
function variableSummary(p){
  const options=Array.isArray(p.options)?p.options:[];
  if(!options.length)return '<span class="menu-variable-count muted">No variables</span>';
  const total=options.reduce((n,g)=>n+(Array.isArray(g.choices)?g.choices.length:0),0);
  return '<span class="menu-variable-count">'+options.length+' variable'+(options.length===1?'':'s')+' · '+total+' choices</span>';
}
function menuCategoryItems(category){
  return (D.menu?.products||[]).filter(p=>String(p.category_id||'')===String(category.id)||(p.category_id==null&&String(p.category_name||p.category||'').toLowerCase()===String(category.name||'').toLowerCase())).length;
}
function selectMenuCategory(id){
  const select=document.getElementById('mc');
  if(select){select.value=id;}
  document.getElementById('menu-new-item-panel')?.scrollIntoView({behavior:'smooth',block:'start'});
  setTimeout(()=>document.getElementById('mn')?.focus(),300);
}
async function reorderMenuCategories(orderedIds){
  const button=document.querySelector('[data-menu-reorder-save]');
  if(button){button.disabled=true;button.textContent='SAVING…';}
  try{
    try{
      await api('/api/menu/categories/reorder',{method:'POST',body:JSON.stringify({businessId:B,categoryIds:orderedIds})});
    }catch(primaryError){
      // Backward-compatible fallback for a manager API deployment that has
      // category PATCH support but has not yet picked up the bulk reorder route.
      const current=[...(D.menu?.categories||[])];
      const byId=new Map(current.map(c=>[String(c.id),c]));
      if(orderedIds.length!==current.length||orderedIds.some(id=>!byId.has(String(id))))throw primaryError;
      for(let i=0;i<orderedIds.length;i++){
        await api('/api/menu/categories/'+encodeURIComponent(orderedIds[i]),{
          method:'PATCH',
          body:JSON.stringify({businessId:B,sortOrder:i})
        });
      }
    }
    T='menu';
    await load();
  }catch(e){
    alert(e.message||'Unable to reorder categories');
    if(button){button.disabled=false;button.textContent='SAVE CATEGORY ORDER';}
  }
}
async function moveMenuCategory(id,direction){
  const cats=[...(D.menu?.categories||[])].sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||String(a.name).localeCompare(String(b.name)));
  const index=cats.findIndex(c=>String(c.id)===String(id));if(index<0)return;
  const next=index+(direction==='up'?-1:1);if(next<0||next>=cats.length)return;
  [cats[index],cats[next]]=[cats[next],cats[index]];
  await reorderMenuCategories(cats.map(c=>c.id));
}
function bindMenuCategoryDrag(){
  const list=document.getElementById('menu-category-admin-list');if(!list)return;
  let draggedId=null;
  list.querySelectorAll('[data-menu-category-row]').forEach(row=>{
    row.addEventListener('dragstart',e=>{draggedId=row.dataset.menuCategoryRow;row.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedId);});
    row.addEventListener('dragend',()=>{draggedId=null;row.classList.remove('dragging');list.querySelectorAll('[data-menu-category-row]').forEach(x=>x.classList.remove('drag-over'));});
    row.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';if(row.dataset.menuCategoryRow!==draggedId)row.classList.add('drag-over');});
    row.addEventListener('dragleave',()=>row.classList.remove('drag-over'));
    row.addEventListener('drop',async e=>{
      e.preventDefault();row.classList.remove('drag-over');
      const from=draggedId||e.dataTransfer.getData('text/plain'),to=row.dataset.menuCategoryRow;
      if(!from||from===to)return;
      const ids=[...(D.menu?.categories||[])].sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||String(a.name).localeCompare(String(b.name))).map(c=>c.id);
      const fromIndex=ids.indexOf(from),toIndex=ids.indexOf(to);if(fromIndex<0||toIndex<0)return;
      ids.splice(fromIndex,1);ids.splice(toIndex,0,from);await reorderMenuCategories(ids);
    });
  });
}
function pickHeroPhoto(e){const f=e.target.files?.[0];if(!f)return;if(!/^image\/(jpeg|png|webp)$/i.test(f.type))return alert('Please upload a JPG, PNG or WebP image.');const rd=new FileReader();rd.onload=()=>{const im=new Image();im.onload=()=>{const W=2400,H=1350,R=W/H,r=im.width/im.height;let sw=im.width,sh=im.height,sx=0,sy=0;if(r>R){sw=Math.round(im.height*R);sx=Math.round((im.width-sw)/2)}else if(r<R){sh=Math.round(im.width/R);sy=Math.round((im.height-sh)/2)}const cv=document.createElement('canvas');cv.width=W;cv.height=H;const ctx=cv.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(im,sx,sy,sw,sh,0,0,W,H);heroPhotoData=cv.toDataURL('image/jpeg',.9);const p=document.getElementById('hero-photo-preview');if(p)p.innerHTML='<img src="'+heroPhotoData+'" alt="Hero preview">';const m=document.getElementById('hero-photo-meta');if(m)m.textContent='Prepared as a 2400 × 1350 px 16:9 hero image.'};im.src=rd.result};rd.readAsDataURL(f)}
async function saveMenuHero(){const id=document.getElementById('hero-product')?.value||'';if(!id)return alert('Choose the dish that should appear in Today’s Special.');const p=(D.menu?.products||[]).find(x=>String(x.id)===String(id));if(!p)return alert('That menu item could not be found.');const url=heroPhotoData||document.getElementById('hero-image-url')?.value.trim()||p.hero_image_url||'';if(!url)return alert('Upload a hero photo or paste a 16:9 hero image URL first.');const b=document.getElementById('hero-save-button');if(b){b.disabled=true;b.textContent='SAVING…'}try{await api('/api/menu/products/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({businessId:B,heroImageUrl:url,featured:true})});heroPhotoData='';T='menu';await load()}catch(e){alert(e.message||'Unable to save hero image')}finally{if(b){b.disabled=false;b.textContent='SAVE TODAY’S SPECIAL'}}}
async function clearMenuHero(id){if(!id)return;try{await api('/api/menu/products/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({businessId:B,heroImageUrl:''})});T='menu';await load()}catch(e){alert(e.message||'Unable to clear hero image')}}
function menu(){
  const m=D.menu||{categories:[],products:[]};newMenuVariables=[];const heroProducts=(m.products||[]).filter(p=>p.featured||p.hero_image_url);
  const cats=[...(m.categories||[])].sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||String(a.name).localeCompare(String(b.name)));
  const categoryRows=cats.map((c,i)=>'<article class="menu-category-admin-row" draggable="true" data-menu-category-row="'+esc(c.id)+'"><div class="menu-category-admin-grip" aria-hidden="true">⠿</div><div class="menu-category-admin-index">'+(i+1)+'</div><button type="button" class="menu-category-admin-main" data-action="selectMenuCategory(\''+c.id+'\')"><strong>'+esc(c.name)+'</strong><span>'+menuCategoryItems(c)+' '+(menuCategoryItems(c)===1?'dish':'dishes')+' · '+esc(c.active?'VISIBLE':'HIDDEN')+'</span></button><div class="menu-category-admin-actions"><button type="button" class="btn btn-small secondary" data-action="selectMenuCategory(\''+c.id+'\')">ADD DISH</button><button type="button" class="menu-category-order-btn" data-action="moveMenuCategory(\''+c.id+'\',\'up\')" aria-label="Move '+esc(c.name)+' up" '+(i===0?'disabled':'')+'>↑</button><button type="button" class="menu-category-order-btn" data-action="moveMenuCategory(\''+c.id+'\',\'down\')" aria-label="Move '+esc(c.name)+' down" '+(i===cats.length-1?'disabled':'')+'>↓</button></div></article>').join('');
  const categoryOptions=cats.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('');
  const currentHero=heroProducts.find(p=>p.hero_image_url)||heroProducts[0]||null;
  const heroOptions=(m.products||[]).map(p=>'<option value="'+esc(p.id)+'" '+(currentHero&&String(currentHero.id)===String(p.id)?'selected':'')+'>'+esc(p.name)+(p.hero_image_url?' · HERO SET':'')+'</option>').join('');
  const heroPreview=currentHero?.hero_image_url||currentHero?.image_url||'';
  const heroSection='<section class="manager-panel manager-hero-panel"><div class="panel-title"><div><span class="eyebrow">CUSTOMER MENU HERO</span><h2>Today’s Special.</h2><p>Control the large promotional hero at the top of the customer menu. Use a dedicated 16:9 image so the hero stays sharp instead of stretching a square card photo.</p></div><span class="mode-badge">'+heroProducts.filter(p=>p.hero_image_url).length+' HERO'+(heroProducts.filter(p=>p.hero_image_url).length===1?'':'ES')+'</span></div><div class="manager-hero-editor"><div class="manager-hero-live">'+(heroPreview?'<img src="'+esc(heroPreview)+'" alt="Current menu hero">':'<div class="manager-hero-empty">No dedicated hero image yet.<br><span>Upload one below.</span></div>')+'<div class="manager-hero-live-copy"><span>🔥 TODAY’S SPECIAL</span><strong>'+esc(currentHero?.name||'Choose a dish')+'</strong><small>'+esc(currentHero?.description||'Freshly made. Unforgettable taste.')+'</small></div></div><div class="manager-hero-form"><label>Today’s Special dish<select id="hero-product"><option value="">Choose a dish…</option>'+heroOptions+'</select></label><label>High-resolution 16:9 hero photo<input id="hero-photo" type="file" accept="image/jpeg,image/png,image/webp" data-change="pickHeroPhoto(event)"></label><div id="hero-photo-preview" class="hero-photo-preview"></div><div id="hero-photo-meta" class="hero-photo-meta">Recommended: original restaurant photo, ideally 2400 × 1350 px or larger. The editor crops it to the exact 16:9 hero frame.</div><label>Or paste a hero image URL<input id="hero-image-url" placeholder="https://…/burger-hero.jpg" value="'+esc(currentHero?.hero_image_url||'')+'"></label><div class="button-row"><button id="hero-save-button" type="button" class="btn" data-action="saveMenuHero()">SAVE TODAY’S SPECIAL</button>'+(currentHero?.hero_image_url?'<button type="button" class="btn secondary" data-action="clearMenuHero(\''+esc(currentHero.id)+'\')">REMOVE HERO IMAGE</button>':'')+'</div></div></div></section>';
  return heroSection+'<div class="manager-grid two"><section class="manager-panel menu-category-manager-panel"><div class="panel-title"><div><span class="eyebrow">MENU STRUCTURE</span><h2>Categories</h2><p>Arrange categories in the exact top-to-bottom order you want customers to see from left to right in the menu.</p></div><span class="mode-badge">'+cats.length+' CATEGOR'+(cats.length===1?'Y':'IES')+'</span></div><form class="inline-form" onsubmit="category(event)"><input id="cat" required placeholder="Breakfast"><button class="btn">ADD CATEGORY</button></form><div class="menu-category-order-help"><span>☷</span><span>Drag a category to reposition it, or use the arrows. The saved order controls the customer menu and the All view.</span></div><div id="menu-category-admin-list" class="menu-category-admin-list">'+(categoryRows||'<div class="empty-state">Create your first category above.</div>')+'</div><button type="button" class="btn wide secondary" data-menu-reorder-save style="display:none">SAVE CATEGORY ORDER</button></section><section id="menu-new-item-panel" class="manager-panel"><div class="panel-title"><div><span class="eyebrow">ADD ITEM</span><h2>New menu item</h2><p>Choose a category or press <strong>ADD DISH</strong> on a category to add the next dish directly to it.</p></div></div><form onsubmit="addItem(event)"><div class="form-grid"><label>Name<input id="mn" required></label><label>Price (KES)<input id="mp" type="number" min="0" required></label></div><label>Description<textarea id="md"></textarea></label><div class="form-grid"><label>Category<select id="mc">'+categoryOptions+'</select></label><label>Photo<input id="mf" type="file" accept="image/*" data-change="pickPhoto(event)"></label></div><input id="mu" placeholder="Or paste an image URL"><div id="preview" class="photo-preview"></div><label class="check"><input id="mfeat" type="checkbox"> Featured item</label><div class="menu-variable-builder"><div class="menu-variable-builder-head"><div><span class="eyebrow">FOOD VARIABLES</span><h3>Customer choices</h3><p class="muted">Add sizes, portions, sides, spice levels, add-ons or any other choice. Set a price adjustment for each choice.</p></div><button type="button" class="btn btn-small" data-menu-variable-add="new">+ ADD VARIABLE</button></div><div id="new-variable-groups"></div></div><button class="btn wide">PUBLISH MENU ITEM</button></form></section></div><section class="manager-panel"><div class="panel-title"><div><span class="eyebrow">LIVE MENU</span><h2>'+m.products.length+' items</h2></div></div><div class="menu-admin-grid">'+(m.products.map(itemCard).join('')||'<div class="empty-state">No menu items yet.</div>')+'</div></section>';
}
  bindMenuCategoryDrag();
function itemCard(p){
  return '<article class="menu-admin-card"><div class="menu-admin-image">'+(p.image_url?'<img src="'+esc(p.image_url)+'" alt="">':'<span>NO PHOTO</span>')+'</div><div class="menu-admin-body"><span class="eyebrow">'+esc(p.category_name||p.category||'UNCATEGORIZED')+'</span><h3>'+esc(p.name)+'</h3><p>'+esc(p.description||'No description')+'</p><div class="menu-admin-bottom"><strong>'+money(p.price)+'</strong><span class="status-chip '+(p.active?'active':'inactive')+'">'+(p.active?'AVAILABLE':'HIDDEN')+'</span>'+(p.featured?'<span class="feature-chip">FEATURED</span>':'')+'</div><div class="menu-variable-summary">'+variableSummary(p)+'</div><div class="button-row"><button class="btn btn-small" data-action="toggleItem(\''+p.id+'\','+(!p.active)+')">'+(p.active?'HIDE':'PUBLISH')+'</button><button class="btn btn-small secondary" data-action="feature(\''+p.id+'\','+(!p.featured)+')">'+(p.featured?'REMOVE FEATURED':'MAKE FEATURED')+'</button><button class="btn btn-small secondary" data-action="openVariableEditor(\''+p.id+'\')">EDIT VARIABLES</button></div></div></article>';
}
async function category(e){e.preventDefault();try{await api('/api/menu/categories',{method:'POST',body:JSON.stringify({businessId:B,name:document.getElementById('cat').value.trim()})});T='menu';await load()}catch(x){alert(x.message)}}
function pickPhoto(e){const f=e.target.files?.[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{const im=new Image();im.onload=()=>{const s=Math.min(1,1000/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=im.width*s;c.height=im.height*s;c.getContext('2d').drawImage(im,0,0,c.width,c.height);photoData=c.toDataURL('image/jpeg',.78);document.getElementById('preview').innerHTML='<img src="'+photoData+'" alt="">'};im.src=rd.result};rd.readAsDataURL(f)}
async function addItem(e){
  e.preventDefault();
  try{
    const options=normalizeManagerVariables(readVariableDraftInputs(newMenuVariables,'new-variable-groups'));
    await api('/api/menu/products',{method:'POST',body:JSON.stringify({businessId:B,name:document.getElementById('mn').value.trim(),price:Number(document.getElementById('mp').value),description:document.getElementById('md').value.trim(),categoryId:document.getElementById('mc').value,imageUrl:photoData||document.getElementById('mu').value.trim(),featured:document.getElementById('mfeat').checked,active:true,options})});
    photoData='';newMenuVariables=[];T='menu';await load();
  }catch(x){alert(x.message)}
}
function openVariableEditor(id){
  const p=D.menu.products.find(x=>x.id===id);if(!p)return;
  variableDraftProductId=id;window.variableEditDraft=cloneMenuVariables(p.options);
  const host=document.createElement('div');host.id='menu-variable-editor-modal';host.className='modal-backdrop';
  host.innerHTML='<section class="refund-modal variable-editor-modal" role="dialog" aria-modal="true"><button type="button" class="modal-close" data-action="closeVariableEditor()" aria-label="Close">×</button><span class="eyebrow">MENU ITEM VARIABLES</span><h2>'+esc(p.name)+'</h2><p class="muted">Customers will see these choices when they add this item. Price adjustments are added to the base item price.</p><div id="edit-variable-groups"></div><div class="button-row variable-editor-actions"><button type="button" class="btn btn-small" data-menu-variable-add="edit">+ ADD VARIABLE</button><button type="button" class="btn wide" data-action="saveVariableEditor()">SAVE VARIABLES</button></div></section>';
  document.body.appendChild(host);renderVariableGroups('edit-variable-groups',window.variableEditDraft);
}
function syncEditVariableDraft(){window.variableEditDraft=readVariableDraftInputs(window.variableEditDraft||[],'edit-variable-groups');return window.variableEditDraft}
function addEditVariableGroup(){const draft=syncEditVariableDraft();draft.push({name:'',choices:[['','',0]]});renderVariableGroups('edit-variable-groups',draft);}
function removeEditVariableGroup(index){const draft=syncEditVariableDraft();draft.splice(index,1);renderVariableGroups('edit-variable-groups',draft);}
function addEditVariableChoice(index){const draft=syncEditVariableDraft();draft[index]?.choices.push(['','',0]);renderVariableGroups('edit-variable-groups',draft);}
function removeEditVariableChoice(gi,ci){const draft=syncEditVariableDraft();if(draft[gi]){draft[gi].choices.splice(ci,1);if(!draft[gi].choices.length)draft[gi].choices.push(['','',0]);}renderVariableGroups('edit-variable-groups',draft);}
async function saveVariableEditor(){
  try{
    const draft=readVariableDraftInputs(window.variableEditDraft||[],'edit-variable-groups');
    const options=normalizeManagerVariables(draft);
    await api('/api/menu/products/'+encodeURIComponent(variableDraftProductId),{method:'PATCH',body:JSON.stringify({businessId:B,options})});
    closeVariableEditor();await load();
  }catch(e){alert(e.message)}
}
function closeVariableEditor(){document.getElementById('menu-variable-editor-modal')?.remove();variableDraftProductId=null;window.variableEditDraft=[]}
function promos(){
  const p=D.menu.promotions||[],coupons=D.menu.coupons||[];
  return '<div class="manager-grid two">'+
    '<section class="manager-panel"><div class="panel-title"><div><span class="eyebrow">PROMOTION BUILDER</span><h2>Create offer</h2><p>Percentage, fixed amount, special price, Buy X Get Y or free item.</p></div></div><form onsubmit="promo(event)"><label>Offer name<input id="pn" required placeholder="Tuesday Chicken Deal"></label><div class="form-grid"><label>Type<select id="pt"><option value="PERCENT">Percentage discount</option><option value="FIXED">Fixed amount discount</option><option value="SPECIAL_PRICE">Special price</option><option value="BUY_X_GET_Y">Buy X Get Y</option><option value="FREE_ITEM">Free item</option></select></label><label>Value<input id="pv" type="number" min="0" step=".01"></label></div><div class="form-grid"><label>Starts<input id="ps" type="datetime-local"></label><label>Ends<input id="pe" type="datetime-local"></label></div><label>Banner text<input id="pb" placeholder="TODAY&#39;S OFFER • Save 15%"></label><label>Minimum order (KES)<input id="pmin" type="number" min="0" value="0"></label><button class="btn wide">ACTIVATE PROMOTION</button></form></section>'+
    '<section class="manager-panel"><div class="panel-title"><div><span class="eyebrow">PROMOTIONS</span><h2>'+p.filter(x=>x.active).length+' active</h2></div></div>'+(p.map(promoCard).join('')||'<div class="empty-state">No promotions yet.</div>')+'</section></div>'+
    '<section class="manager-panel promo-code-manager"><div class="panel-title"><div><span class="eyebrow">CUSTOMER PROMO CODES</span><h2>Create a code customers can actually apply.</h2><p>Share a code such as <b>SAVANNA10</b>. The server validates the discount again when the order is placed.</p></div></div>'+
    '<form onsubmit="createCoupon(event)" class="form-grid four"><label>Promo code<input id="coupon-code" required maxlength="40" placeholder="SAVANNA10" autocapitalize="characters"></label><label>Discount type<select id="coupon-type"><option value="PERCENT">Percentage</option><option value="FIXED">Fixed KES</option></select></label><label>Discount value<input id="coupon-value" type="number" min="0.01" step=".01" required placeholder="10"></label><label>Minimum order (KES)<input id="coupon-min" type="number" min="0" step=".01" value="0"></label><label>Max redemptions <span class="optional">OPTIONAL</span><input id="coupon-limit" type="number" min="1" step="1" placeholder="Unlimited"></label><label>Starts <span class="optional">OPTIONAL</span><input id="coupon-starts" type="datetime-local"></label><label>Expires <span class="optional">OPTIONAL</span><input id="coupon-expires" type="datetime-local"></label><div><span class="form-label">READY TO SHARE</span><button class="btn wide">CREATE PROMO CODE</button></div></form>'+
    '<div class="coupon-list">'+(coupons.length?coupons.map(couponCard).join(''):'<div class="empty-state">No customer promo codes yet.</div>')+'</div></section>';
}
function couponCard(c){
  const type=c.discount_type==='PERCENT'?esc(c.discount_value)+'% off':money(c.discount_value)+' off';
  const link='menu.html?businessId='+encodeURIComponent(B)+'&promo='+encodeURIComponent(c.code);
  return '<article class="coupon-card '+(c.active?'':'off')+'"><div class="coupon-main"><span class="coupon-code">'+esc(c.code)+'</span><strong>'+type+'</strong><small>Minimum '+money(c.min_order_amount)+(c.max_redemptions===null?' · Unlimited uses':' · '+Number(c.redeemed_count||0)+' / '+Number(c.max_redemptions)+' used')+'</small></div><div class="coupon-actions"><button class="btn btn-small" data-action="copyPromoCode(this,'+JSON.stringify(c.code)+')">COPY CODE</button><button class="btn btn-small secondary" data-action="sharePromoCode('+JSON.stringify(c.code)+','+JSON.stringify(link)+','+JSON.stringify(type)+')">SHARE</button><button class="btn btn-small secondary" data-action="toggleCoupon('+JSON.stringify(c.id)+','+(!c.active)+')">'+(c.active?'PAUSE':'ACTIVATE')+'</button></div></article>';
}
function promoCard(p){return '<article class="promotion-card '+(p.active?'':'off')+'"><div><span class="eyebrow">'+esc(p.type.replaceAll('_',' '))+'</span><h3>'+esc(p.name)+'</h3><p>'+(p.type==='PERCENT'?esc(p.value)+'% off':p.type==='FIXED'?money(p.value)+' off':p.type==='SPECIAL_PRICE'?'Special price '+money(p.value):'Value '+esc(p.value))+'</p></div><button class="btn btn-small '+(p.active?'':'done')+'" data-action="togglePromo(\''+p.id+'\','+(!p.active)+')">'+(p.active?'PAUSE':'ACTIVATE')+'</button></article>'}
async function createCoupon(e){
  e.preventDefault();
  const g=id=>document.getElementById(id)?.value.trim()||'';
  try{
    await api('/api/menu/coupons',{method:'POST',body:JSON.stringify({businessId:B,code:g('coupon-code').toUpperCase(),name:g('coupon-code').toUpperCase(),discountType:g('coupon-type'),discountValue:Number(g('coupon-value')),minOrderAmount:Number(g('coupon-min')||0),maxRedemptions:g('coupon-limit')?Number(g('coupon-limit')):null,startsAt:g('coupon-starts')?new Date(g('coupon-starts')).toISOString():null,expiresAt:g('coupon-expires')?new Date(g('coupon-expires')).toISOString():null,active:true})});
    T='promotions';await load();
  }catch(x){alert(x.message||'Could not create promo code.');}
}
async function toggleCoupon(id,active){
  const c=(D.menu.coupons||[]).find(x=>String(x.id)===String(id));if(!c)return;
  try{await api('/api/menu/coupons/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({businessId:B,code:c.code,name:c.code,discountType:c.discount_type,discountValue:c.discount_value,minOrderAmount:c.min_order_amount,maxRedemptions:c.max_redemptions,startsAt:c.starts_at,expiresAt:c.expires_at,active})});T='promotions';await load();}catch(e){alert(e.message||'Could not update promo code.');}
}
async function copyPromoCode(button,code){
  const old=button.textContent;
  try{await navigator.clipboard.writeText(code);button.textContent='COPIED ✓';setTimeout(()=>button.textContent=old,1400);}
  catch{alert('Copy was blocked. Promo code: '+code);}
}
async function sharePromoCode(code,link,type){
  const text='Use promo code '+code+' for '+type+' at '+(window.TenantTheme?.name?.()||'our restaurant')+'.';
  try{if(navigator.share){await navigator.share({title:'Restaurant promo code '+code,text,url:new URL(link,location.href).href});}
  else{await navigator.clipboard.writeText(new URL(link,location.href).href);alert('Share link copied to clipboard.');}}
  catch(e){if(e?.name!=='AbortError')alert('Share was not completed.');}
}
async function promo(e){e.preventDefault();const g=id=>document.getElementById(id).value;try{await api('/api/menu/promotions',{method:'POST',body:JSON.stringify({businessId:B,name:g('pn'),type:g('pt'),value:Number(g('pv')),minOrder:Number(g('pmin')),startsAt:g('ps')?new Date(g('ps')).toISOString():null,endsAt:g('pe')?new Date(g('pe')).toISOString():null,bannerText:g('pb'),active:true})});T='promotions';await load()}catch(x){alert(x.message)}}
async function togglePromo(id,a){const p=D.menu.promotions.find(x=>x.id===id);if(!p)return;try{await api('/api/menu/promotions/'+id,{method:'PATCH',body:JSON.stringify({businessId:B,name:p.name,type:p.type,value:p.value,minOrder:p.min_order_kes,startsAt:p.starts_at,endsAt:p.ends_at,daysOfWeek:p.days_of_week,startTime:p.start_time,endTime:p.end_time,active:a,bannerText:p.banner_text,productIds:p.product_ids,category:p.category})});T='promotions';await load()}catch(e){alert(e.message)}}
function branches(){return '<div class="manager-grid two"><section class="manager-panel"><div class="panel-title"><div><span class="eyebrow">FULFILLMENT</span><h2>Branches</h2><p>Customers do not choose a branch; the delivery engine selects the best active branch.</p></div></div>'+(D.branches.map(b=>'<div class="branch-card"><div><b>'+esc(b.name)+'</b><span>'+esc(b.address)+'</span><small>'+Number(b.service_radius_km||18)+' km radius</small></div><span class="status-chip '+(b.active?'active':'inactive')+'">'+(b.active?'ACTIVE':'OFF')+'</span></div>').join('')||'<div class="empty-state">No branches configured.</div>')+'</section><section class="manager-panel"><div class="panel-title"><div><span class="eyebrow">ADD LOCATION</span><h2>New branch</h2></div></div><form onsubmit="branch(event)"><label>Name<input id="bn" required></label><label>Address<input id="ba" required></label><div class="form-grid"><label>Latitude<input id="blat" type="number" step="any" required></label><label>Longitude<input id="blng" type="number" step="any" required></label></div><label>Service radius (km)<input id="br" type="number" min="1" max="30" value="18"></label><label>Pickup instructions<input id="bi"></label><button class="btn wide">ADD BRANCH</button></form></section></div>'}
async function branch(e){e.preventDefault();const g=id=>document.getElementById(id).value;try{await api('/api/businesses/'+B+'/branches',{method:'POST',body:JSON.stringify({name:g('bn'),address:g('ba'),latitude:Number(g('blat')),longitude:Number(g('blng')),serviceRadiusKm:Number(g('br')),pickupInstructions:g('bi'),active:true,acceptingOrders:true})});T='branches';await load()}catch(x){alert(x.message)}}
function delivery(){const p=D.pricing,zones=D.deliveryZones||[];const riderConnected=Boolean(D.dispatch?.riderConnected);return '<section class="manager-panel"><div class="panel-title"><div><span class="eyebrow">DELIVERY PRICING</span><h2>'+(p.editable?'Restaurant delivery pricing':'Automatic platform pricing')+'</h2><p>'+(p.editable?'Set simple delivery zones and the fee customers pay. The restaurant handles its own delivery person.':'Automatic pricing is active because the Rider Dashboard is connected. Rider earnings are handled by the rider workflow.')+'</p></div><span class="mode-badge">'+(riderConnected?'RIDER CONNECTED':'MANUAL DELIVERY')+'</span></div>'+(p.editable?'':'<div class="auto-pricing"><b>AUTOMATIC</b><span>'+money(p.rules.minimum_fee_kes)+' – '+money(p.rules.maximum_fee_kes)+' customer range</span><span>Route distance + traffic duration + fuel movement + rider payment floor</span></div>')+'</section><section class="manager-panel delivery-zones-panel"><div class="panel-title"><div><span class="eyebrow">RESTAURANT DELIVERY ZONES</span><h2>Zones & delivery prices</h2><p>Control where this restaurant delivers, the delivery fee and the minimum order for each zone.</p></div><span class="mode-badge">'+zones.length+' ZONE'+(zones.length===1?'':'S')+'</span></div><div class="delivery-zone-list">'+(zones.length?zones.map(z=>'<article class="delivery-zone-card"><div><strong>'+esc(z.name)+'</strong><small>'+esc(z.zone_type)+' · '+(z.active?'ACTIVE':'DISABLED')+' · Priority '+Number(z.priority||0)+'</small><small>Fee '+money(z.fee)+' · Minimum '+money(z.minimum_order)+'</small></div><div class="delivery-zone-actions"><button class="btn btn-small" data-action="toggleDeliveryZone(\''+z.id+'\','+(!z.active)+')">'+(z.active?'DISABLE':'ENABLE')+'</button><button class="btn btn-small secondary" data-action="editDeliveryZone(\''+z.id+'\')">EDIT PRICE</button></div></article>').join(''):'<div class="empty-state">No delivery zones configured yet.</div>')+'</div><details class="delivery-zone-create"><summary class="btn">＋ ADD DELIVERY ZONE</summary><form onsubmit="createDeliveryZone(event)" class="form-grid four"><label>Zone name<input id="zone-name" required placeholder="e.g. Westlands"></label><label>Coverage radius (km)<input id="zone-radius-km" type="number" min="0.5" max="30" step="0.5" required placeholder="e.g. 3"></label><label>Delivery fee<input id="zone-fee" type="number" min="0" step=".01" required placeholder="e.g. 150"></label><label>Minimum order<input id="zone-min" type="number" min="0" step=".01" required placeholder="0"></label><label>Priority<input id="zone-priority" type="number" min="0" step="1" value="0"></label><button class="btn">CREATE DELIVERY ZONE</button></form></details></section>'}
async function saveDelivery(e){e.preventDefault();const k=['base_fee_kes','per_km_kes','per_minute_kes','minimum_fee_kes','maximum_fee_kes','peak_multiplier'],b={};k.forEach(x=>b[x]=Number(document.getElementById('dp-'+x).value));try{await api('/api/businesses/'+B+'/delivery-pricing',{method:'PATCH',body:JSON.stringify(b)});T='delivery';await load()}catch(x){alert(x.message)}}
async function createDeliveryZone(e){e.preventDefault();const g=id=>document.getElementById(id)?.value;try{await api('/api/manager/delivery-zones',{method:'POST',body:JSON.stringify({name:g('zone-name'),zoneType:'RADIUS',fee:Number(g('zone-fee')),minimumOrder:Number(g('zone-min')),radiusMeters:Number(g('zone-radius-km'))*1000,priority:Number(g('zone-priority')||0)})});T='delivery';await load()}catch(x){alert(x.message)}}
async function toggleDeliveryZone(zoneId,active){try{await api('/api/manager/delivery-zones/'+encodeURIComponent(zoneId),{method:'PATCH',body:JSON.stringify({active})});T='delivery';await load()}catch(x){alert(x.message)}}
async function editDeliveryZone(zoneId){const z=(D.deliveryZones||[]).find(x=>String(x.id)===String(zoneId));if(!z)return;const fee=prompt('Delivery fee (KES)',z.fee);if(fee===null)return;const minimum=prompt('Minimum order (KES)',z.minimum_order);if(minimum===null)return;const priority=prompt('Priority',z.priority||0);if(priority===null)return;try{await api('/api/manager/delivery-zones/'+encodeURIComponent(zoneId),{method:'PATCH',body:JSON.stringify({fee:Number(fee),minimumOrder:Number(minimum),priority:Number(priority)})});T='delivery';await load()}catch(x){alert(x.message)}}
function riderStatusLabel(status){
  return ({INVITED:'INVITED',PENDING_APPROVAL:'AWAITING APPROVAL',ACTIVE:'ACTIVE',SUSPENDED:'SUSPENDED'})[status]||status||'UNKNOWN';
}
function riderStatusClass(status){return String(status||'').toLowerCase().replace(/_/g,'-');}
function riders(){
  if(!managerFeature('riderModule')) return '<section class="manager-panel"><div class="empty-state">Rider Dashboard is not included in this restaurant package.</div></section>';
  const list=sortRiders(D.riders||[]);
  const pending=list.filter(r=>r.rider_status==='PENDING_APPROVAL').length;
  const invited=list.filter(r=>r.rider_status==='INVITED').length;
  const active=list.filter(r=>r.rider_status==='ACTIVE').length;
  return '<section class="riders-page"><div class="riders-hero"><div><span class="manager-kicker"><i></i> ADVANCED DELIVERY MODULE</span><h2>Riders.</h2><p>Invite riders, review completed profiles and control who can access delivery operations.</p></div><div class="rider-hero-actions"><span class="live-badge"><i></i> '+active+' ACTIVE</span><button class="btn" data-action="document.getElementById(\'rider-invite-panel\')?.scrollIntoView({behavior:\'smooth\'})">＋ INVITE RIDER</button></div></div>'+
  '<div class="rider-admin-summary"><article><span>ACTIVE RIDERS</span><strong>'+active+'</strong><small>Approved and available for operations</small></article><article class="'+(pending?'attention':'')+'"><span>PENDING APPROVAL</span><strong>'+pending+'</strong><small>Profiles completed by riders</small></article><article><span>INVITED</span><strong>'+invited+'</strong><small>Registration links still active</small></article><article><span>AVAILABLE NOW</span><strong>'+list.filter(r=>r.available).length+'</strong><small>Online and not on a trip</small></article></div>'+
  '<div class="manager-grid two"><section class="manager-panel"><div class="panel-title"><div><span class="eyebrow">RIDER TEAM</span><h2>Rider accounts</h2><p>Only ACTIVE riders can sign in and receive delivery assignments.</p></div></div><div class="rider-admin-list">'+(list.length?list.map(riderAdminCard).join(''):'<div class="empty-state">No riders have been invited yet.</div>')+'</div></section>'+
  '<section class="manager-panel" id="rider-invite-panel"><div class="panel-title"><div><span class="eyebrow">NEW RIDER</span><h2>Send an invitation</h2><p>The rider completes their own profile, uploads a photo and creates their password. You approve the account afterwards.</p></div></div><form onsubmit="inviteRider(event)" class="rider-invite-form"><div class="form-grid"><label>Full name<input id="rin-name" required placeholder="Rider full name"></label><label>Phone<input id="rin-phone" required placeholder="07xx xxx xxx"></label></div><div class="form-grid"><label>Email <span class="optional">OPTIONAL</span><input id="rin-email" type="email" placeholder="rider@example.com"></label><label>Vehicle<input id="rin-vehicle" value="Motorbike" required></label></div><label>Plate number <span class="optional">CAN BE ADDED LATER</span><input id="rin-plate" placeholder="KDA 123X"></label><button class="btn wide" id="invite-rider-btn">CREATE INVITATION</button><p class="form-note">A secure registration link will be generated. Copy it and send it directly to the rider.</p></form><div id="rider-invite-result">'+riderInviteResult+'</div></section></div></section>';
}
function riderAdminCard(r){
  const status=r.rider_status|| (r.active?'ACTIVE':'SUSPENDED');
  const action=status==='PENDING_APPROVAL'?'<button class="btn btn-small" data-action="event.stopPropagation();approveRider(\''+r.id+'\',this)">APPROVE RIDER</button>':status==='ACTIVE'?'<button class="btn btn-small" data-action="event.stopPropagation();suspendRider(\''+r.id+'\',this)">SUSPEND</button>':status==='SUSPENDED'?'<button class="btn btn-small" disabled aria-label="Rider is suspended">SUSPENDED</button><button class="btn btn-small secondary" data-action="event.stopPropagation();reactivateRider(\''+r.id+'\',this)">REACTIVATE</button>':status==='INVITED'?'<button class="btn btn-small secondary" data-action="event.stopPropagation();renewRiderInvite(\''+r.id+'\',this)">NEW INVITE LINK</button>':'';
  const availability=status==='ACTIVE'?(r.available?'AVAILABLE':'OFFLINE / BUSY'):riderStatusLabel(status);
  return '<article data-rider-id="'+esc(r.id)+'" class="rider-admin-card rider-clickable" data-action="openRiderProfile(\''+r.id+'\')"><div class="rider-admin-avatar">'+(r.profile_image_url?'<img src="'+esc(r.profile_image_url)+'" alt="">':esc((r.name||'?')[0]))+'</div><div class="rider-admin-main"><div class="rider-admin-top"><div><b>'+esc(r.name)+'</b><span>'+esc(r.phone||'')+(r.email?' · '+esc(r.email):'')+'</span></div><span class="rider-status '+riderStatusClass(status)+'"><i></i>'+esc(riderStatusLabel(status))+'</span></div><div class="rider-admin-meta"><span>'+esc(r.vehicle_type||'Vehicle')+'</span><span>'+esc(r.number_plate||'Plate not set')+'</span><span>'+Number(r.trip_count||0)+' completed</span><span>'+esc(availability)+'</span></div><div class="rider-admin-actions">'+action+(status==='INVITED'?'<span class="pending-note">Registration link awaiting completion</span>':'')+(status==='PENDING_APPROVAL'?'<span class="pending-note">Review profile before activating access</span>':'')+'</div></div></article>';
}
function closeRiderProfile(){document.getElementById('rider-profile-modal')?.remove();}
async function openRiderProfile(id){
  closeRiderProfile();
  const wrap=document.createElement('div');wrap.id='rider-profile-modal';wrap.className='rider-profile-modal';
  wrap.innerHTML='<div class="rider-profile-dialog"><button class="rider-profile-close" data-action="closeRiderProfile()">×</button><div class="rider-profile-loading"><span class="manager-spinner"></span><h2>Loading rider profile…</h2></div></div>';
  document.body.appendChild(wrap);
  try{
    const d=await api('/api/riders/'+encodeURIComponent(id)+'/profile');
    const r=d.rider||{},s=d.summary||{},trips=d.trips||[];
    const km=(Number(s.distance_meters||0)/1000).toFixed(1);
    const dt=v=>v?new Date(v).toLocaleString('en-KE',{dateStyle:'medium',timeStyle:'short'}):'—';
    const tripRows=trips.length?trips.map(t=>'<tr><td><b>'+esc(t.order_number)+'</b><small>'+esc(t.customer_name||'')+'</small></td><td>'+esc(t.delivery_address||'—')+'</td><td>'+((Number(t.route_distance_meters||0)/1000).toFixed(1))+' km</td><td>'+money(t.earning)+'</td><td><span class="profile-trip-status">'+esc(t.status||'—')+'</span></td><td>'+dt(t.completed_at||t.assigned_at)+'</td></tr>').join(''):'<tr><td colspan="6" class="profile-empty">No trips recorded yet.</td></tr>';
    wrap.querySelector('.rider-profile-dialog').innerHTML='<button class="rider-profile-close" data-action="closeRiderProfile()">×</button>'+
      '<div class="rider-profile-head"><div class="rider-profile-avatar">'+(r.profile_image_url?'<img src="'+esc(r.profile_image_url)+'" alt="">':esc((r.name||'?')[0]))+'</div><div><span class="manager-kicker"><i></i> RIDER PROFILE</span><h2>'+esc(r.name)+'</h2><p>'+esc(r.phone||'')+(r.email?' · '+esc(r.email):'')+'</p><div class="profile-pills"><span>'+esc(r.vehicle_type||'Vehicle')+'</span><span>'+esc(r.number_plate||'Plate not set')+'</span><span class="'+riderStatusClass(r.rider_status)+'">'+esc(riderStatusLabel(r.rider_status))+'</span><span>'+((r.online)?'● ONLINE':'○ OFFLINE')+'</span></div></div></div>'+
      '<div class="rider-profile-grid"><article><span>TOTAL EARNINGS</span><strong>'+money(s.total_earnings)+'</strong><small>Released rider earnings</small></article><article><span>COMPLETED TRIPS</span><strong>'+Number(s.completed_trips||0)+'</strong><small>'+Number(s.active_trips||0)+' active now</small></article><article><span>DISTANCE COVERED</span><strong>'+km+' km</strong><small>Across completed trips</small></article><article><span>PLACES DELIVERED</span><strong>'+Number(s.places_delivered||0)+'</strong><small>Unique delivery locations</small></article><article><span>ORDER VALUE DELIVERED</span><strong>'+money(s.delivered_order_value)+'</strong><small>Customer order value</small></article><article><span>7-DAY EARNINGS</span><strong>'+money(s.week_earnings)+'</strong><small>Today: '+money(s.today_earnings)+'</small></article></div>'+
      '<div class="rider-profile-section"><div class="rider-profile-section-head"><div><span class="eyebrow">DELIVERY HISTORY</span><h3>Every trip</h3></div><small>Last delivery: '+dt(s.last_delivery_at)+'</small></div><div class="rider-trip-table-wrap"><table class="rider-trip-table"><thead><tr><th>ORDER</th><th>DESTINATION</th><th>DISTANCE</th><th>EARNINGS</th><th>STATUS</th><th>TIME</th></tr></thead><tbody>'+tripRows+'</tbody></table></div></div>';
  }catch(e){wrap.querySelector('.rider-profile-dialog').innerHTML='<button class="rider-profile-close" data-action="closeRiderProfile()">×</button><div class="login-error">'+esc(e.message||'Unable to load rider profile')+'</div>';}
}
async function inviteRider(e){
  e.preventDefault();
  const b=document.getElementById('invite-rider-btn'),out=document.getElementById('rider-invite-result');
  const g=id=>document.getElementById(id)?.value.trim()||'';
  b.disabled=true;b.textContent='CREATING INVITATION…';out.innerHTML='';
  try{
    const data=await api('/api/rider-invites',{method:'POST',body:JSON.stringify({businessId:B,name:g('rin-name'),phone:g('rin-phone'),email:g('rin-email'),vehicleType:g('rin-vehicle'),numberPlate:g('rin-plate')})});
    riderInviteResult='<div class="rider-invite-success"><span class="eyebrow">INVITATION READY</span><h3>'+esc(data.rider.name)+' has been invited.</h3><p>Send this secure link to the rider. It expires in 48 hours.</p><div class="invite-link-row"><input value="'+esc(data.signupUrl)+'" readonly><button type="button" class="btn btn-small" data-action="copyRiderInvite(this)">COPY LINK</button></div></div>';
    out.innerHTML=riderInviteResult;
    document.getElementById('rin-name').value='';document.getElementById('rin-phone').value='';document.getElementById('rin-email').value='';document.getElementById('rin-plate').value='';
    await (Promise.resolve()).then(()=>load());
    setTimeout(()=>{document.getElementById('rider-invite-panel')?.scrollIntoView({behavior:'smooth'});},80);
  }catch(x){out.innerHTML='<div class="login-error">'+esc(x.message)+'</div>';}
  finally{b.disabled=false;b.textContent='CREATE INVITATION';}
}
async function copyRiderInvite(button){
  const input=button?.parentElement?.querySelector('input'),url=input?.value;
  if(!url)return;
  try{await navigator.clipboard.writeText(url);button.textContent='COPIED ✓';setTimeout(()=>button.textContent='COPY LINK',1500);}
  catch{input.select();document.execCommand('copy');button.textContent='COPIED ✓';setTimeout(()=>button.textContent='COPY LINK',1500);}
}
async function approveRider(id,button){
  button.disabled=true;button.textContent='APPROVING…';
  try{await api('/api/riders/'+id+'/approve',{method:'POST',body:JSON.stringify({businessId:B})});await (Promise.resolve()).then(()=>load());}
  catch(x){button.disabled=false;button.textContent='APPROVE RIDER';alert(x.message);}
}
async function syncRiderListInPlace(){
  if(!managerFeature('riderModule')) return;
  try{
    D.riders=await api('/api/riders?businessId='+encodeURIComponent(B));
    if(T!=='riders')return;
    const currentList=root.querySelector('.rider-admin-list');
    const currentSummary=root.querySelector('.rider-admin-summary');
    const probe=document.createElement('div');
    probe.innerHTML=riders();
    const nextList=probe.querySelector('.rider-admin-list');
    const nextSummary=probe.querySelector('.rider-admin-summary');
    if(currentList&&nextList)currentList.replaceWith(nextList);
    if(currentSummary&&nextSummary)currentSummary.replaceWith(nextSummary);
  }catch{}
}
function startManagerLiveFallback(){
  clearInterval(window.managerLiveFallback);
  if(!managerFeature('riderModule')) return;
  window.managerLiveFallback=setInterval(()=>syncRiderListInPlace(),2000);
}
async function suspendRider(id,button){
  if(!confirm('Suspend this rider? They will be signed out and cannot receive deliveries until reactivated.'))return;
  button.disabled=true;button.textContent='SUSPENDING…';
  try{
    const result=await api('/api/riders/'+id+'/suspend',{method:'POST',body:JSON.stringify({})});
    const updated=result.rider;
    D.riders=(D.riders||[]).map(r=>String(r.id)===String(id)?{...r,...updated,rider_status:'SUSPENDED',active:false,available:false}:r);
    await syncRiderListInPlace();
  }catch(x){button.disabled=false;button.textContent='SUSPEND';alert(x.message);}
}async function reactivateRider(id,button){
  button.disabled=true;button.textContent='REACTIVATING…';
  try{
    const result=await api('/api/riders/'+id+'/reactivate',{method:'POST',body:JSON.stringify({})});
    const updated=result.rider;
    D.riders=(D.riders||[]).map(r=>String(r.id)===String(id)?{...r,...updated,rider_status:'ACTIVE',active:true}:r);
    await syncRiderListInPlace();
  }catch(x){button.disabled=false;button.textContent='REACTIVATE';alert(x.message);}
}
async function renewRiderInvite(id,button){
  button.disabled=true;button.textContent='CREATING…';
  try{
    const data=await api('/api/riders/'+id+'/invite',{method:'POST',body:JSON.stringify({})});
    riderInviteResult='<div class="rider-invite-success"><span class="eyebrow">NEW INVITATION LINK</span><h3>Registration link refreshed.</h3><p>Send this link to the rider. It expires in 48 hours.</p><div class="invite-link-row"><input value="'+esc(data.signupUrl)+'" readonly><button type="button" class="btn btn-small" data-action="copyRiderInvite(this)">COPY LINK</button></div></div>';
    await (Promise.resolve()).then(()=>load());
    document.getElementById('rider-invite-panel')?.scrollIntoView({behavior:'smooth'});
  }catch(x){button.disabled=false;button.textContent='NEW INVITE LINK';alert(x.message);}
}


function receiptPreviewHtml(config){
  const c={showLogo:true,logoPosition:'CENTER',showAddress:true,showPhone:true,showPayment:true,showDelivery:true,showOrderItems:true,paperWidth:'80MM',footerText:'Thank you for ordering with us.',headerText:'RECEIPT',accentColor:'',...D.receiptConfig,...config};
  const b=D.branding||{};const primary=c.accentColor||b.primary_color||'#176b32';
  const logo=c.showLogo&&b.logo_url?'<img src="'+esc(b.logo_url)+'" style="max-width:110px;max-height:55px;object-fit:contain">':'';
  return '<div class="receipt-preview-paper" style="--receipt-brand:'+esc(primary)+';width:'+(c.paperWidth==='58MM'?'58mm':'80mm')+'"><div class="receipt-preview-head '+String(c.logoPosition||'CENTER').toLowerCase()+'">'+logo+'<strong>'+esc(b.display_name||'Restaurant')+'</strong><span>'+esc(c.headerText)+'</span>'+(c.showAddress?'<small>'+esc(b.pickup_address||'Restaurant address')+'</small>':'')+(c.showPhone&&b.mpesa_phone?'<small>'+esc(b.mpesa_phone)+'</small>':'')+'</div><div class="receipt-preview-lines"><div><span>Chicken platter × 2</span><b>KSh 2,400.00</b></div><div><span>Fresh juice × 2</span><b>KSh 560.00</b></div></div><div class="receipt-preview-details"><span>Receipt R-000001</span><span>Order SB-000001</span><span>Payment PAID</span>'+(c.showDelivery?'<span>Delivery KSh 150.00</span>':'')+'</div><div class="receipt-preview-total"><span>Total</span><b>KSh 3,110.00</b></div><div class="receipt-preview-footer">'+esc(c.footerText)+'</div></div>';
}
function receipts(){
  const c={showLogo:true,logoPosition:'CENTER',showAddress:true,showPhone:true,showPayment:true,showDelivery:true,showOrderItems:true,paperWidth:'80MM',footerText:'Thank you for ordering with us.',headerText:'RECEIPT',accentColor:'',compact:false,...D.receiptConfig};
  const paid=(D.orders||[]).filter(o=>o.payment_status==='PAID').slice(0,10);
  const check=k=>c[k]?'checked':'';
  return '<div class="manager-grid two"><section class="manager-panel"><div class="panel-title"><div><span class="eyebrow">RECEIPT STUDIO</span><h2>Restaurant-branded receipts.</h2><p>The standard receipt is already branded from the restaurant identity. Adjust the layout without changing the restaurant theme.</p></div></div><form onsubmit="saveReceiptSettings(event)" class="receipt-settings-form"><div class="form-grid"><label>Header text<input id="receipt-header" value="'+esc(c.headerText)+'"></label><label>Logo position<select id="receipt-logo-position"><option '+(c.logoPosition==='LEFT'?'selected':'')+'>LEFT</option><option '+(c.logoPosition==='CENTER'?'selected':'')+'>CENTER</option><option '+(c.logoPosition==='RIGHT'?'selected':'')+'>RIGHT</option></select></label></div><div class="form-grid"><label>Paper width<select id="receipt-paper"><option value="80MM" '+(c.paperWidth==='80MM'?'selected':'')+'>80 mm</option><option value="58MM" '+(c.paperWidth==='58MM'?'selected':'')+'>58 mm</option></select></label><label>Accent color <small>(leave blank = restaurant primary)</small><input id="receipt-accent" type="text" value="'+esc(c.accentColor||'')+'" placeholder="Auto from restaurant brand"></label></div><label>Footer message<textarea id="receipt-footer">'+esc(c.footerText)+'</textarea></label><div class="receipt-checks"><label><input id="receipt-logo" type="checkbox" '+check('showLogo')+'> Show logo</label><label><input id="receipt-address" type="checkbox" '+check('showAddress')+'> Show address</label><label><input id="receipt-phone" type="checkbox" '+check('showPhone')+'> Show restaurant phone / M-Pesa</label><label><input id="receipt-payment" type="checkbox" '+check('showPayment')+'> Show payment method</label><label><input id="receipt-delivery" type="checkbox" '+check('showDelivery')+'> Show delivery fee</label><label><input id="receipt-items" type="checkbox" '+check('showOrderItems')+'> Show item breakdown</label></div><button class="btn wide">SAVE RECEIPT DESIGN</button></form></section><section class="manager-panel"><div class="panel-title"><div><span class="eyebrow">LIVE PREVIEW</span><h2>Standard receipt</h2><p>This is how a new receipt starts before you customize it.</p></div></div><div class="receipt-preview-wrap">'+receiptPreviewHtml(c)+'</div></section></div><section class="manager-panel"><div class="panel-title"><div><span class="eyebrow">GENERATED RECEIPTS</span><h2>Paid orders</h2><p>Open a printable receipt or copy the secure customer receipt link.</p></div></div>'+(paid.length?paid.map(o=>'<div class="receipt-order-row"><div><b>'+esc(o.order_number)+'</b><span>'+esc(o.name||'Customer')+' · '+money(o.total)+'</span></div><div class="button-row"><button class="btn btn-small" data-action="openReceipt(\''+o.id+'\')">OPEN / PRINT</button><button class="btn btn-small secondary" data-action="copyReceiptLink(\''+o.id+'\',this)">COPY CUSTOMER LINK</button></div></div>').join(''):'<div class="empty-state">No paid orders yet. Once the first payment is confirmed, its branded receipt will appear here.</div>')+'</section>';
}
async function saveReceiptSettings(e){e.preventDefault();const cfg={showLogo:document.getElementById('receipt-logo').checked,logoPosition:document.getElementById('receipt-logo-position').value,showAddress:document.getElementById('receipt-address').checked,showPhone:document.getElementById('receipt-phone').checked,showPayment:document.getElementById('receipt-payment').checked,showDelivery:document.getElementById('receipt-delivery').checked,showOrderItems:document.getElementById('receipt-items').checked,paperWidth:document.getElementById('receipt-paper').value,footerText:document.getElementById('receipt-footer').value,headerText:document.getElementById('receipt-header').value,accentColor:document.getElementById('receipt-accent').value,compact:false};try{await api('/api/manager/receipt-settings',{method:'PATCH',body:JSON.stringify(cfg)});D.receiptConfig=cfg;T='receipts';render();}catch(x){alert(x.message||'Could not save receipt design.')}}
async function openReceipt(id){try{const d=await api('/api/manager/receipts/'+encodeURIComponent(id));const w=window.open('about:blank','_blank');if(!w){alert('Allow pop-ups for the manager dashboard to print receipts.');return;}w.document.open();w.document.write(d.html);w.document.close();}catch(x){alert(x.message||'Could not generate receipt.')}}
async function copyReceiptLink(id,button){const old=button.textContent;try{const d=await api('/api/manager/receipts/'+encodeURIComponent(id));const token=d.receipt?.receipt_access_token;if(!token)throw new Error('Receipt link is not ready yet.');await navigator.clipboard.writeText(API_BASE_URL+'/api/receipts/public/'+encodeURIComponent(token)+'/html');button.textContent='COPIED ✓';setTimeout(()=>button.textContent=old,1600);}catch(x){button.textContent='FAILED';setTimeout(()=>button.textContent=old,1600);alert(x.message||'Could not copy receipt link.')}}
function station(){
  const stations=D.stations||[];
  return '<div class="manager-grid two"><section class="manager-panel"><div class="panel-title"><div><span class="eyebrow">CONNECTED DEVICES</span><h2>Order-control stations</h2><p>Each device gets a restricted station session. It cannot open the manager dashboard.</p></div><button class="btn" data-action="connectDeviceForm()">＋ CONNECT DEVICE</button></div>'+
    (stations.map(s=>'<article class="device-card '+(s.active?'':'device-off')+'"><div><div class="device-icon">▣</div><div><b>'+esc(s.name)+'</b><span>'+esc(s.device_type)+' · '+esc(s.mode)+'</span><small>'+(s.active?'Last seen '+new Date(s.last_seen_at).toLocaleString('en-KE'):'DISCONNECTED')+'</small></div></div><div class="button-row">'+(s.active?'<button class="btn btn-small" data-action="pairDevice(&quot;'+s.id+'&quot;)">PAIR / SHOW QR</button><button class="btn btn-small secondary" data-action="revokeDevice(&quot;'+s.id+'&quot;)">DISCONNECT</button>':'<button class="btn btn-small" data-action="reactivateDevice(&quot;'+s.id+'&quot;)">REACTIVATE</button>')+'</div></article>').join('')||'<div class="empty-state">No order-control devices connected yet.</div>')+
  '</section><section class="manager-panel" id="station-create-panel"><div class="panel-title"><div><span class="eyebrow">DEVICE MODES</span><h2>Restricted access</h2><p>Choose a mode for each connected screen.</p></div></div><div class="station-help"><article><b>OPERATIONS</b><span>Accept paid orders and dispatch riders.</span></article><article><b>KITCHEN</b><span>Incoming/preparation display without manager controls.</span></article><article><b>COUNTER</b><span>Compact accept and dispatch workflow.</span></article><article><b>DISPLAY</b><span>Large read-only order board.</span></article></div></section></div>';
}
function connectDeviceForm(){
  const panel=document.getElementById('station-create-panel');
  if(!panel)return;
  panel.innerHTML='<div class="panel-title"><div><span class="eyebrow">NEW DEVICE</span><h2>Connect an order-control screen</h2><p>Create the station here, then scan the QR on the target device.</p></div></div><form onsubmit="createAndPairDevice(event)" class="station-form"><label>Station name<input id="sn" required placeholder="Main Counter"></label><label>Device<select id="sd">'+['PHONE','TABLET','PC','LAPTOP','TV','BOARD'].map(x=>'<option>'+x+'</option>').join('')+'</select></label><label>Mode<select id="sm">'+['OPERATIONS','KITCHEN','COUNTER','DISPLAY'].map(x=>'<option>'+x+'</option>').join('')+'</select></label><button class="btn">CREATE & SHOW QR</button></form><button class="btn btn-small secondary" data-action="T=\'station\';render()">CANCEL</button>';
  panel.scrollIntoView({behavior:'smooth'});
}
async function createAndPairDevice(e){
  e.preventDefault();const g=id=>document.getElementById(id).value;
  try{const s=await api('/api/stations',{method:'POST',body:JSON.stringify({businessId:B,name:g('sn').trim()||'Restaurant station',deviceType:g('sd'),mode:g('sm')})});await pairDevice(s.id);}
  catch(x){alert(x.message);}
}
async function pairDevice(id){
  try{const p=await api('/api/stations/'+id+'/pairing-token',{method:'POST',body:JSON.stringify({})});showPairingQR(p);}
  catch(x){alert(x.message);}
}
async function copyConnectionLink(url,button){
  if(!url)return;
  const original=button?.textContent||'COPY CONNECTION LINK';
  try{
    if(navigator.clipboard&&window.isSecureContext){
      await navigator.clipboard.writeText(url);
    }else{
      const ta=document.createElement('textarea');
      ta.value=url;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.opacity='0';ta.style.pointerEvents='none';
      document.body.appendChild(ta);ta.focus();ta.select();
      const ok=document.execCommand('copy');
      ta.remove();
      if(!ok)throw new Error('Copy command was blocked');
    }
    if(button){button.textContent='COPIED ✓';button.classList.add('done');setTimeout(()=>{button.textContent=original;button.classList.remove('done')},1800);}
  }catch(e){
    if(button)button.textContent='COPY FAILED';
    alert('The connection link could not be copied automatically. Please select and copy the link shown above.');
    setTimeout(()=>{if(button){button.textContent=original;button.classList.remove('done')}},1800);
  }
}
function showPairingQR(p){
  const wrap=document.createElement('div');
  wrap.className='qr-modal';
  wrap.innerHTML='<div class="qr-card"><button class="qr-close" data-action="this.closest(&quot;.qr-modal&quot;).remove()">×</button><span class="eyebrow">CONNECT DEVICE</span><h2>Scan this QR code</h2><p>This code expires in <b>5 minutes</b> and can be used once.</p><div class="qr-box"><img id="pair-qr" alt="Scan to connect this order-control device"></div><div class="pair-url" id="pair-url">'+esc(p.connectUrl)+'</div><button type="button" class="btn secondary" id="copy-connection-link">COPY CONNECTION LINK</button></div>';
  document.body.appendChild(wrap);
  const copyButton=document.getElementById('copy-connection-link');
  if(copyButton)copyButton.addEventListener('click',()=>copyConnectionLink(p.connectUrl,copyButton));
  const qr=document.getElementById('pair-qr');
  if(qr&&p.qrDataUrl)qr.src=p.qrDataUrl;
  else if(qr)qr.alt='QR code could not be generated. Use the connection link below.';
}
async function revokeDevice(id){if(!confirm('Disconnect this order-control device?'))return;try{await api('/api/stations/'+id+'/revoke',{method:'POST',body:JSON.stringify({})});await (Promise.resolve()).then(()=>load());}catch(x){alert(x.message)}}
async function reactivateDevice(id){try{await api('/api/stations/'+id+'/reactivate',{method:'POST',body:JSON.stringify({})});await (Promise.resolve()).then(()=>load());}catch(x){alert(x.message)}}

(Promise.resolve()).then(()=>load());