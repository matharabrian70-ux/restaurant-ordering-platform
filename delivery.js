const RIDER_SESSION_KEY='doe_remote_rider_id';

async function riderApi(path, options={}){
  const response=await fetch('https://restaurant-ordering-api-ow3p.onrender.com'+path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error||`Request failed (${response.status})`);
  return data;
}

async function loadRiders(){
  return riderApi('/api/riders?businessId='+encodeURIComponent(BUSINESS_ID));
}

function currentRiderId(){return localStorage.getItem(RIDER_SESSION_KEY)||'';}
function setCurrentRider(id){localStorage.setItem(RIDER_SESSION_KEY,id);}

async function createRider(){
  const name=document.getElementById('new-rider-name').value.trim();
  const phone=document.getElementById('new-rider-phone').value.trim();
  const vehicleType=document.getElementById('new-rider-vehicle').value.trim();
  const numberPlate=document.getElementById('new-rider-plate').value.trim();
  const error=document.getElementById('rider-create-error');
  if(!name||!phone||!vehicleType||!numberPlate){error.textContent='Complete all rider fields.';return;}
  try{
    const rider=await riderApi('/api/riders',{method:'POST',body:JSON.stringify({businessId:BUSINESS_ID,name,phone,vehicleType,numberPlate})});
    setCurrentRider(rider.id);
    await renderRider();
  }catch(err){error.textContent=err.message||'Could not create rider.';}
}

async function signInRider(){
  const id=document.getElementById('rider-id').value.trim();
  const error=document.getElementById('rider-signin-error');
  try{
    const rs=await loadRiders();
    const rider=rs.find(r=>r.id===id);
    if(!rider) throw new Error('Rider ID not found. Create the rider first on this shared system.');
    setCurrentRider(rider.id);
    await renderRider();
  }catch(err){error.textContent=err.message||'Could not sign in.';}
}

async function completeDelivery(){
  const id=currentRiderId();
  if(!id)return;
  try{await riderApi('/api/riders/'+encodeURIComponent(id)+'/complete-delivery',{method:'POST',body:JSON.stringify({})});await renderRider();}
  catch(err){alert(err.message||'Could not complete delivery.');}
}

async function renderRider(){
  const el=document.getElementById('rider-view');
  if(!el)return;
  try{
    const rs=await loadRiders();
    const currentId=currentRiderId();
    const current=rs.find(r=>r.id===currentId);
    el.innerHTML=`<div class="dashboard-head"><div><p class="eyebrow">DELIVERY PORTAL</p><h1>Rider dashboard.</h1><p class="muted">Riders are stored on the shared ordering backend, so the same rider is visible across devices.</p></div><a class="btn" href="dashboard.html">Restaurant</a></div>
      <section class="panel"><h2>Available riders</h2><div class="rider-strip">${rs.length?rs.map(r=>`<div class="rider-chip"><strong>${r.name}</strong><span>${r.available?'AVAILABLE':'DELIVERING'}</span><small>${r.vehicle_type} · ${r.number_plate}</small><small>${r.id} · ${r.trip_count||0} trips</small></div>`).join(''):'<p class="muted">No riders created yet.</p>'}</div></section>
      <section class="panel" style="margin-top:1rem"><h2>Create rider</h2><p class="muted">For the prototype, this creates a rider in PostgreSQL so the restaurant dashboard can see them from another device.</p><div class="field"><label>Name</label><input id="new-rider-name" placeholder="Rider name"></div><div class="field"><label>Phone</label><input id="new-rider-phone" placeholder="07xx xxx xxx"></div><div class="field"><label>Vehicle type</label><input id="new-rider-vehicle" placeholder="Motorbike"></div><div class="field"><label>Number plate</label><input id="new-rider-plate" placeholder="KDA 123A"></div><button class="btn" onclick="createRider()">CREATE RIDER</button><p id="rider-create-error" class="muted"></p></section>
      <section class="panel" style="margin-top:1rem"><h2>Rider sign in</h2><div class="field"><label>Rider ID</label><input id="rider-id" value="${current?.id||''}" placeholder="Use the rider ID shown above"></div><button class="btn" onclick="signInRider()">SIGN IN</button><p id="rider-signin-error" class="muted"></p></section>
      <div id="rider-job" class="panel" style="margin-top:1rem"></div>`;
    if(current) await showRiderJob(current);
    else document.getElementById('rider-job').innerHTML='<p class="eyebrow">NOT SIGNED IN</p><h2>Select a rider ID above.</h2>';
  }catch(err){el.innerHTML=`<div class="empty"><h2>Rider service unavailable.</h2><p>${err.message||'Please try again.'}</p></div>`;}
}

async function showRiderJob(rider){
  const el=document.getElementById('rider-job');
  try{
    const active=await riderApi('/api/riders/'+encodeURIComponent(rider.id)+'/active-delivery');
    el.innerHTML=active?`<p class="eyebrow">ACTIVE DELIVERY</p><h2>${active.order_number} · ${active.customer_name}</h2><p>${active.delivery_note||'No delivery note'}</p><p><strong>${rider.name}</strong> · ${rider.vehicle_type} · ${rider.number_plate}</p><p>${active.phone}</p><button class="btn" onclick="completeDelivery()">MARK DELIVERED</button>`:`<p class="eyebrow">NO ACTIVE DELIVERY</p><h2>You are available.</h2><p class="muted">Trips completed: ${rider.trip_count||0}</p>`;
  }catch(err){el.innerHTML=`<p class="muted">${err.message||'Could not load delivery.'}</p>`;}
}

renderRider();
