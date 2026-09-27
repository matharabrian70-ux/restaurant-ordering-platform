const RIDER_TOKEN_KEY='rider_session_token';
const RIDER_BUSINESS_ID=BUSINESS_ID;
let rider=null,lastTripId=null,pollTimer=null,riderEvents=null,riderLiveSyncBusy=false,availabilityActionVersion=0,riderDashboardInitialized=false,riderAudioContext=null,riderMap=null,riderMapTripId=null,riderMapWatchId=null,riderMapRouteLayer=null,riderMapRiderMarker=null,riderMapReady=false,lastActiveRenderKey='';

function riderHeaders(){const token=sessionStorage.getItem(RIDER_TOKEN_KEY);return token?{'Authorization':'Bearer '+token}:{};}
async function riderApi(path,options={}){return apiRequest(path,{...options,headers:{...riderHeaders(),...(options.headers||{})}});}
function clearRiderSession(){sessionStorage.removeItem(RIDER_TOKEN_KEY);localStorage.removeItem(RIDER_TOKEN_KEY);rider=null;}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function riderMoney(v){return 'KSh '+Number(v||0).toLocaleString();}
async function loadLeaflet(){
  if(window.L)return window.L;
  if(!document.getElementById('leaflet-css')){
    const css=document.createElement('link');css.id='leaflet-css';css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.appendChild(css);
  }
  await new Promise((resolve,reject)=>{
    const existing=document.getElementById('leaflet-js');
    if(existing){existing.addEventListener('load',resolve,{once:true});if(window.L)resolve();return;}
    const script=document.createElement('script');script.id='leaflet-js';script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';script.onload=resolve;script.onerror=reject;document.head.appendChild(script);
  });
  return window.L;
}
function decodeGooglePolyline(encoded){
  const points=[];let index=0,lat=0,lng=0;
  while(index<encoded.length){
    let shift=0,result=0,b;
    do{b=encoded.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32);
    lat+=result&1?~(result>>1):result>>1;
    shift=0;result=0;
    do{b=encoded.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32);
    lng+=result&1?~(result>>1):result>>1;
    points.push([lat/1e5,lng/1e5]);
  }
  return points;
}
async function publishRiderLocation(pos,tripId){
  if(!rider||!tripId||riderLocationSending)return;
  const now=Date.now();
  const lat=Number(pos.coords.latitude),lng=Number(pos.coords.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
  const previous=riderLocationLastPoint;
  const movedEnough=!previous||Math.abs(previous.lat-lat)+Math.abs(previous.lng-lng)>0.00012;
  if(riderLocationTripId===tripId&&!movedEnough&&now-riderLocationLastSentAt<5000)return;
  riderLocationSending=true;
  try{
    await riderApi('/api/riders/'+encodeURIComponent(rider.id)+'/deliveries/'+encodeURIComponent(tripId)+'/location',{
      method:'POST',
      body:JSON.stringify({
        latitude:lat,longitude:lng,
        accuracy:Number.isFinite(Number(pos.coords.accuracy))?Number(pos.coords.accuracy):null,
        heading:Number.isFinite(Number(pos.coords.heading))?Number(pos.coords.heading):null,
        speed:Number.isFinite(Number(pos.coords.speed))?Number(pos.coords.speed):null
      })
    });
    riderLocationLastSentAt=now;
    riderLocationLastPoint={lat,lng};
    riderLocationTripId=tripId;
  }catch{}
  finally{riderLocationSending=false;}
}
function stopRiderMapTracking(){
  if(riderMapWatchId!==null&&navigator.geolocation){navigator.geolocation.clearWatch(riderMapWatchId);}
  riderMapWatchId=null;
  riderLocationLastPoint=null;
  riderLocationTripId=null;
  riderLocationLastSentAt=0;
}
function destroyRiderMap(){
  setRiderMapFullscreen(false);
  stopRiderMapTracking();
  if(riderMap){try{riderMap.remove();}catch{}}
  riderMap=null;riderMapTripId=null;riderMapRouteLayer=null;riderMapRiderMarker=null;riderMapReady=false;
}
function riderMapStatus(text,live=false){
  const el=document.getElementById('rider-live-map-status');if(el){el.textContent=text;el.classList.toggle('is-live',live);}
}
function setRiderMapFullscreen(fullscreen){
  const panel=document.getElementById('rider-live-route-panel');if(!panel)return;
  panel.classList.toggle('is-fullscreen',fullscreen);
  document.body.classList.toggle('rider-map-fullscreen-open',fullscreen);
  const button=document.getElementById('rider-map-fullscreen-button');
  if(button)button.textContent=fullscreen?'×':'⛶';
  const floating=document.getElementById('rider-map-floating-exit');
  if(floating)floating.setAttribute('aria-label',fullscreen?'Exit full screen map':'Open full screen map');
  if(riderMap)setTimeout(()=>riderMap.invalidateSize(),80);
}
function toggleRiderMapFullscreen(){setRiderMapFullscreen(!document.getElementById('rider-live-route-panel')?.classList.contains('is-fullscreen'));}
function exitRiderMapFullscreen(){setRiderMapFullscreen(false);}

function bindRiderMapFullscreen(){
  const map=document.getElementById('rider-live-map');
  if(map&&!map.dataset.fullscreenBound){
    map.dataset.fullscreenBound='1';
    map.addEventListener('dblclick',()=>toggleRiderMapFullscreen());
  }
}
function startRiderLocationTracking(L){
  if(!navigator.geolocation){riderMapStatus('LOCATION UNAVAILABLE');return;}
  stopRiderMapTracking();
  riderMapStatus('REQUESTING LIVE LOCATION…');
  riderMapWatchId=navigator.geolocation.watchPosition(pos=>{
    if(!riderMap)return;
    const point=[pos.coords.latitude,pos.coords.longitude];
    publishRiderLocation(pos,riderMapTripId);
    if(!riderMapRiderMarker){
      riderMapRiderMarker=L.marker(point,{title:'Your live location'}).addTo(riderMap);
      riderMapRiderMarker.bindPopup('<strong>You are here</strong><br>Live rider location');
    }else riderMapRiderMarker.setLatLng(point);
    riderMapStatus('LIVE LOCATION',true);
  },()=>riderMapStatus('ROUTE READY · LOCATION PERMISSION NEEDED'),{enableHighAccuracy:true,maximumAge:3000,timeout:10000});
}
async function renderLiveRouteMap(job){
  const panel=document.getElementById('rider-live-route-panel');
  if(!panel||!job||!job.trip_id||job.delivery_status==='ASSIGNED'){destroyRiderMap();return;}
  if(riderMapTripId===job.trip_id&&riderMapReady)return;
  destroyRiderMap();
  panel.classList.remove('hidden');
  riderMapTripId=job.trip_id;
  riderMapStatus('BUILDING LIVE ROUTE…');
  try{
    const L=await loadLeaflet();
    const data=await riderApi('/api/riders/'+encodeURIComponent(rider.id)+'/deliveries/'+encodeURIComponent(job.trip_id)+'/route');
    const points=decodeGooglePolyline(data.encodedPolyline||'');
    const map=L.map('rider-live-map',{zoomControl:true,attributionControl:true});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
    riderMap=map;
    riderMapRouteLayer=points.length?L.polyline(points,{weight:6,opacity:.9}).addTo(map):null;
    if(points.length){
      L.marker(points[0],{title:'Restaurant pickup'}).addTo(map).bindPopup('<strong>Pickup</strong><br>'+esc(data.pickup?.address||'Restaurant'));
      L.marker(points[points.length-1],{title:'Customer destination'}).addTo(map).bindPopup('<strong>Delivery</strong><br>'+esc(data.destination?.address||'Customer'));
      map.fitBounds(riderMapRouteLayer.getBounds(),{padding:[30,30]});
    }
    riderMapReady=true;
    bindRiderMapFullscreen();
    riderMapStatus('LIVE ROUTE · '+(Number(data.distanceMeters||0)/1000).toFixed(1)+' KM · '+Math.round(Number(data.durationSeconds||0)/60)+' MIN',false);
    startRiderLocationTracking(L);
  }catch(err){
    riderMapStatus(err.message||'Unable to load live route');
    riderMapTripId=null;
  }
}
function interpolateGeoPoint(a,b,t){return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];}
function bearingBetween(a,b){
  const y=Math.sin((b[1]-a[1])*Math.PI/180)*Math.cos(b[0]*Math.PI/180);
  const x=Math.cos(a[0]*Math.PI/180)*Math.sin(b[0]*Math.PI/180)-Math.sin(a[0]*Math.PI/180)*Math.cos(b[0]*Math.PI/180)*Math.cos((b[1]-a[1])*Math.PI/180);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}
let riderDemoTimer=null;
async function startDemoTracking(){
  const panel=document.getElementById('rider-live-route-panel');
  if(!panel)return;
  const L=await loadLeaflet();
  if(riderDemoTimer)clearInterval(riderDemoTimer);
  destroyRiderMap();panel.classList.add('hidden');
  const overlay=document.createElement('div');overlay.id='rider-demo-map-overlay';overlay.className='rider-demo-map-overlay';
  overlay.innerHTML='<div class="rider-demo-map-head"><div><span class="eyebrow">DEMO TRACKING</span><strong>Road-following rider simulation</strong><small>Real routed example · no real order is affected</small></div><button type="button" onclick="stopDemoTracking()" aria-label="Close demo">×</button></div><div class="rider-demo-status" id="rider-demo-status">BUILDING ROAD ROUTE…</div><div id="rider-demo-map" class="rider-demo-map"></div><button type="button" class="rider-demo-exit" onclick="stopDemoTracking()">EXIT DEMO</button>';
  document.body.appendChild(overlay);
  try{
    const data=await riderApi('/api/riders/'+encodeURIComponent(rider.id)+'/demo-route');
    const points=decodeGooglePolyline(data.encodedPolyline||'');
    if(points.length<2)throw new Error('The demo route did not contain enough road points.');
    const map=L.map('rider-demo-map',{zoomControl:true,attributionControl:true});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
    const route=L.polyline(points,{weight:6,opacity:.85}).addTo(map);
    const traveled=L.polyline([points[0]],{weight:7,opacity:.95}).addTo(map);
    L.marker(points[0],{title:'Demo pickup'}).addTo(map).bindPopup('<strong>Demo pickup</strong><br>'+esc(data.pickup));
    L.marker(points[points.length-1],{title:'Demo delivery'}).addTo(map).bindPopup('<strong>Demo delivery</strong><br>'+esc(data.destination));
    const riderIcon=L.divIcon({className:'rider-demo-rider-icon',html:'<span>➤</span>',iconSize:[34,34],iconAnchor:[17,17]});
    const marker=L.marker(points[0],{title:'Simulated rider',icon:riderIcon}).addTo(map);
    map.fitBounds(route.getBounds(),{padding:[30,30]});
    let segment=0,progress=0,last=points[0],ticks=0,total=points.length-1;
    riderDemoTimer=setInterval(()=>{
      const a=points[segment],b=points[Math.min(segment+1,total)];
      progress+=.06;
      if(progress>=1){progress=0;segment++;if(segment>=total){segment=0;traveled.setLatLngs([points[0]]);last=points[0];}}
      const p=interpolateGeoPoint(points[segment],points[Math.min(segment+1,total)],progress);
      marker.setLatLng(p);traveled.addLatLng(p);
      const el=marker.getElement()?.querySelector('span');if(el)el.style.transform='rotate('+bearingBetween(last,p)+'deg)';
      last=p;ticks++;
      const status=document.getElementById('rider-demo-status');
      if(status)status.textContent='LIVE SIMULATION · FOLLOWING ROAD ROUTE · '+Math.round(((segment+progress)/total)*100)+'%';
      map.panTo(p,{animate:true,duration:.15,noMoveStart:true});
    },180);
  }catch(err){
    const status=document.getElementById('rider-demo-status');if(status)status.textContent=err.message||'Unable to build demo road route';
  }
}
function stopDemoTracking(){
  if(riderDemoTimer)clearInterval(riderDemoTimer);
  riderDemoTimer=null;document.getElementById('rider-demo-map-overlay')?.remove();
  const panel=document.getElementById('rider-live-route-panel'),active=window.__riderDashboardData?.active;
  if(panel&&active&&active.delivery_status!=='ASSIGNED'){panel.classList.remove('hidden');renderLiveRouteMap(active);}
}

function mapsUrl(origin,destination){return 'https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(origin||'')+'&destination='+encodeURIComponent(destination||'')+'&travelmode=two-wheeler&dir_action=navigate';}
function unlockRiderAudio(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;if(!riderAudioContext)riderAudioContext=new C();if(riderAudioContext.state==='suspended')riderAudioContext.resume().catch(()=>{});}catch{}}
function playAssignmentSound(){try{unlockRiderAudio();if(!riderAudioContext)return;const now=riderAudioContext.currentTime;[0,0.16].forEach((offset,i)=>{const osc=riderAudioContext.createOscillator(),gain=riderAudioContext.createGain();osc.type='sine';osc.frequency.value=i?880:660;gain.gain.setValueAtTime(0.0001,now+offset);gain.gain.exponentialRampToValueAtTime(0.16,now+offset+0.02);gain.gain.exponentialRampToValueAtTime(0.0001,now+offset+0.13);osc.connect(gain);gain.connect(riderAudioContext.destination);osc.start(now+offset);osc.stop(now+offset+0.15);});}catch{}}
function showDeliveryAssignmentPopup(job){
  document.getElementById('rider-assignment-popup')?.remove();
  const el=document.createElement('div');el.id='rider-assignment-popup';el.className='rider-assignment-popup';
  el.innerHTML='<section class="rider-assignment-card" role="dialog" aria-modal="true" aria-label="New delivery assignment">'+
    '<div class="rider-assignment-top"><div><span class="eyebrow">NEW DELIVERY ASSIGNMENT</span><h2>New order ready</h2></div><span class="rider-assignment-live"><i></i> LIVE</span></div>'+
    '<div class="rider-assignment-order"><strong>'+esc(job.order_number)+'</strong><span>'+esc(job.restaurant_name||'Restaurant')+'</span></div>'+
    '<div class="rider-assignment-grid"><div><small>CUSTOMER</small><strong>'+esc(job.customer_name||'Customer')+'</strong></div><div><small>DELIVERY FEE</small><strong>'+riderMoney(job.delivery_fee)+'</strong></div><div><small>DISTANCE</small><strong>'+((Number(job.route_distance_meters||0)/1000).toFixed(1))+' km</strong></div><div><small>ETA</small><strong>'+((Number(job.route_duration_seconds||0)/60).toFixed(0))+' min</strong></div></div>'+
    '<div class="rider-assignment-route"><div><span class="route-dot pickup"></span><div><small>PICK UP</small><strong>'+esc(job.pickup_address||job.restaurant_name||'Restaurant')+'</strong></div></div><div class="route-line"></div><div><span class="route-dot dropoff"></span><div><small>DELIVER TO</small><strong>'+esc(job.delivery_address||'Customer location')+'</strong></div></div></div>'+
    '<div class="rider-assignment-actions"><button type="button" class="rider-assignment-decline" onclick="declineAssignmentPopup(\''+esc(job.trip_id||'')+'\')">DECLINE</button><button type="button" class="rider-assignment-accept" onclick="acceptAssignmentPopup(\''+esc(job.trip_id||'')+'\')">ACCEPT ORDER</button></div>'+
    '</section>';
  document.body.appendChild(el);playAssignmentSound();
}
function closeAssignmentPopup(){document.getElementById('rider-assignment-popup')?.remove();}
async function declineAssignmentPopup(tripId){
  if(!tripId)return;
  if(!confirm('Decline this delivery assignment? It will be returned to the restaurant for reassignment.'))return;
  const button=document.querySelector('.rider-assignment-decline');
  if(button){button.disabled=true;button.textContent='DECLINING…';}
  try{
    await riderApi('/api/riders/'+encodeURIComponent(rider.id)+'/deliveries/'+encodeURIComponent(tripId)+'/decline',{method:'POST',body:JSON.stringify({})});
    closeAssignmentPopup();
    await loadRiderDashboard();
  }catch(err){
    if(button){button.disabled=false;button.textContent='DECLINE';}
    alert(err.message||'Could not decline delivery.');
  }
}

async function acceptAssignmentPopup(tripId){
  const button=document.querySelector('.rider-assignment-accept');if(button){button.disabled=true;button.textContent='ACCEPTING…';}
  try{await riderApi('/api/riders/'+encodeURIComponent(rider.id)+'/deliveries/'+encodeURIComponent(tripId)+'/accept',{method:'POST',body:JSON.stringify({})});
    const data=await dashboardData();window.__riderDashboardData=data;closeAssignmentPopup();renderRiderStats(data);document.getElementById('available-deliveries').innerHTML=renderAvailable(data.available);document.getElementById('active-delivery').innerHTML=activeCard(data.active);showAcceptedRoutePopup(data.active);
  }catch(err){if(button){button.disabled=false;button.textContent='ACCEPT ORDER';}alert(err.message||'Could not accept delivery.');}
}
function showAcceptedRoutePopup(job){
  if(!job)return;document.getElementById('rider-assignment-popup')?.remove();
  const el=document.createElement('div');el.id='rider-assignment-popup';el.className='rider-assignment-popup';
  el.innerHTML='<section class="rider-assignment-card accepted" role="dialog" aria-label="Delivery accepted">'+
    '<div class="rider-assignment-top"><div><span class="eyebrow">DELIVERY ACCEPTED</span><h2>You are on this order.</h2></div><span class="rider-assignment-check">✓</span></div>'+
    '<div class="rider-assignment-order"><strong>'+esc(job.order_number)+'</strong><span>'+esc(job.restaurant_name||'Restaurant')+'</span></div>'+
    '<div class="rider-assignment-route"><div><span class="route-dot pickup"></span><div><small>PICK UP</small><strong>'+esc(job.pickup_address||job.restaurant_name||'Restaurant')+'</strong></div></div><div class="route-line"></div><div><span class="route-dot dropoff"></span><div><small>DELIVER TO</small><strong>'+esc(job.delivery_address||'Customer location')+'</strong></div></div></div>'+
    '<a class="rider-route-button" href="'+mapsUrl(job.pickup_address,job.delivery_address)+'" target="_blank" rel="noopener">VIEW ROUTE IN GOOGLE MAPS</a>'+
    '<p class="rider-route-note">Google Maps will open with two-wheeler directions from the restaurant to the customer.</p>'+
    '</section>';
  document.body.appendChild(el);
  setTimeout(()=>{if(document.getElementById('rider-assignment-popup'))closeAssignmentPopup();},12000);
}

async function renderRiderProfileModal(){
  if(!rider?.id){
    try{rider=await riderApi('/api/riders/me');}
    catch(err){
      const token=sessionStorage.getItem(RIDER_TOKEN_KEY);
      if(!token){document.getElementById('rider-app')?.classList.add('hidden');document.getElementById('rider-login')?.classList.remove('hidden');return;}
      alert(err.message||'Unable to load your rider profile.');
      return;
    }
  }
  const r=rider||{};
  closeRiderProfile();
  const avatar=r.profile_image_url
    ? '<img id="rider-profile-preview-image" src="'+esc(r.profile_image_url)+'" alt="Rider profile photo">'
    : '<span id="rider-profile-preview-fallback" class="rider-profile-preview-fallback">'+esc((r.name||'?')[0])+'</span>';
  const html='<div id="rider-profile-overlay" class="rider-profile-overlay" onclick="if(event.target===this)closeRiderProfile()">'+
    '<section class="rider-profile-modal" role="dialog" aria-modal="true" aria-label="Rider profile">'+
    '<button type="button" class="rider-profile-close" onclick="closeRiderProfile()" aria-label="Close profile">×</button>'+
    '<div class="rider-profile-hero"><button type="button" class="rider-profile-avatar-button" onclick="openProfilePictureViewer()" aria-label="View profile picture"><div class="rider-profile-avatar">'+avatar+'</div><span class="rider-profile-avatar-edit">+</span></button>'+
    '<div><span class="eyebrow">RIDER PROFILE</span><h2>'+esc(r.name||'Rider')+'</h2><p class="muted">Manage your personal, contact and payment details.</p></div></div>'+
    '<input id="rider-profile-picture-input" type="file" accept="image/*" class="rider-profile-picture-input" onchange="handleProfilePicture(event)">'+
    '<div class="rider-profile-picture-actions"><small>Tap the profile photo above to view it larger and manage your picture.</small></div>'+
    '<div id="rider-profile-message" class="rider-profile-message hidden"></div>'+
    '<form id="rider-profile-form" class="rider-profile-form" onsubmit="saveRiderProfile(event)">'+
    '<div class="rider-profile-section"><span class="eyebrow">PERSONAL DETAILS</span><label>Full name<input name="name" value="'+esc(r.name)+'" required></label></div>'+
    '<div class="rider-profile-section"><span class="eyebrow">CONTACT DETAILS</span><label>Phone & SMS number<input name="phone" type="tel" inputmode="tel" value="'+esc(r.phone||'')+'" required><small>This is your rider login and registered notification/SMS number.</small></label><label>Email address<input name="email" type="email" value="'+esc(r.email||'')+'" placeholder="you@example.com"></label></div>'+
    '<div class="rider-profile-section"><span class="eyebrow">PAYMENT DETAILS</span><label>Payout / M-Pesa number<input name="payout_phone" type="tel" inputmode="tel" value="'+esc(r.payout_phone||r.phone||'')+'" required><small>Used for rider delivery earnings when automatic payouts are enabled.</small></label></div>'+
    '<div class="rider-profile-section"><span class="eyebrow">VEHICLE DETAILS</span><label>Vehicle type<input name="vehicle_type" value="'+esc(r.vehicle_type||'Motorbike')+'"></label><label>Number plate<input name="number_plate" value="'+esc(r.number_plate||'')+'" placeholder="KXX 123X"></label></div>'+
    '<div class="rider-profile-section"><span class="eyebrow">SECURITY</span><label>Current password<input name="current_password" type="password" autocomplete="current-password" placeholder="Required only to change password"></label><label>New password<input name="new_password" type="password" autocomplete="new-password" placeholder="Leave blank to keep current password"></label></div>'+
    '<div class="rider-profile-actions"><button type="button" class="rider-profile-secondary" onclick="closeRiderProfile()">CANCEL</button><button type="submit" class="rider-profile-save" id="rider-profile-save">SAVE CHANGES</button></div></form>'+
    '<button type="button" class="rider-profile-logout" onclick="logoutRider()">SIGN OUT OF RIDER ACCOUNT</button></section></div>';
  document.body.insertAdjacentHTML('beforeend',html);
}
function openProfilePicturePicker(){document.getElementById('rider-profile-picture-input')?.click();}
async function openProfilePictureViewer(){
  if(!rider){
    try{rider=await riderApi('/api/riders/me');}
    catch(err){return;}
  }
  document.getElementById('rider-picture-viewer')?.remove();
  const hasPhoto=Boolean(rider?.profile_image_url);
  const visual=hasPhoto
    ? '<img class="rider-picture-viewer-image" src="'+esc(rider.profile_image_url)+'" alt="Rider profile picture">'
    : '<div class="rider-picture-viewer-fallback">'+esc((rider?.name||'?')[0])+'</div>';
  const viewer='<div id="rider-picture-viewer" class="rider-picture-viewer" onclick="if(event.target===this)closeProfilePictureViewer()">'+
    '<div class="rider-picture-viewer-card"><button type="button" class="rider-picture-viewer-close" onclick="closeProfilePictureViewer()" aria-label="Close profile picture">×</button>'+
    '<span class="eyebrow">PROFILE PICTURE</span><div class="rider-picture-viewer-image-wrap">'+visual+'</div>'+
    '<h3>'+esc(rider?.name||'Rider')+'</h3><p class="muted">Manage the picture shown on your rider dashboard.</p>'+
    '<div class="rider-picture-viewer-actions"><button type="button" class="rider-picture-change" onclick="openProfilePicturePicker()">ADD / CHANGE PROFILE PICTURE</button>'+
    (hasPhoto?'<button type="button" class="rider-picture-remove" onclick="removeProfilePictureNow()">REMOVE PROFILE PICTURE</button>':'')+
    '</div><div id="rider-picture-viewer-status" class="rider-picture-viewer-status"></div></div></div>';
  document.body.insertAdjacentHTML('beforeend',viewer);
}
function closeProfilePictureViewer(){document.getElementById('rider-picture-viewer')?.remove();}
function setPictureViewerStatus(message,error=false){const el=document.getElementById('rider-picture-viewer-status');if(!el)return;el.textContent=message;el.className='rider-picture-viewer-status '+(error?'error':'');}
function setProfilePreview(src){
  const wrap=document.querySelector('.rider-profile-avatar');if(!wrap)return;
  wrap.innerHTML=src?'<img id="rider-profile-preview-image" src="'+esc(src)+'" alt="Rider profile photo">':'<span id="rider-profile-preview-fallback" class="rider-profile-preview-fallback">'+esc((rider?.name||'?')[0])+'</span>';
}
async function saveProfilePictureNow(src){
  setPictureViewerStatus(src?'Saving profile picture…':'Removing profile picture…');
  try{
    const data=await riderApi('/api/riders/'+encodeURIComponent(rider.id)+'/profile',{method:'PUT',body:JSON.stringify({
      name:rider.name,email:rider.email||'',phone:rider.phone,payout_phone:rider.payout_phone||rider.phone,
      vehicle_type:rider.vehicle_type||'Motorbike',number_plate:rider.number_plate||'',profile_image_url:src||''
    })});
    rider=data.rider;updateRiderProfileButton();setProfilePreview(rider.profile_image_url||'');await loadRiderDashboard();
    setPictureViewerStatus(src?'Profile picture saved.':'Profile picture removed.');
    setTimeout(()=>openProfilePictureViewer(),350);
  }catch(err){setPictureViewerStatus(err.message||'Could not save profile picture.',true);}
}
async function handleProfilePicture(event){
  const file=event.target.files?.[0];if(!file)return;
  if(!file.type.startsWith('image/')){setPictureViewerStatus('Please choose a photo (JPG, PNG or WEBP).',true);return;}
  if(file.size>12*1024*1024){setPictureViewerStatus('Please choose a photo smaller than 12 MB.',true);return;}
  setPictureViewerStatus('Preparing your photo…');
  try{
    let bitmap=null;
    if('createImageBitmap' in window){try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{}}
    if(bitmap){
      const max=1000,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      await saveProfilePictureNow(canvas.toDataURL('image/jpeg',.84));return;
    }
    const reader=new FileReader();
    reader.onload=()=>{const img=new Image();img.onload=()=>{
      const max=1000,scale=Math.min(1,max/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round((img.naturalWidth||img.width)*scale));canvas.height=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,canvas.width,canvas.height);
      saveProfilePictureNow(canvas.toDataURL('image/jpeg',.84));
    };img.onerror=()=>setPictureViewerStatus('This phone photo format is not supported by the browser. Please choose a JPG or PNG photo.',true);img.src=String(reader.result||'');};
    reader.onerror=()=>setPictureViewerStatus('The phone could not read that photo. Please choose another one.',true);
    reader.readAsDataURL(file);
  }catch(err){setPictureViewerStatus('Could not prepare that photo. Please choose a JPG or PNG photo.',true);}
}
function removeProfilePictureNow(){saveProfilePictureNow('');}
function closeRiderProfile(){document.getElementById('rider-profile-overlay')?.remove();document.getElementById('rider-picture-viewer')?.remove();}
function showRiderProfileMessage(message,error=false){const el=document.getElementById('rider-profile-message');if(!el)return;el.textContent=message;el.className='rider-profile-message '+(error?'error':'success');}
async function saveRiderProfile(e){
  e.preventDefault();
  const form=e.currentTarget,button=document.getElementById('rider-profile-save'),values=Object.fromEntries(new FormData(form).entries());
  button.disabled=true;button.textContent='SAVING…';
  try{const data=await riderApi('/api/riders/'+encodeURIComponent(rider.id)+'/profile',{method:'PUT',body:JSON.stringify(values)});
    rider=data.rider;updateRiderProfileButton();showRiderProfileMessage('Profile updated successfully.');await loadRiderDashboard();setTimeout(closeRiderProfile,700);
  }catch(err){showRiderProfileMessage(err.message||'Could not update profile.',true);}
  finally{button.disabled=false;button.textContent='SAVE CHANGES';}
}
function riderAvatarMarkup(sizeClass){
  const hasPhoto=Boolean(rider?.profile_image_url);
  const fallback='<span class="'+sizeClass+'-fallback" style="display:'+(hasPhoto?'none':'grid')+'">'+esc((rider?.name||'?')[0])+'</span>';
  if(!hasPhoto)return fallback;
  return '<img class="'+sizeClass+'-photo" src="'+esc(rider.profile_image_url)+'" alt="'+esc(rider.name||'Rider')+'" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\';">'+fallback;
}
function updateRiderProfileButton(){
  const button=document.getElementById('rider-profile-nav');if(!button||!rider)return;
  button.innerHTML=riderAvatarMarkup('rider-nav-avatar');
  button.setAttribute('aria-label','Open rider profile');
  button.classList.remove('hidden');
  button.onclick=async(event)=>{
    event.preventDefault();event.stopPropagation();
    try{await renderRiderProfileModal();}
    catch(err){alert(err.message||'Unable to open rider profile.');}
  };
}
async function loginRider(e){
  e?.preventDefault();
  const phone=document.getElementById('rider-phone').value.trim(),password=document.getElementById('rider-password').value;
  const error=document.getElementById('rider-login-error'),button=document.getElementById('rider-login-btn');
  error.classList.remove('hidden');error.textContent='Signing in…';button.disabled=true;button.textContent='SIGNING IN…';
  try{
    const data=await riderApi('/api/riders/login',{method:'POST',body:JSON.stringify({businessId:RIDER_BUSINESS_ID,phone,password})});
    sessionStorage.setItem(RIDER_TOKEN_KEY,data.token);localStorage.removeItem(RIDER_TOKEN_KEY);rider=data.rider;await bootRider();
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
  unlockRiderAudio();
  if(!rider?.id){
    try{rider=await riderApi('/api/riders/me');updateRiderProfileButton();}
    catch(err){
      clearRiderSession();
      document.getElementById('rider-app')?.classList.add('hidden');
      document.getElementById('rider-login')?.classList.remove('hidden');
      alert('Your rider session has expired. Please sign in again.');
      return;
    }
  }
  const actionVersion=++availabilityActionVersion;
  // Update the interface immediately. The rider should never have to wait
  // for a network round-trip before being able to change availability again.
  updateOnlineButton(online);
  try{
    if(online) requestNotifications().catch(()=>{});
    const data=await riderApi('/api/riders/'+encodeURIComponent(rider.id)+'/presence',{method:'POST',body:JSON.stringify({online})});
    if(actionVersion!==availabilityActionVersion)return;
    updateOnlineButton(Boolean(data.online));
    await loadRiderDashboard();
  }catch(err){
    if(actionVersion!==availabilityActionVersion)return;
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
async function declineTrip(tripId){
  if(!tripId)return;
  if(!confirm('Decline this delivery? The restaurant will be able to reassign it.'))return;
  try{
    await riderApi('/api/riders/'+encodeURIComponent(rider.id)+'/deliveries/'+encodeURIComponent(tripId)+'/decline',{method:'POST',body:JSON.stringify({})});
    await loadRiderDashboard();
  }catch(err){alert(err.message||'Could not decline delivery.');}
}
async function setTripStatus(tripId,status){
  const route={ARRIVED_AT_RESTAURANT:'arrived',PICKED_UP:'picked-up',ON_THE_WAY:'on-the-way',DELIVERED:'delivered'}[status];
  if(!route)return;
  try{await riderApi('/api/riders/'+encodeURIComponent(rider.id)+'/deliveries/'+encodeURIComponent(tripId)+'/'+route,{method:'POST',body:JSON.stringify({})});await loadRiderDashboard();}catch(err){alert(err.message||'Could not update delivery.');}
}
function showRiderSystemNotice(message){
  document.getElementById('rider-system-notice')?.remove();
  const el=document.createElement('div');
  el.id='rider-system-notice';
  el.className='rider-system-notice';
  el.innerHTML='<div class="rider-system-notice-card"><span class="eyebrow">ACCOUNT NOTICE</span><strong>'+esc(message)+'</strong><small>You will be signed out shortly.</small></div>';
  document.body.appendChild(el);
}
function maybeNotify(job){
  if(!job||job.id===lastTripId)return;
  const shouldPopup=riderDashboardInitialized;
  lastTripId=job.id;
  if(shouldPopup){showDeliveryAssignmentPopup(job);}
  if('Notification' in window&&Notification.permission==='granted'){
    try{
      if(navigator.serviceWorker?.ready){
        navigator.serviceWorker.ready.then(reg=>reg.showNotification('New delivery assignment',{body:job.order_number+' · '+job.customer_name,tag:'rider-assignment'})).catch(()=>{});
      }
    }catch{}
  }
}
async function requestNotifications(){
  if(!('Notification' in window))return;
  try{if(Notification.permission==='default')await Notification.requestPermission();}catch{}
}
function statusSteps(current){
  const steps=['ASSIGNED','ACCEPTED','ARRIVED_AT_RESTAURANT','PICKED_UP','ON_THE_WAY','DELIVERED'];
  const index=steps.indexOf(current);
  return '<div class="timeline-mini">'+steps.map((s,i)=>'<span class="'+(i<=index?'active':'')+'">'+s.replaceAll('_',' ')+'</span>').join('')+'</div>';
}
function activeCard(a){
  if(!a)return '<div class="empty" style="padding:30px 10px"><h3>No active delivery.</h3><p>When the restaurant assigns a job to you, it will appear here.</p></div>';
  const current=(a.delivery_status||'ASSIGNED');
  let action='';
  if(current==='ASSIGNED') action='<div class="rider-assigned-actions"><button class="rider-decline-inline" onclick="declineTrip(\''+a.trip_id+'\')">DECLINE</button><button onclick="acceptTrip(\''+a.trip_id+'\')">ACCEPT DELIVERY</button></div>';
  else if(current==='ACCEPTED') action='<button onclick="setTripStatus(\''+a.trip_id+'\',\'ARRIVED_AT_RESTAURANT\')">ARRIVED AT RESTAURANT</button>';
  else if(current==='ARRIVED_AT_RESTAURANT') action='<button onclick="setTripStatus(\''+a.trip_id+'\',\'PICKED_UP\')">PICKED UP</button>';
  else if(current==='PICKED_UP') action='<button onclick="setTripStatus(\''+a.trip_id+'\',\'ON_THE_WAY\')">ON THE WAY</button>';
  else if(current==='ON_THE_WAY') action='<button onclick="setTripStatus(\''+a.trip_id+'\',\'DELIVERED\')">MARK DELIVERED</button>';
  const mapAction=current!=='ASSIGNED'?'<a class="rider-map-action" href="'+mapsUrl(a.pickup_address,a.delivery_address)+'" target="_blank" rel="noopener">GOOGLE MAPS</a>':'';
  return '<article class="rider-card rider-active-card"><div class="rider-active-top"><div><span class="eyebrow">ACTIVE DELIVERY</span><h3>'+esc(a.order_number)+'</h3></div><span class="rider-active-status">'+esc(current.replaceAll('_',' '))+'</span></div>'+
    '<div class="rider-active-route"><div><small>FROM</small><strong>'+esc(a.pickup_address||'Restaurant')+'</strong></div><span>→</span><div><small>TO</small><strong>'+esc(a.delivery_address||a.delivery_note||'Customer location')+'</strong></div></div>'+
    '<div class="rider-active-info"><div><small>CUSTOMER</small><strong>'+esc(a.customer_name||'Customer')+'</strong></div><div><small>FEE</small><strong>'+riderMoney(a.delivery_fee)+'</strong></div><div><small>DISTANCE</small><strong>'+((Number(a.route_distance_meters||0)/1000).toFixed(1))+' km</strong></div></div>'+
    '<div class="rider-status-steps-wrap">'+statusSteps(current)+'</div><div class="rider-actions">'+action+mapAction+'</div></article>'+
    (current!=='ASSIGNED'?'<section id="rider-live-route-panel" class="rider-live-route-panel"><div class="rider-live-route-head"><div><span class="eyebrow">LIVE ROUTE</span><h3>Delivery navigation</h3><p>Follow the same two-wheeler route used by the delivery system.</p></div><div class="rider-live-route-tools"><span id="rider-live-map-status" class="rider-live-map-status">LOADING…</span><button type="button" id="rider-map-fullscreen-button" class="rider-map-fullscreen-button" onclick="toggleRiderMapFullscreen()" aria-label="Open full screen map">⛶</button></div></div><div class="rider-live-map-wrap"><div id="rider-live-map" class="rider-live-map"></div><button type="button" id="rider-map-floating-exit" class="rider-map-floating-fullscreen" onclick="toggleRiderMapFullscreen()" aria-label="Open full screen map">⛶</button></div><div class="rider-live-route-note">Your live position follows your phone GPS while this delivery is active.</div><button type="button" class="rider-demo-launch" onclick="startDemoTracking()">TEST LIVE TRACKING (DEMO)</button></section>':'<button type="button" class="rider-demo-launch standalone" onclick="startDemoTracking()">TEST LIVE TRACKING (DEMO)</button>');
}
function renderAvailable(list){
  if(!list.length)return '<p class="muted">No new assignments.</p>';
  return list.map(a=>'<article class="rider-card"><h3>'+esc(a.order_number)+' · '+esc(a.restaurant_name)+'</h3><div class="rider-meta"><span>Customer: '+esc(a.customer_name)+'</span><span>'+esc(a.delivery_address||'Location pending')+'</span></div><p>'+Number(a.route_distance_meters||0)/1000+' km · '+riderMoney(a.delivery_fee)+' delivery fee</p></article>').join('');
}
function localDateKey(value){
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return '';
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}
function formatDateTime(value){
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return 'Time unavailable';
  return d.toLocaleString([], {weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
}
function weekDates(){
  const now=new Date();
  const monday=new Date(now);
  const day=monday.getDay();
  monday.setHours(0,0,0,0);
  monday.setDate(monday.getDate()+(day===0?-6:1-day));
  return Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(monday.getDate()+i);return d;});
}
function dayEarnings(list,key){
  return list.filter(x=>localDateKey(x.completed_at)===key).reduce((sum,x)=>sum+Number(x.earning||0),0);
}
function renderRiderStats(data){
  const completed=data.completed||[];
  const todayKey=localDateKey(new Date());
  const todayList=completed.filter(x=>localDateKey(x.completed_at)===todayKey);
  const weekDays=weekDates();
  const weekList=weekDays.map(d=>{
    const key=localDateKey(d);
    return {date:d,key,earnings:dayEarnings(completed,key),deliveries:completed.filter(x=>localDateKey(x.completed_at)===key)};
  });
  document.getElementById('rider-stats').innerHTML=
    '<button type="button" class="rider-stat-card" onclick="openRiderDay(\''+todayKey+'\')">'+
      '<span class="muted">Today</span><strong>'+riderMoney(data.todayEarnings)+'</strong><small>'+todayList.length+' deliveries · View details</small>'+
    '</button>'+
    '<button type="button" class="rider-stat-card" onclick="openRiderWeek()">'+
      '<span class="muted">This week</span><strong>'+riderMoney(data.weekEarnings)+'</strong><small>'+weekList.reduce((n,x)=>n+x.deliveries.length,0)+' deliveries · View week</small>'+
    '</button>'+
    '<button type="button" class="rider-stat-card" onclick="openRiderCompleted()">'+
      '<span class="muted">Completed</span><strong>'+completed.length+'</strong><small>Recent trips · View all</small>'+
    '</button>';
}
function renderHistory(list){
  if(!list.length)return '<p class="muted">No completed deliveries yet.</p>';
  return list.slice(0,20).map(a=>'<button type="button" class="rider-history-row" onclick="openDeliveryDetail(\''+esc(a.order_number)+'\')"><span><strong>'+esc(a.order_number)+'</strong><small>'+formatDateTime(a.completed_at)+' · '+(Number(a.distance_meters||0)/1000).toFixed(1)+' km</small></span><strong>'+riderMoney(a.earning)+'</strong></button>').join('');
}
function closeRiderOverlay(){document.getElementById('rider-detail-overlay')?.remove();}
function openDeliveryDetail(orderNumber){
  const data=(window.__riderDashboardData?.completed||[]).find(x=>String(x.order_number)===String(orderNumber));
  if(!data)return;
  closeRiderOverlay();
  const duration=data.trip_minutes!=null?Math.max(0,Math.round(Number(data.trip_minutes)))+' min':'Not recorded';
  const distance=(Number(data.distance_meters||0)/1000).toFixed(1)+' km';
  const html='<div id="rider-detail-overlay" class="rider-detail-overlay" onclick="if(event.target===this)closeRiderOverlay()">'+
    '<section class="rider-detail-modal" role="dialog" aria-modal="true" aria-label="Delivery details">'+
      '<button class="rider-detail-close" type="button" onclick="closeRiderOverlay()" aria-label="Close">×</button>'+
      '<p class="eyebrow">DELIVERY COMPLETED</p><h2>'+esc(data.order_number)+'</h2>'+
      '<p class="muted">Non-sensitive delivery summary</p>'+
      '<div class="rider-detail-grid">'+
        '<div><span>Earned</span><strong>'+riderMoney(data.earning)+'</strong></div>'+
        '<div><span>Distance</span><strong>'+distance+'</strong></div>'+
        '<div><span>Delivery time</span><strong>'+duration+'</strong></div>'+
        '<div><span>Completed</span><strong>'+formatDateTime(data.completed_at)+'</strong></div>'+
      '</div>'+
      '<div class="rider-detail-lines"><div><span>Assigned</span><strong>'+formatDateTime(data.assigned_at)+'</strong></div><div><span>Delivery fee</span><strong>'+riderMoney(data.delivery_fee)+'</strong></div><div><span>Status</span><strong>COMPLETED</strong></div></div>'+
      '<p class="muted rider-detail-safe">Customer contact information and other sensitive customer details are not shown here.</p>'+
    '</section></div>';
  document.body.insertAdjacentHTML('beforeend',html);
}
function openRiderDay(key){
  const list=(window.__riderDashboardData?.completed||[]).filter(x=>localDateKey(x.completed_at)===key);
  const d=new Date(key+'T12:00:00');
  const title=d.toLocaleDateString([], {weekday:'long',day:'numeric',month:'long'});
  openRiderListOverlay(title,'Daily earnings',list);
}
function openRiderWeek(){
  const list=window.__riderDashboardData?.completed||[];
  const days=weekDates().map(d=>({date:d,key:localDateKey(d),deliveries:list.filter(x=>localDateKey(x.completed_at)===localDateKey(d)),earnings:dayEarnings(list,localDateKey(d))}));
  const rows=days.map(x=>'<button type="button" class="rider-week-row" onclick="openRiderDay(\''+x.key+'\')"><span><strong>'+x.date.toLocaleDateString([], {weekday:'long'})+'</strong><small>'+x.date.toLocaleDateString([], {day:'numeric',month:'short'})+' · '+x.deliveries.length+' deliveries</small></span><strong>'+riderMoney(x.earnings)+'</strong></button>').join('');
  closeRiderOverlay();
  document.body.insertAdjacentHTML('beforeend','<div id="rider-detail-overlay" class="rider-detail-overlay" onclick="if(event.target===this)closeRiderOverlay()"><section class="rider-detail-modal rider-week-modal"><button class="rider-detail-close" type="button" onclick="closeRiderOverlay()">×</button><p class="eyebrow">THIS WEEK</p><h2>Weekly earnings</h2><p class="muted">Monday to Sunday. Select a day to view its deliveries.</p><div class="rider-week-list">'+rows+'</div></section></div>');
}
function openRiderCompleted(){
  openRiderListOverlay('Completed deliveries','Recent delivery history',window.__riderDashboardData?.completed||[]);
}
function openRiderListOverlay(title,subtitle,list){
  closeRiderOverlay();
  const rows=list.length?list.map(a=>'<button type="button" class="rider-history-row" onclick="openDeliveryDetail(\''+esc(a.order_number)+'\')"><span><strong>'+esc(a.order_number)+'</strong><small>'+formatDateTime(a.completed_at)+' · '+(Number(a.distance_meters||0)/1000).toFixed(1)+' km</small></span><strong>'+riderMoney(a.earning)+'</strong></button>').join(''):'<div class="rider-empty-day">No completed deliveries for this day.</div>';
  document.body.insertAdjacentHTML('beforeend','<div id="rider-detail-overlay" class="rider-detail-overlay" onclick="if(event.target===this)closeRiderOverlay()"><section class="rider-detail-modal"><button class="rider-detail-close" type="button" onclick="closeRiderOverlay()">×</button><p class="eyebrow">DELIVERY HISTORY</p><h2>'+esc(title)+'</h2><p class="muted">'+esc(subtitle)+'</p><div class="rider-history-list">'+rows+'</div></section></div>');
}
async function loadRiderDashboard(){
  const data=await dashboardData();maybeNotify(data.active);
  updateOnlineButton(Boolean(data.online));
  window.__riderDashboardData=data;
  renderRiderStats(data);
  document.getElementById('available-deliveries').innerHTML=renderAvailable(data.available);
  const activeKey=data.active?(String(data.active.trip_id)+'|'+String(data.active.delivery_status||'ASSIGNED')):'none';
  if(activeKey!==lastActiveRenderKey){
    lastActiveRenderKey=activeKey;
    document.getElementById('active-delivery').innerHTML=activeCard(data.active);
    if(data.active&&data.active.delivery_status!=='ASSIGNED') renderLiveRouteMap(data.active); else destroyRiderMap();
  }
  if(!riderDashboardInitialized){riderDashboardInitialized=true;}
}
async function bootRider(){
  try{
    rider=await riderApi('/api/riders/me');
    document.getElementById('rider-login').classList.add('hidden');document.getElementById('rider-app').classList.remove('hidden');updateRiderProfileButton();
    document.getElementById('rider-header').innerHTML='<div class="rider-identity-card"><div class="rider-presence-indicator"><span id="rider-presence-dot" class="presence-dot is-offline"></span><span id="rider-presence-text">OFFLINE</span></div><div class="rider-profile-line">'+riderAvatarMarkup('rider-identity-avatar')+'<div><p class="eyebrow">RIDER OPERATIONS</p><h1>'+esc(rider.name)+'</h1><p class="muted">'+esc(rider.vehicle_type)+' · '+esc(rider.number_plate||'Plate not set')+' · '+esc(rider.payout_phone||rider.phone)+'</p></div></div><div class="rider-availability"><span class="availability-label">DELIVERY AVAILABILITY</span><button id="online-button" class="availability-button is-offline" type="button" aria-pressed="false" onclick="toggleOnline()" title="Press to change your delivery availability">GO ONLINE</button><p>Go online when you are ready to receive delivery assignments.</p></div></div>';
    await loadRiderDashboard();startRiderRealtime();
    clearInterval(pollTimer);
    pollTimer=setInterval(async()=>{
      if(riderLiveSyncBusy||!rider)return;
      riderLiveSyncBusy=true;
      try{await loadRiderDashboard();}catch{}
      finally{riderLiveSyncBusy=false;}
    },2000);
  }catch(err){clearRiderSession();document.getElementById('rider-login-error').classList.remove('hidden');document.getElementById('rider-login-error').textContent=err.message||'Rider session expired.';}
}
function startRiderRealtime(){
  if(riderEvents||!rider)return;
  const token=sessionStorage.getItem(RIDER_TOKEN_KEY);
  if(!token)return;
  const connect=()=>{
    if(!rider)return;
    riderEvents=new EventSource(API_BASE_URL+'/api/riders/events?businessId='+encodeURIComponent(RIDER_BUSINESS_ID)+'&riderToken='+encodeURIComponent(token));
    const refresh=()=>loadRiderDashboard().catch(()=>{});
    ['rider.updated','order.updated','delivery.updated'].forEach(name=>riderEvents.addEventListener(name,e=>{
      try{
        const d=JSON.parse(e.data||'{}');
        if(d.action==='SUSPENDED'){
          showRiderSystemNotice('Your rider account has been temporarily suspended by Savanna Bites. Please contact the restaurant manager if you need assistance.');
          if(riderEvents){riderEvents.close();riderEvents=null;}
          clearInterval(pollTimer);
          setTimeout(()=>{clearRiderSession();location.reload();},2800);
          return;
        }
        refresh();
      }catch{refresh();}
    }));
    riderEvents.onerror=()=>{if(riderEvents){riderEvents.close();riderEvents=null;}setTimeout(connect,3000);};
  };
  connect();
}
bootRider();
