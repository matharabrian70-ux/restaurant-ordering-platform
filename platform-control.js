(function(){
'use strict';

const API='https://restaurant-ordering-api-ow3p.onrender.com';
const SITE='https://matharabrian70-ux.github.io/restaurant-ordering-platform';
const root=document.getElementById('platform-view');
const state={me:null,overview:{},businesses:[],packages:[],selected:null,showCreate:false};

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('en-KE',{style:'currency',currency:'KES',maximumFractionDigits:0}).format(Number(v||0));
const token=()=>localStorage.getItem('platform_admin_token')||'';

async function api(path,opt={}){
  const headers={'Content-Type':'application/json',...(opt.headers||{})};
  if(token())headers.Authorization='Bearer '+token();
  const response=await fetch(API+path,{...opt,headers});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Platform request failed');
  return data;
}

function login(message=''){
  root.innerHTML=`
    <section class="pc-login">
      <div class="pc-login-card">
        <span class="pc-kicker">PLATFORM OWNER</span>
        <h1>Control Centre.</h1>
        <p>One place to provision restaurants, connect their websites and control which ordering services are active.</p>
        ${message?`<div class="pc-message pc-error">${esc(message)}</div>`:''}
        <form id="login-form">
          <label>Email<input id="pa-email" type="email" autocomplete="username" required></label>
          <label>Password>
            <span class="pc-password-field">
              <input id="pa-password" type="password" autocomplete="current-password" required>
              <button type="button" class="pc-password-toggle" id="pa-password-toggle" aria-label="Show password">SHOW</button>
            </span>
          </label>
          <button type="submit" class="pc-btn pc-signin-btn">SIGN IN</button>
        </form>
        <div class="pc-login-divider"><span>OR</span></div>
        <button type="button" class="pc-google-btn" id="platform-google-btn"><span class="pc-google-mark">G</span><span>CONTINUE WITH GOOGLE</span></button>
        <p class="pc-google-note">Google will ask which account you want to use before continuing.</p>
        <p class="pc-note">Uses the platform owner credentials already configured on Render.</p>
      </div>
    </section>`;
  document.getElementById('login-form').addEventListener('submit',loginSubmit);
  document.getElementById('pa-password-toggle').addEventListener('click',togglePlatformPassword);
  document.getElementById('platform-google-btn').addEventListener('click',googlePlatformLogin);
}

async function loginSubmit(e){
  e.preventDefault();
  const button=e.submitter;
  button.disabled=true;button.textContent='SIGNING IN…';
  try{
    const data=await api('/api/platform/login',{method:'POST',body:JSON.stringify({
      email:document.getElementById('pa-email').value.trim(),
      password:document.getElementById('pa-password').value
    })});
    localStorage.setItem('platform_admin_token',data.token);
    await load();
  }catch(error){button.disabled=false;button.textContent='SIGN IN';login(error.message);}
}

function togglePlatformPassword(){
  const input=document.getElementById('pa-password'),button=document.getElementById('pa-password-toggle');
  if(!input||!button)return;
  input.type=input.type==='password'?'text':'password';
  button.textContent=input.type==='password'?'SHOW':'HIDE';
  button.setAttribute('aria-label',input.type==='password'?'Show password':'Hide password');
}

async function googlePlatformLogin(){
  const button=document.getElementById('platform-google-btn');
  try{
    button.disabled=true;
    const cfg=await api('/api/platform/google/config');
    if(!cfg.clientId)throw new Error('Google sign-in is not configured on the server yet.');
    if(!window.google?.accounts?.id){
      await new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.src='https://accounts.google.com/gsi/client';
        script.async=true;
        script.onload=resolve;
        script.onerror=()=>reject(new Error('Google sign-in could not load.'));
        document.head.appendChild(script);
      });
    }
    google.accounts.id.initialize({client_id:cfg.clientId,callback:async response=>{
      try{
        const data=await api('/api/platform/google',{method:'POST',body:JSON.stringify({credential:response.credential})});
        localStorage.setItem('platform_admin_token',data.token);
        await load();
      }catch(error){button.disabled=false;login(error.message);}
    }});
    google.accounts.id.prompt();
  }catch(error){button.disabled=false;login(error.message);}
}

async function load(){
  try{
    state.me=await api('/api/platform/me');
    const [overview,businesses,packages]=await Promise.all([
      api('/api/platform/overview'),
      api('/api/platform/businesses'),
      api('/api/platform/packages')
    ]);
    state.overview=overview;state.businesses=businesses;state.packages=packages;
    render();
  }catch(error){
    localStorage.removeItem('platform_admin_token');
    login(error.message);
  }
}

function packageFor(b){
  return state.packages.find(p=>p.key===b.plan_key);
}
function riderEnabled(b){
  return Boolean(packageFor(b)?.features?.riderModule);
}
function customerUrl(b){return SITE+'/menu.html?businessId='+encodeURIComponent(b.id);}
function managerUrl(b){return SITE+'/manager.html?businessId='+encodeURIComponent(b.id);}
function riderUrl(b){return SITE+'/rider.html?businessId='+encodeURIComponent(b.id);}

function connectorCode(b){
  const menu=customerUrl(b);
  return `<script>
(function(){
  var customerMenu="${menu}";
  document.querySelectorAll('[data-restaurant-menu],[data-restaurant-order]').forEach(function(el){
    el.addEventListener('click',function(event){
      event.preventDefault();
      window.location.href=customerMenu;
    });
  });
})();
<\/script>`;
}

function render(){
  const o=state.overview||{};
  root.innerHTML=`
  <div class="pc-page">
    <header class="pc-nav">
      <div class="pc-brand">
        <span>PLATFORM OWNER</span>
        RESTAURANT ORDERING PLATFORM
      </div>
      <div class="pc-nav-right">
        <span class="pc-admin">${esc(state.me?.name||'Platform Owner')}</span>
        <button class="pc-btn secondary" id="logout-btn">SIGN OUT</button>
      </div>
    </header>

    <main class="pc-main">
      <header class="pc-head">
        <div>
          <span class="pc-kicker">MASTER CONTROL CENTRE</span>
          <h1>Every restaurant.<br>One system.</h1>
          <p>Provision a tenant, choose its services, connect its website and hand over the branded ordering experience.</p>
        </div>
        <div class="pc-actions">
          <button class="pc-btn" id="add-btn">+ ADD RESTAURANT</button>
          <button class="pc-btn secondary" id="refresh-btn">REFRESH</button>
        </div>
      </header>

      <section class="pc-grid">
        <article class="pc-stat"><span>RESTAURANTS</span><strong>${Number(o.restaurants||0)}</strong><small>Tenants on platform</small></article>
        <article class="pc-stat"><span>ACTIVE</span><strong>${Number(o.active||0)}</strong><small>Active accounts</small></article>
        <article class="pc-stat"><span>ORDERS</span><strong>${Number(o.orders||0)}</strong><small>Across all tenants</small></article>
        <article class="pc-stat"><span>PAID VALUE</span><strong>${money(o.revenue)}</strong><small>Paid order value</small></article>
      </section>

      ${state.showCreate?createPanel():''}

      <section class="pc-panel">
        <div class="pc-panel-head">
          <div><span class="pc-kicker">TENANTS</span><h2>Restaurant connections</h2></div>
          <span class="pc-count">${state.businesses.length} restaurant${state.businesses.length===1?'':'s'}</span>
        </div>
        <div class="pc-table-wrap">
          <table class="pc-table">
            <thead><tr><th>RESTAURANT</th><th>WEBSITE</th><th>PACKAGE</th><th>RIDER</th><th>STATUS</th><th></th></tr></thead>
            <tbody>
              ${state.businesses.length?state.businesses.map(row).join(''):`<tr><td colspan="6" class="pc-empty">No restaurants have been provisioned yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  </div>
  ${state.selected?detailPanel(state.selected):''}`;

  document.getElementById('logout-btn').onclick=logout;
  document.getElementById('add-btn').onclick=()=>{state.showCreate=true;render();document.getElementById('new-name')?.focus();};
  document.getElementById('refresh-btn').onclick=load;
  bindCreate();
  bindRows();
  bindDetail();
}

function row(b){
  const advanced=riderEnabled(b);
  return `<tr>
    <td><div class="pc-tenant-name"><span class="pc-logo-dot" style="background:${esc(b.primary_color||'#c96b3b')}"></span><div><strong>${esc(b.name)}</strong><small>${esc(b.slug)}</small></div></div></td>
    <td><div class="pc-site">${b.website_url?`<a href="${esc(b.website_url)}" target="_blank" rel="noopener">${esc(b.website_url)}</a>`:'<span class="pc-muted">Not connected</span>'}</div></td>
    <td><strong>${esc(b.plan_name||b.plan_key||'STARTER')}</strong></td>
    <td><span class="pc-module ${advanced?'on':'off'}">${advanced?'CONNECTED':'NOT CONNECTED'}</span></td>
    <td><span class="pc-pill ${b.status==='ACTIVE'?'active':'suspended'}">${esc(b.status)}</span></td>
    <td><button class="pc-mini pc-open" data-id="${esc(b.id)}">MANAGE</button></td>
  </tr>`;
}

function createPanel(){
  return `<section class="pc-panel pc-create">
    <div class="pc-panel-head"><div><span class="pc-kicker">NEW TENANT</span><h2>Provision restaurant</h2></div><button class="pc-mini" id="close-create">CLOSE</button></div>
    <form id="create-form" class="pc-form">
      <label>Restaurant name<input id="new-name" required placeholder="Ghiovaniz Restaurant"></label>
      <label>Homepage URL<input id="new-website" type="url" placeholder="https://restaurant.com"></label>
      <label>Pickup address<input id="new-address" required placeholder="Restaurant address"></label>
      <label>Package<select id="new-plan">${state.packages.map(p=>`<option value="${esc(p.key)}">${esc(p.name)} — ${esc(p.description||'')}${Number(p.monthly_price_kes)?' · '+money(p.monthly_price_kes)+'/month':''}</option>`).join('')}</select></label>
      <label>Restaurant domain (optional)<input id="new-domain" placeholder="orders.restaurant.com"></label>
      <label>Primary colour (optional)<input id="new-color" value="#c96b3b"></label>
      <div class="pc-form-note"><strong>Package rule:</strong> Digital Ordering gives the customer menu + checkout + manager dashboard. Packages with the rider module add the rider dashboard and advanced delivery services.</div>
      <div class="pc-form-actions"><button type="button" class="pc-btn secondary" id="cancel-create">CANCEL</button><button class="pc-btn">PROVISION RESTAURANT</button></div>
    </form>
  </section>`;
}

function bindCreate(){
  document.getElementById('close-create')?.addEventListener('click',()=>{state.showCreate=false;render();});
  document.getElementById('cancel-create')?.addEventListener('click',()=>{state.showCreate=false;render();});
  document.getElementById('create-form')?.addEventListener('submit',createTenant);
}

async function createTenant(e){
  e.preventDefault();
  const button=e.submitter;button.disabled=true;button.textContent='PROVISIONING…';
  try{
    await api('/api/platform/businesses',{method:'POST',body:JSON.stringify({
      name:document.getElementById('new-name').value.trim(),
      websiteUrl:document.getElementById('new-website').value.trim(),
      slug:document.getElementById('new-name').value.trim(),
      address:document.getElementById('new-address').value.trim(),
      planKey:document.getElementById('new-plan').value,
      domain:document.getElementById('new-domain').value.trim(),
      primaryColor:document.getElementById('new-color').value.trim()
    })});
    state.showCreate=false;
    await load();
  }catch(error){button.disabled=false;button.textContent='PROVISION RESTAURANT';alert(error.message);}
}

function bindRows(){
  document.querySelectorAll('.pc-open').forEach(btn=>btn.onclick=()=>{
    state.selected=state.businesses.find(b=>String(b.id)===String(btn.dataset.id))||null;
    render();
  });
}

function detailPanel(b){
  const advanced=riderEnabled(b);
  return `<div class="pc-modal-backdrop" id="detail-backdrop">
    <section class="pc-modal">
      <button class="pc-modal-close" id="detail-close">×</button>
      <div class="pc-modal-head">
        <div><span class="pc-kicker">TENANT CONTROL</span><h2>${esc(b.name)}</h2><p>${esc(b.slug)} · ${esc(b.plan_name||b.plan_key||'STARTER')}</p></div>
        <span class="pc-pill ${b.status==='ACTIVE'?'active':'suspended'}">${esc(b.status)}</span>
      </div>

      <div class="pc-section">
        <span class="pc-kicker">WEBSITE CONNECTION</span>
        <div class="pc-connect-grid">
          <label>Homepage URL<input id="edit-website" value="${esc(b.website_url||'')}" placeholder="https://restaurant.com"></label>
          <label>Domain<input id="edit-domain" value="${esc(b.domain||'')}" placeholder="orders.restaurant.com"></label>
        </div>
        <div class="pc-inline-actions"><button class="pc-btn" id="save-connection">SAVE CONNECTION</button><span id="save-state" class="pc-muted"></span></div>
        <p class="pc-help">The URL identifies the restaurant website. The connector below is what links its Menu / Order Now buttons to this tenant's ordering system. A public URL alone does not grant permission to edit a third-party GitHub, Namecheap, Cloudflare or WordPress site.</p>
      </div>

      <div class="pc-section">
        <span class="pc-kicker">CONNECTED SERVICES</span>
        <div class="pc-service-grid">
          <div class="pc-service"><strong>CUSTOMER</strong><span>Menu + cart + checkout</span><button class="pc-mini copy-link" data-copy="${esc(customerUrl(b))}">COPY CUSTOMER LINK</button></div>
          <div class="pc-service"><strong>MANAGER</strong><span>Restaurant operations</span><button class="pc-mini copy-link" data-copy="${esc(managerUrl(b))}">COPY MANAGER LINK</button></div>
          <div class="pc-service ${advanced?'':'disabled'}"><strong>RIDER</strong><span>${advanced?'Advanced delivery operations':'Not included in this package'}</span>${advanced?`<button class="pc-mini copy-link" data-copy="${esc(riderUrl(b))}">COPY RIDER LINK</button>`:'<span class="pc-module off">NOT CONNECTED</span>'}</div>
        </div>
      </div>

      <div class="pc-section">
        <span class="pc-kicker">WEBSITE CONNECTOR</span>
        <p class="pc-help">Place your homepage's Menu and Order Now elements on the website, then use this small connector so both open the restaurant's customer dashboard.</p>
        <div class="pc-code"><code id="connector-code">${esc(connectorCode(b))}</code></div>
        <div class="pc-inline-actions"><button class="pc-mini" id="copy-connector">COPY CONNECTOR</button><span class="pc-muted">Tenant ID: ${esc(b.id)}</span></div>
      </div>

      <div class="pc-section pc-two">
        <div><span class="pc-kicker">PACKAGE</span><select id="edit-plan">${state.packages.map(p=>`<option value="${esc(p.key)}" ${p.key===b.plan_key?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div><span class="pc-kicker">STATUS</span><select id="edit-status"><option value="ACTIVE" ${b.status==='ACTIVE'?'selected':''}>ACTIVE</option><option value="SUSPENDED" ${b.status==='SUSPENDED'?'selected':''}>SUSPENDED</option></select></div>
      </div>
      <div class="pc-inline-actions"><button class="pc-btn" id="save-tenant">SAVE TENANT SETTINGS</button><button class="pc-btn secondary" id="close-detail-2">CLOSE</button></div>
    </section>
  </div>`;
}

function bindDetail(){
  document.getElementById('detail-close')?.addEventListener('click',closeDetail);
  document.getElementById('close-detail-2')?.addEventListener('click',closeDetail);
  document.getElementById('detail-backdrop')?.addEventListener('click',e=>{if(e.target.id==='detail-backdrop')closeDetail();});
  document.querySelectorAll('.copy-link').forEach(btn=>btn.onclick=()=>copyText(btn.dataset.copy,btn));
  document.getElementById('copy-connector')?.addEventListener('click',()=>copyText(connectorCode(state.selected),document.getElementById('copy-connector')));
  document.getElementById('save-connection')?.addEventListener('click',saveConnection);
  document.getElementById('save-tenant')?.addEventListener('click',saveTenant);
}

function closeDetail(){state.selected=null;render();}

async function saveConnection(){
  const b=state.selected;if(!b)return;
  const button=document.getElementById('save-connection');const status=document.getElementById('save-state');
  button.disabled=true;button.textContent='SAVING…';
  try{
    const updated=await api('/api/platform/businesses/'+encodeURIComponent(b.id),{method:'PATCH',body:JSON.stringify({
      websiteUrl:document.getElementById('edit-website').value.trim(),
      domain:document.getElementById('edit-domain').value.trim()
    })});
    Object.assign(b,updated);status.textContent='Saved';render();
  }catch(error){status.textContent=error.message;button.disabled=false;button.textContent='SAVE CONNECTION';}
}

async function saveTenant(){
  const b=state.selected;if(!b)return;
  const button=document.getElementById('save-tenant');button.disabled=true;button.textContent='SAVING…';
  try{
    await api('/api/platform/businesses/'+encodeURIComponent(b.id),{method:'PATCH',body:JSON.stringify({
      planKey:document.getElementById('edit-plan').value,
      status:document.getElementById('edit-status').value
    })});
    state.selected=null;await load();
  }catch(error){button.disabled=false;button.textContent='SAVE TENANT SETTINGS';alert(error.message);}
}

async function copyText(value,button){
  try{await navigator.clipboard.writeText(value);const old=button.textContent;button.textContent='COPIED';setTimeout(()=>button.textContent=old,1200);}
  catch{window.prompt('Copy this value:',value);}
}

async function logout(){
  try{await api('/api/platform/logout',{method:'POST'});}catch{}
  localStorage.removeItem('platform_admin_token');
  login('You have been signed out.');
}

load();
})();