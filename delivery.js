const RIDER_TOKEN_KEY='rider_session_token';
const RIDER_BUSINESS_ID=BUSINESS_ID;
let rider=null,lastTripId=null,pollTimer=null,riderEvents=null;

function riderHeaders(){const token=localStorage.getItem(RIDER_TOKEN_KEY);return token?{'Authorization':'Bearer '+token}:{};}
async function riderApi(path,options={}){return apiRequest(path,{...options,headers:{...riderHeaders(),...(options.headers||{})}});}
function clearRiderSession(){localStorage.removeItem(RIDER_TOKEN_KEY);rider=null;}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function riderMoney(v){return 'KSh '+Number(v||0).toLocaleString();}
function mapsUrl(origin,destination){return 'https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(origin||'')+'&destination='+encodeURIComponent(destination||'')+'&travelmode=driving';}

async function loginRider(e){
  e?.preventDefault();
  const phone=document.getElementById('rider-phone').value.trim(),password=document.getElementById('rider-password').value;
  const error=document.getElementById('rider-login-error'),button=document.getElementById('rider-login-btn');
  error.classList.remove('hidden');error.textContent='Signing in…';button.disabled=true;button.textContent='SIGNING IN…';
  try{
    const data=await riderApi('/api/riders/login',{method:'POST',body:JSON.stringify({businessId:RIDER_BUSINESS_ID,phone,password})});
    localStorage.setItem(RIDER_TOKEN_KEY,data.token);rider=data.rider;await bootRider();
  }catch(err){
    error.textContent=err.message||'Could not sign in.';
    button.disabled=false;button.textContent='SIGN IN';
  }
}
function toggleRiderPassword(){
  const input=document.getElementById('rider-password'),button=document.getElementById('rider-password-toggle');
  if(!input||!button)return;
  input.type=input.type==='password'?'text':'password';
  button.textContent=input.type==='password'?'SHOW':'HIDE';
}

async function logoutRider(){try{await riderApi('/api/riders/logout',{method:'POST'});}catch{}clearRiderSession();location.reload();}
function toggleOnline(){
  const button=document.getElementById('online-button');
  const online=Boolean(button && button.classList.contains('is-online'));
  setOnline(!online);
}
async function setOnline(online){
  const button=document.getElementById('online-button');
  if(button){button.disabled=true;button.textContent=online?'GOING ONLINE…':'GOING OFFLINE…';}
  try{
    if(online) await requestNotifications();
    const data=await riderApi('/api/riders/'+encodeURIComponent(rider.id)+'/presence',{method:'POST',body:JSON.stringify({online})});
    updateOnlineButton(Boolean(data.online));
    await loadRiderDashboard();
  }catch(err){
    updateOnlineButton(!online);
    alert(err.message||'Could not update availability.');
  }
}
function updateOnlineButton(online){
  const button=document.getElementById('online-button');
  const dot=document.getElementById('rider-presence-dot');
  const text=document.getElementById('rider-presence-text');
  if(button){
    button.classList.toggle('is-online',online);
    button.classList.toggle('is-offline',!online);
    button.textContent=online?'GO OFFLINE':'GO ONLINE';
    button.setAttribute('aria-pressed',String(online));
    button.title=online?'Press to stop receiving delivery assignments':'Press to tell the restaurant you are available for deliveries';
  }
  if(dot)dot.classList.toggle('is-online',online);
  if(dot)dot.classList.toggle('is-offline',!online);
  if(text)text.textContent=online?'ONLINE':'OFFLINE';
}
async function dashboardData(){return riderApi('/api/riders/'+encodeURIComponent(rider.id)+'/dashboard');}
async function acceptTrip(tripId){try{await riderApi('/api/riders/'+encodeURIComponent(rider.id)+'/deliveries/'+encodeURIComponent(tripId)+'/accept',{method:'POST',body:JSON.stringify({})});await loadRiderDashboard();}catch(err){alert(err.message||'Could not accept delivery.');}}
async function setTripStatus(tripId,status){
  const route={ARRIVED_AT_RESTAURANT:'arrived',PICKED_UP:'picked-up',ON_THE_WAY:'on-the-way'}[status];
  if(!route)return;
  try{await riderApi('/api/riders/'+encodeURIComponent(rider.id)+'/deliveries/'+encodeURIComponent(tripId)+'/'+route,{method:'POST',body:JSON.stringify({})});await loadRiderDashboard();}catch(err){alert(err.message||'Could not update delivery.');}
}
function maybeNotify(job){
  if(!job||job.id===lastTripId)return;
  lastTripId=job.id;
  if('Notification' in window&&Notification.permission==='granted') new Notification('New delivery assignment',{body:job.order_number+' · '+job.customer_name});
}
async function requestNotifications(){if('Notification' in window&&Notification.permission==='default')try{await Notification.requestPermission();}catch{}}
function statusSteps(current){
  const steps=['ASSIGNED','ACCEPTED','ARRIVED_AT_RESTAURANT','PICKED_UP','ON_THE_WAY','DELIVERED'];
  const index=steps.indexOf(current);
  return '<div class="timeline-mini">'+steps.map((s,i)=>'<span class="'+(i<=index?'active':'')+'">'+s.replaceAll('_',' ')+'</span>').join('')+'</div>';
}
function activeCard(a){
  if(!a)return '<div class="empty" style="padding:30px 10px"><h3>No active delivery.</h3><p>When the restaurant assigns a job to you, it will appear here.</p></div>';
  const current=(a.delivery_status||'ASSIGNED');
  let action='';
  if(current==='ASSIGNED') action='<button onclick="acceptTrip(\''+a.trip_id+'\')">ACCEPT DELIVERY</button>';
  else if(current==='ACCEPTED') action='<button onclick="setTripStatus(\''+a.trip_id+'\',\'ARRIVED_AT_RESTAURANT\')">ARRIVED AT RESTAURANT</button>';
  else if(current==='ARRIVED_AT_RESTAURANT') action='<button onclick="setTripStatus(\''+a.trip_id+'\',\'PICKED_UP\')">PICKED UP</button>';
  else if(current==='PICKED_UP') action='<button onclick="setTripStatus(\''+a.trip_id+'\',\'ON_THE_WAY\')">ON THE WAY</button>';
  else if(current==='ON_THE_WAY') action='<button onclick="setTripStatus(\''+a.trip_id+'\',\'DELIVERED\')">MARK DELIVERED</button>';
  return '<article class="rider-card"><h3>'+esc(a.order_number)+' · '+esc(a.customer_name)+'</h3><div class="rider-meta"><span>'+esc(a.pickup_address||'Restaurant')+'</span><span>→</span><span>'+esc(a.delivery_address||a.delivery_note||'Customer location')+'</span></div>'+statusSteps(current)+'<p><strong>Customer:</strong> '+esc(a.customer_name)+' · '+esc(a.phone||'')+'</p><p><strong>Order:</strong> '+esc(a.order_number)+' · <strong>Delivery fee:</strong> '+riderMoney(a.delivery_fee)+'</p><p><strong>Distance:</strong> '+(Number(a.route_distance_meters||0)/1000).toFixed(1)+' km</p><div class="rider-actions">'+action+' <a href="'+mapsUrl(a.pickup_address,a.delivery_address)+'" target="_blank" rel="noopener">OPEN GOOGLE MAPS</a></div></article>';
}
function renderAvailable(list){
  if(!list.length)return '<p class="muted">No new assignments.</p>';
  return list.map(a=>'<article class="rider-card"><h3>'+esc(a.order_number)+' · '+esc(a.restaurant_name)+'</h3><div class="rider-meta"><span>Customer: '+esc(a.customer_name)+'</span><span>'+esc(a.delivery_address||'Location pending')+'</span></div><p>'+Number(a.route_distance_meters||0)/1000+' km · '+riderMoney(a.delivery_fee)+' delivery fee</p></article>').join('');
}
function renderHistory(list){
  if(!list.length)return '<p class="muted">No completed deliveries yet.</p>';
  return list.slice(0,20).map(a=>'<div class="summary-row"><span><strong>'+esc(a.order_number)+'</strong><small style="display:block">'+esc(a.delivery_address||'')+' · '+(Number(a.distance_meters||0)/1000).toFixed(1)+' km</small></span><strong>'+riderMoney(a.earning)+'</strong></div>').join('');
}
async function loadRiderDashboard(){
  const data=await dashboardData();maybeNotify(data.active);
  updateOnlineButton(Boolean(data.online));
  document.getElementById('rider-stats').innerHTML='<div class="rider-stat"><span class="muted">Today</span><strong>'+riderMoney(data.todayEarnings)+'</strong><small>Earnings</small></div><div class="rider-stat"><span class="muted">This week</span><strong>'+riderMoney(data.weekEarnings)+'</strong><small>Earnings</small></div><div class="rider-stat"><span class="muted">Completed</span><strong>'+data.completed.length+'</strong><small>Recent trips</small></div>';
  document.getElementById('available-deliveries').innerHTML=renderAvailable(data.available);
  document.getElementById('active-delivery').innerHTML=activeCard(data.active);
  document.getElementById('earnings-summary').innerHTML='<div class="summary-row"><span>Today</span><strong>'+riderMoney(data.todayEarnings)+'</strong></div><div class="summary-row"><span>7 days</span><strong>'+riderMoney(data.weekEarnings)+'</strong></div><p class="muted">Delivery fee is recorded as rider earnings and released on successful delivery.</p>';
  document.getElementById('delivery-history').innerHTML=renderHistory(data.completed);
}
async function bootRider(){
  try{
    rider=await riderApi('/api/riders/me');
    document.getElementById('rider-login').classList.add('hidden');document.getElementById('rider-app').classList.remove('hidden');
    document.getElementById('rider-header').innerHTML='<div class="rider-identity-card"><div class="rider-presence-indicator"><span id="rider-presence-dot" class="presence-dot is-offline"></span><span id="rider-presence-text">OFFLINE</span></div><div class="rider-profile-line">'+(rider.profile_image_url?'<img src="'+esc(rider.profile_image_url)+'" alt="">':'<span class="rider-profile-fallback">'+esc((rider.name||'?')[0])+'</span>')+'<div><p class="eyebrow">RIDER OPERATIONS</p><h1>'+esc(rider.name)+'</h1><p class="muted">'+esc(rider.vehicle_type)+' · '+esc(rider.number_plate||'Plate not set')+' · '+esc(rider.payout_phone||rider.phone)+'</p></div></div><div class="rider-availability"><span class="availability-label">DELIVERY AVAILABILITY</span><button id="online-button" class="availability-button is-offline" type="button" aria-pressed="false" onclick="toggleOnline()" title="Press to change your delivery availability">GO ONLINE</button><p>Go online when you are ready to receive delivery assignments.</p></div></div>';
    await loadRiderDashboard();startRiderRealtime();
    clearInterval(pollTimer);pollTimer=setInterval(()=>loadRiderDashboard().catch(()=>{}),30000);
  }catch(err){clearRiderSession();document.getElementById('rider-login-error').classList.remove('hidden');document.getElementById('rider-login-error').textContent=err.message||'Rider session expired.';}
}
function startRiderRealtime(){
  if(riderEvents||!rider)return;
  const token=localStorage.getItem(RIDER_TOKEN_KEY);
  if(!token)return;
  const connect=()=>{
    if(!rider)return;
    riderEvents=new EventSource(API_BASE_URL+'/api/riders/events?businessId='+encodeURIComponent(RIDER_BUSINESS_ID)+'&riderToken='+encodeURIComponent(token));
    const refresh=()=>loadRiderDashboard().catch(()=>{});
    ['rider.updated','order.updated','delivery.updated'].forEach(name=>riderEvents.addEventListener(name,e=>{
      try{
        const d=JSON.parse(e.data||'{}');
        if(d.action==='SUSPENDED'){clearRiderSession();location.reload();return;}
        refresh();
      }catch{refresh();}
    }));
    riderEvents.onerror=()=>{if(riderEvents){riderEvents.close();riderEvents=null;}setTimeout(connect,3000);};
  };
  connect();
}
bootRider();
