(function(){
'use strict';

const API='https://restaurant-ordering-api-ow3p.onrender.com';
const root=document.getElementById('platform-view');
const state={
  me:null,overview:{},command:null,businesses:[],packages:[],health:null,orders:[],riders:[],incidents:[],system:null,
  selected:null,selectedInspect:null,showCreate:false,createDraft:{name:'',website:'',address:'',plan:'',domain:'',color:'#c96b3b'},section:'overview',menu:false,loading:false
};
let refreshTimer=null;

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('en-KE',{style:'currency',currency:'KES',maximumFractionDigits:0}).format(Number(v||0));
const dt=v=>v?new Date(v).toLocaleString('en-KE',{dateStyle:'medium',timeStyle:'short'}):'—';
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
        <p>Operate the entire restaurant platform from one independent command centre.</p>
        ${message?`<div class="pc-message pc-error">${esc(message)}</div>`:''}
        <form id="login-form">
          <label>Email<input id="pa-email" type="email" autocomplete="username" required></label>
          <label>Password
            <span class="pc-password-field"><input id="pa-password" type="password" autocomplete="current-password" required><button type="button" class="pc-password-toggle" id="pa-password-toggle">SHOW</button></span>
          </label>
          <button type="submit" class="pc-btn pc-signin-btn">SIGN IN</button>
        </form>
        <div class="pc-login-divider"><span>OR</span></div>
        <div class="pc-google-btn" id="platform-google-btn"></div>
        <p class="pc-google-note">Google will ask which account you want to use before continuing.</p>
        <p class="pc-note">Platform owner access only. Restaurant dashboards remain independent.</p>
      </div>
    </section>`;
  document.getElementById('login-form').addEventListener('submit',loginSubmit);
  document.getElementById('pa-password-toggle').addEventListener('click',togglePlatformPassword);
  googlePlatformLogin();
}

async function loginSubmit(e){
  e.preventDefault();
  const button=e.submitter;button.disabled=true;button.textContent='SIGNING IN…';
  try{
    const data=await api('/api/platform/login',{method:'POST',body:JSON.stringify({email:document.getElementById('pa-email').value.trim(),password:document.getElementById('pa-password').value})});
    localStorage.setItem('platform_admin_token',data.token);await load();
  }catch(error){button.disabled=false;button.textContent='SIGN IN';login(error.message);}
}
function togglePlatformPassword(){
  const input=document.getElementById('pa-password'),button=document.getElementById('pa-password-toggle');
  if(!input||!button)return;
  input.type=input.type==='password'?'text':'password';button.textContent=input.type==='password'?'SHOW':'HIDE';
}

let googlePlatformInitialized=false;
async function loadGoogleIdentity(){
  if(window.google?.accounts?.id)return;
  await new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-google-identity]');
    if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',()=>reject(new Error('Google sign-in could not load.')),{once:true});return;}
    const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.defer=true;script.dataset.googleIdentity='true';script.onload=resolve;script.onerror=()=>reject(new Error('Google sign-in could not load.'));document.head.appendChild(script);
  });
}
async function googlePlatformLogin(){
  const container=document.getElementById('platform-google-btn');if(!container)return;
  try{
    const cfg=await api('/api/platform/google/config');if(!cfg.clientId)throw new Error('Google sign-in is not configured on the server yet.');
    await loadGoogleIdentity();
    if(!googlePlatformInitialized){
      google.accounts.id.initialize({client_id:cfg.clientId,callback:async response=>{
        try{const data=await api('/api/platform/google',{method:'POST',body:JSON.stringify({credential:response.credential})});localStorage.setItem('platform_admin_token',data.token);await load();}
        catch(error){const note=document.querySelector('.pc-google-note');if(note)note.textContent=error.message;}
      }});googlePlatformInitialized=true;
    }
    container.innerHTML='';google.accounts.id.renderButton(container,{type:'standard',theme:'outline',size:'large',text:'continue_with',shape:'rectangular',width:356,logo_alignment:'center'});
  }catch(error){const note=document.querySelector('.pc-google-note');if(note)note.textContent=error.message;}
}

async function load(){
  state.loading=true;
  try{
    state.me=await api('/api/platform/me');
    const results=await Promise.all([
      api('/api/platform/overview'),
      api('/api/platform/businesses'),
      api('/api/platform/packages'),
      api('/api/platform/health').catch(()=>({ok:false,tenants:[],environment:{}})),
      api('/api/platform/command-center').catch(()=>null),
      api('/api/platform/orders?limit=100').catch(()=>[]),
      api('/api/platform/riders?limit=200').catch(()=>[]),
      api('/api/platform/incidents?limit=100').catch(()=>[]),
      api('/api/platform/system').catch(()=>null),
      api('/api/platform/audit?limit=30').catch(()=>[])
    ]);
    [state.overview,state.businesses,state.packages,state.health,state.command,state.orders,state.riders,state.incidents,state.system,state.audit]=results;
    state.loading=false;
    // Keep active forms/modals mounted during background refreshes. Replacing
    // root.innerHTML destroys input elements and clears values being typed.
    if(!state.showCreate&&!state.selected)render();
    clearTimeout(refreshTimer);refreshTimer=setTimeout(load,30000);
  }catch(error){
    state.loading=false;localStorage.removeItem('platform_admin_token');login(error.message);
  }
}

function packageFor(b){return state.packages.find(p=>p.key===b.plan_key);}
function riderEnabled(b){return Boolean(packageFor(b)?.features?.riderModule);}
function incidentClass(s){return String(s||'').toLowerCase();}
function currentSectionLabel(){return ({overview:'Command Centre',restaurants:'Restaurants',orders:'Orders',delivery:'Riders & Delivery',health:'System Health',issues:'Issues & Alerts',activity:'Activity Log',updates:'System Updates'}[state.section]||'Command Centre');}

function render(){
  const o=state.overview||{},c=state.command||{},m=c.metrics||{},t=c.tenants||{};
  root.innerHTML=`
  <div class="pc-shell">
    <header class="pc-nav">
      <div class="pc-brand"><span>PLATFORM OWNER</span><strong>RESTAURANT ORDERING PLATFORM</strong></div>
      <div class="pc-nav-right"><span class="pc-live-dot"></span><span class="pc-admin">${esc(state.me?.name||'Platform Owner')}</span><button class="pc-menu-btn" id="pc-menu-btn">☰ MENU</button></div>
    </header>

    <div class="pc-body">
      <aside class="pc-sidebar">
        ${navItems()}
        <div class="pc-sidebar-foot"><span>BUILD</span><strong>${esc(state.system?.version||'PHASE 6')}</strong><small>Independent platform control</small></div>
      </aside>

      <main class="pc-main">
        <div class="pc-mobile-section"><span class="pc-kicker">CONTROL CENTRE</span><strong>${esc(currentSectionLabel())}</strong></div>
        ${sectionContent()}
      </main>
    </div>

    ${state.menu?menuDrawer():''}
    ${state.showCreate?createPanel():''}
    ${state.selected?tenantPanel(state.selected):''}
  </div>`;

  document.getElementById('pc-menu-btn').onclick=()=>{state.menu=!state.menu;render();};
  bindNav();
  document.getElementById('refresh-btn')?.addEventListener('click',load);
  document.getElementById('health-refresh')?.addEventListener('click',load);
  document.getElementById('add-btn')?.addEventListener('click',()=>{state.showCreate=true;render();document.getElementById('new-name')?.focus();});
  bindCreate();
  bindRows();
  bindTenant();
  bindIncidentActions();
  bindOrderFilter();
}

function navItems(){
  const items=[['overview','⌂','Command Centre'],['restaurants','▦','Restaurants'],['orders','▤','Orders'],['delivery','◉','Riders & Delivery'],['health','✓','System Health'],['issues','!','Issues & Alerts'],['activity','≡','Activity Log'],['updates','↻','System Updates']];
  return '<nav class="pc-nav-menu">'+items.map(([id,icon,label])=>`<button class="${state.section===id?'active':''}" data-section="${id}"><span>${icon}</span>${label}${id==='issues'&&state.incidents.length?`<b class="pc-nav-badge">${state.incidents.length}</b>`:''}</button>`).join('')+'</nav>';
}
function bindNav(){document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{state.section=b.dataset.section;state.menu=false;render();});}
function menuDrawer(){
  return '<div class="pc-drawer-backdrop" id="pc-drawer-backdrop"><aside class="pc-drawer"><div class="pc-drawer-head"><div><span class="pc-kicker">MASTER MENU</span><h2>Control Centre</h2></div><button class="pc-modal-close" id="pc-drawer-close">×</button></div>'+navItems()+'<div class="pc-drawer-rule"></div><button class="pc-drawer-signout" id="logout-btn">SIGN OUT</button><p class="pc-drawer-note">This control centre monitors and operates the platform without connecting restaurant dashboards to one another.</p></aside></div>';
}

function sectionContent(){
  if(state.section==='restaurants')return restaurantsSection();
  if(state.section==='orders')return ordersSection();
  if(state.section==='delivery')return deliverySection();
  if(state.section==='health')return healthSection();
  if(state.section==='issues')return issuesSection();
  if(state.section==='activity')return activitySection();
  if(state.section==='updates')return updatesSection();
  return overviewSection();
}

function overviewSection(){
  const c=state.command||{},m=c.metrics||{},t=c.tenants||{},issues=c.openIssues||[];
  return `
  <header class="pc-head">
    <div><span class="pc-kicker">MASTER CONTROL CENTRE</span><h1>Everything under control.</h1><p>Monitor restaurants, orders, delivery, devices, integrations, health and platform activity from one independent owner view.</p></div>
    <div class="pc-actions"><button class="pc-btn" id="add-btn">+ ADD RESTAURANT</button><button class="pc-btn secondary" id="refresh-btn">REFRESH</button></div>
  </header>
  <section class="pc-grid pc-grid-6">
    ${stat('RESTAURANTS',t.active||0,'active of '+(t.total||0))}${stat('ORDERS TODAY',m.ordersToday||0,'all restaurants')}${stat('PAID VALUE',money(m.paidValue),'paid order value')}${stat('ACTIVE TRIPS',m.activeTrips||0,(m.onlineRiders||0)+' riders online')}${stat('CUSTOMERS',m.customers||0,'customer records')}${stat('OPEN ISSUES',c.incidents?.total||0,(c.incidents?.critical||0)+' critical')}
  </section>
  ${healthPanel()}
  <div class="pc-two-col">
    <section class="pc-panel"><div class="pc-panel-head"><div><span class="pc-kicker">LIVE OPERATIONS</span><h2>Recent orders</h2></div><button class="pc-mini" data-section="orders">VIEW ALL</button></div>${recentOrders(c.recentOrders||[])}</section>
    <section class="pc-panel"><div class="pc-panel-head"><div><span class="pc-kicker">ATTENTION</span><h2>Open issues</h2></div><button class="pc-mini" data-section="issues">ISSUE CENTRE</button></div>${issueRows(issues.slice(0,6))}</section>
  </div>`;
}
function stat(label,value,note){return '<article class="pc-stat"><span>'+label+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></article>';}

function healthPanel(){
  const h=state.health||{},env=h.environment||{},tenants=h.tenants||[];
  const envItems=[['DATABASE',env.database],['GOOGLE MAPS',env.googleMaps],['SMS',env.smsProvider],['PAYMENTS',env.payments]];
  const broken=tenants.filter(t=>!t.ok&&t.status==='ACTIVE').length;
  return `<section class="pc-panel pc-health"><div class="pc-panel-head"><div><span class="pc-kicker">AUTOMATIC HEALTH</span><h2>System health</h2><p class="pc-panel-sub">The platform checks its infrastructure and every active restaurant.</p></div><div class="pc-health-actions"><span class="pc-health-status ${h.ok?'ok':'warn'}">${h.ok?'HEALTHY':'ATTENTION NEEDED'}</span><button class="pc-mini" id="health-refresh">RUN CHECK</button></div></div><div class="pc-health-grid">${envItems.map(x=>'<div class="pc-health-card"><span>'+x[0]+'</span><strong class="'+(x[1]?'ok':'warn')+'">'+(x[1]?'READY':'NOT CONFIGURED')+'</strong></div>').join('')}<div class="pc-health-card"><span>RESTAURANTS</span><strong>'+tenants.length+'</strong><small>'+broken+' active issue'+(broken===1?'':'s')+'</small></div></div><div class="pc-health-foot"><span>Checked '+(h.checkedAt?dt(h.checkedAt):'not yet')+'</span><span>'+((h.responseMs||0)?h.responseMs+' ms':'')+'</span></div></section>`;
}

function restaurantsSection(){
  return `
  <header class="pc-head compact"><div><span class="pc-kicker">TENANT OPERATIONS</span><h1>Restaurants.</h1><p>Every tenant, package, integration and operational state is visible here without opening another dashboard.</p></div><div class="pc-actions"><button class="pc-btn" id="add-btn">+ ADD RESTAURANT</button><button class="pc-btn secondary" id="refresh-btn">REFRESH</button></div></header>
  <section class="pc-panel"><div class="pc-panel-head"><div><span class="pc-kicker">TENANTS</span><h2>Restaurant registry</h2></div><span class="pc-count">${state.businesses.length} tenant${state.businesses.length===1?'':'s'}</span></div><div class="pc-table-wrap"><table class="pc-table"><thead><tr><th>RESTAURANT</th><th>PACKAGE</th><th>WEBSITE</th><th>RIDER</th><th>ORDERS</th><th>REVENUE</th><th>STATUS</th><th></th></tr></thead><tbody>${state.businesses.length?state.businesses.map(row).join(''):'<tr><td colspan="8" class="pc-empty">No restaurants have been provisioned.</td></tr>'}</tbody></table></div></section>`;
}
function row(b){
  const advanced=riderEnabled(b);
  return '<tr><td><div class="pc-tenant-name"><span class="pc-logo-dot" style="background:'+esc(b.primary_color||'#c96b3b')+'"></span><div><strong>'+esc(b.name)+'</strong><small>'+esc(b.slug)+'</small></div></div></td><td><strong>'+esc(b.plan_name||b.plan_key||'STARTER')+'</strong></td><td><span class="pc-site">'+esc(b.website_url||'Not connected')+'</span></td><td><span class="pc-module '+(advanced?'on':'off')+'">'+(advanced?'ENABLED':'NOT INCLUDED')+'</span></td><td>'+Number(b.order_count||0)+'</td><td>'+money(b.revenue)+'</td><td><span class="pc-pill '+(b.status==='ACTIVE'?'active':'suspended')+'">'+esc(b.status)+'</span></td><td><button class="pc-mini pc-open" data-id="'+esc(b.id)+'">INSPECT</button></td></tr>';
}

function ordersSection(){
  const filtered=state.orders;
  return `<header class="pc-head compact"><div><span class="pc-kicker">PLATFORM ORDERS</span><h1>Orders.</h1><p>Read-only platform-wide order visibility. Order controls remain in the restaurant manager and order station workflows.</p></div><button class="pc-btn secondary" id="refresh-btn">REFRESH</button></header>
  <section class="pc-panel"><div class="pc-toolbar"><input id="order-filter" placeholder="Filter by order number or restaurant…"><span>${filtered.length} recent orders</span></div><div class="pc-table-wrap"><table class="pc-table" id="orders-table"><thead><tr><th>ORDER</th><th>RESTAURANT</th><th>STATUS</th><th>PAYMENT</th><th>DELIVERY</th><th>VALUE</th><th>CREATED</th></tr></thead><tbody>${orderRows(filtered)}</tbody></table></div></section>`;
}
function orderRows(rows){return rows.length?rows.map(o=>'<tr><td><strong>'+esc(o.order_number)+'</strong></td><td>'+esc(o.business_name)+'</td><td><span class="pc-status-text">'+esc(o.status||'—')+'</span></td><td>'+esc(o.payment_status||'—')+'</td><td>'+esc(o.delivery_status||'—')+'</td><td>'+money(o.total)+'</td><td>'+dt(o.created_at)+'</td></tr>').join(''):'<tr><td colspan="7" class="pc-empty">No orders found.</td></tr>';}
function bindOrderFilter(){const input=document.getElementById('order-filter');if(!input)return;input.oninput=()=>{const q=input.value.trim().toLowerCase();const rows=state.orders.filter(o=>!q||String(o.order_number||'').toLowerCase().includes(q)||String(o.business_name||'').toLowerCase().includes(q));document.querySelector('#orders-table tbody').innerHTML=orderRows(rows);};}

function deliverySection(){
  return `<header class="pc-head compact"><div><span class="pc-kicker">DELIVERY OPERATIONS</span><h1>Riders & delivery.</h1><p>Monitor every restaurant's riders and active delivery state without opening a rider dashboard.</p></div><button class="pc-btn secondary" id="refresh-btn">REFRESH</button></header>
  <section class="pc-panel"><div class="pc-table-wrap"><table class="pc-table"><thead><tr><th>RIDER</th><th>RESTAURANT</th><th>STATUS</th><th>AVAILABILITY</th><th>ACTIVE ORDER</th><th>LAST PRESENCE</th></tr></thead><tbody>${state.riders.length?state.riders.map(r=>'<tr><td><strong>'+esc(r.name)+'</strong><small class="pc-cell-sub">'+esc(r.phone||'')+'</small></td><td>'+esc(r.business_name)+'</td><td><span class="pc-pill '+(r.rider_status==='ACTIVE'?'active':'suspended')+'">'+esc(r.rider_status||'—')+'</span></td><td><span class="pc-module '+(r.online?'on':'off')+'">'+(r.online?'ONLINE':'OFFLINE')+'</span></td><td>'+esc(r.order_number||'—')+'</td><td>'+dt(r.presence_updated_at)+'</td></tr>').join(''):'<tr><td colspan="6" class="pc-empty">No riders registered.</td></tr>'}</tbody></table></div></section>`;
}

function healthSection(){
  const h=state.health||{},tenants=h.tenants||[];
  return `<header class="pc-head compact"><div><span class="pc-kicker">DIAGNOSTICS</span><h1>System health.</h1><p>Infrastructure readiness plus a tenant-by-tenant diagnostic view.</p></div><button class="pc-btn" id="health-refresh">RUN FULL CHECK</button></header>
  <section class="pc-panel">${healthPanel().replace(/^<section[^>]*>|<\/section>$/g,'')}</section>
  <section class="pc-panel"><div class="pc-panel-head"><div><span class="pc-kicker">TENANT DIAGNOSTICS</span><h2>Restaurant health matrix</h2></div></div><div class="pc-table-wrap"><table class="pc-table"><thead><tr><th>RESTAURANT</th><th>STATUS</th><th>PACKAGE</th><th>ISSUES</th><th></th></tr></thead><tbody>${tenants.map(t=>'<tr><td><strong>'+esc(t.name)+'</strong><small class="pc-cell-sub">'+esc(t.slug)+'</small></td><td><span class="pc-pill '+(t.status==='ACTIVE'?'active':'suspended')+'">'+esc(t.status)+'</span></td><td>'+esc(t.planKey||'—')+'</td><td>'+esc(t.issues?.join(' · ')||'NONE')+'</td><td><button class="pc-mini pc-open" data-id="'+esc(t.id)+'">INSPECT</button></td></tr>').join('')}</tbody></table></div></section>`;
}

function issuesSection(){
  return `<header class="pc-head compact"><div><span class="pc-kicker">OBSERVABILITY</span><h1>Issues & alerts.</h1><p>Frontend and platform errors are collected here by restaurant and dashboard source so you can identify where a failure occurred.</p></div><button class="pc-btn secondary" id="refresh-btn">REFRESH</button></header>
  <section class="pc-panel"><div class="pc-table-wrap"><table class="pc-table"><thead><tr><th>SEVERITY</th><th>DASHBOARD</th><th>RESTAURANT</th><th>ERROR</th><th>OCCURRENCES</th><th>LAST SEEN</th><th></th></tr></thead><tbody>${issueRows(state.incidents,true)}</tbody></table></div></section>`;
}
function issueRows(rows,table=false){
  if(!rows.length)return table?'<tr><td colspan="7" class="pc-empty">No open issues. The platform is clear.</td></tr>':'<div class="pc-empty-card">No open issues.</div>';
  if(table)return rows.map(i=>'<tr><td><span class="pc-severity '+incidentClass(i.severity)+'">'+esc(i.severity)+'</span></td><td>'+esc(i.dashboard||i.source||'UNKNOWN')+'</td><td>'+esc(i.business_name||'Platform')+'</td><td class="pc-issue-message">'+esc(i.message)+'</td><td>'+Number(i.occurrences||1)+'</td><td>'+dt(i.last_seen_at)+'</td><td><button class="pc-mini pc-resolve" data-id="'+esc(i.id)+'">RESOLVE</button></td></tr>').join('');
  return rows.map(i=>'<div class="pc-issue-row"><span class="pc-severity '+incidentClass(i.severity)+'">'+esc(i.severity)+'</span><div><strong>'+esc(i.message)+'</strong><small>'+esc(i.business_name||'Platform')+' · '+esc(i.dashboard||i.source||'UNKNOWN')+' · '+Number(i.occurrences||1)+' occurrence'+(Number(i.occurrences||1)===1?'':'s')+'</small></div></div>').join('');
}
function bindIncidentActions(){document.querySelectorAll('.pc-resolve').forEach(b=>b.onclick=async()=>{b.disabled=true;b.textContent='…';try{await api('/api/platform/incidents/'+encodeURIComponent(b.dataset.id)+'/resolve',{method:'POST',body:'{}'});await load();}catch(e){alert(e.message);b.disabled=false;b.textContent='RESOLVE';}});}

function activitySection(){
  return `<header class="pc-head compact"><div><span class="pc-kicker">AUDIT TRAIL</span><h1>Activity log.</h1><p>A chronological record of platform-owner and system activity.</p></div><button class="pc-btn secondary" id="refresh-btn">REFRESH</button></header>
  <section class="pc-panel"><div class="pc-activity-list">${(state.audit||[]).length?(state.audit||[]).map(a=>'<article><span class="pc-activity-dot"></span><div><strong>'+esc(a.action)+'</strong><p>'+esc(a.note||'System event')+'</p></div><time>'+dt(a.created_at)+'</time></article>').join(''):'<div class="pc-empty-card">No activity recorded yet.</div>'}</div></section>`;
}

function updatesSection(){
  const s=state.system||{};
  return `<header class="pc-head compact"><div><span class="pc-kicker">PLATFORM OS</span><h1>System updates.</h1><p>The platform owner controls the system as a product. Releases can be versioned, audited and rolled forward without connecting restaurant dashboards to one another.</p></div></header>
  <div class="pc-two-col"><section class="pc-panel"><span class="pc-kicker">CURRENT BUILD</span><h2>${esc(s.version||'Unknown')}</h2><div class="pc-update-grid"><div><span>API</span><strong>ONLINE</strong></div><div><span>NODE</span><strong>${esc(s.node||'—')}</strong></div><div><span>DATABASE</span><strong>CONNECTED</strong></div><div><span>CHANGE CONTROL</span><strong>GIT + RENDER</strong></div></div></section>
  <section class="pc-panel"><span class="pc-kicker">CAPABILITIES</span><h2>Platform services</h2><div class="pc-cap-list">${Object.entries(s.capabilities||{}).map(([k,v])=>'<div><span>'+esc(k.replace(/([A-Z])/g,' $1').toUpperCase())+'</span><strong class="'+(v?'ok':'warn')+'">'+(v?'READY':'NOT CONFIGURED')+'</strong></div>').join('')}</div></section></div>
  <section class="pc-panel pc-update-note"><span class="pc-kicker">UPDATE ARCHITECTURE</span><h2>Ready for future OS releases</h2><p>Future platform releases can be introduced as versioned backend/frontend changes, recorded in the audit trail and surfaced here. Restaurant dashboards remain independent; the Control Centre is the owner-level operations layer.</p><div class="pc-release-flow"><span>CODE</span><b>→</b><span>BUILD</span><b>→</b><span>DEPLOY</span><b>→</b><span>HEALTH CHECK</span><b>→</b><span>RELEASE</span></div></section>`;
}

function recentOrders(rows){
  return rows.length?'<div class="pc-list">'+rows.map(o=>'<div class="pc-list-row"><div><strong>'+esc(o.order_number)+'</strong><small>'+esc(o.business_name)+' · '+esc(o.status||'—')+'</small></div><strong>'+money(o.total)+'</strong></div>').join('')+'</div>':'<div class="pc-empty-card">No orders yet.</div>';
}

function createPanel(){
  const d=state.createDraft||{};
  return `<div class="pc-modal-backdrop" id="create-backdrop"><section class="pc-modal pc-create-modal"><button class="pc-modal-close" id="close-create">×</button><div class="pc-modal-head"><div><span class="pc-kicker">NEW TENANT</span><h2>Provision restaurant</h2><p>Create the tenant and its core platform services.</p></div></div><form id="create-form" class="pc-form"><label>Restaurant name<input id="new-name" required placeholder="Restaurant name" value="${esc(d.name||'')}"></label><label>Homepage URL<input id="new-website" type="url" placeholder="https://restaurant.com" value="${esc(d.website||'')}"></label><label>Pickup address<input id="new-address" required placeholder="Restaurant address" value="${esc(d.address||'')}"></label><label>Package<select id="new-plan">${state.packages.map((p,i)=>'<option value="'+esc(p.key)+'" '+((d.plan&&d.plan===p.key)||(!d.plan&&i===0)?'selected':'')+'>'+esc(p.name)+' — '+esc(p.description||'')+'</option>').join('')}</select></label><label>Restaurant domain<input id="new-domain" placeholder="orders.restaurant.com" value="${esc(d.domain||'')}"></label><label>Primary colour<input id="new-color" value="${esc(d.color||'#c96b3b')}"></label><div class="pc-form-note"><strong>Isolation rule:</strong> provisioning creates tenant infrastructure. Dashboards remain independently accessed.</div><div class="pc-form-actions"><button type="button" class="pc-btn secondary" id="cancel-create">CANCEL</button><button class="pc-btn">PROVISION RESTAURANT</button></div></form></section></div>`;
}
function bindCreate(){
  const closeCreate=()=>{state.showCreate=false;state.createDraft={name:'',website:'',address:'',plan:'',domain:'',color:'#c96b3b'};render();};
  document.getElementById('close-create')?.addEventListener('click',closeCreate);
  document.getElementById('cancel-create')?.addEventListener('click',closeCreate);
  const form=document.getElementById('create-form');
  form?.addEventListener('input',e=>{
    const map={name:'name',website:'website',address:'address',domain:'domain',color:'color'};
    if(map[e.target.id])state.createDraft[map[e.target.id]]=e.target.value;
  });
  form?.addEventListener('change',e=>{if(e.target.id==='new-plan')state.createDraft.plan=e.target.value;});
  form?.addEventListener('submit',createTenant);
  document.getElementById('pc-drawer-close')?.addEventListener('click',()=>{state.menu=false;render();});
  document.getElementById('pc-drawer-backdrop')?.addEventListener('click',e=>{if(e.target.id==='pc-drawer-backdrop'){state.menu=false;render();}});
  document.getElementById('logout-btn')?.addEventListener('click',logout);
}
async function createTenant(e){
  e.preventDefault();const button=e.submitter;button.disabled=true;button.textContent='PROVISIONING…';
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
    state.createDraft={name:'',website:'',address:'',plan:'',domain:'',color:'#c96b3b'};
    await load();
  }catch(error){button.disabled=false;button.textContent='PROVISION RESTAURANT';alert(error.message);}
}

function tenantPanel(b){
  return '<div class="pc-modal-backdrop" id="tenant-backdrop"><section class="pc-modal pc-tenant-modal"><button class="pc-modal-close" id="tenant-close">×</button><div class="pc-modal-head"><div><span class="pc-kicker">TENANT INSPECTOR</span><h2>'+esc(b.name)+'</h2><p>'+esc(b.slug)+' · '+esc(b.plan_name||b.plan_key||'STARTER')+'</p></div><span class="pc-pill '+(b.status==='ACTIVE'?'active':'suspended')+'">'+esc(b.status)+'</span></div>'+tenantInspectorContent()+'<div class="pc-section"><span class="pc-kicker">CONTROL</span><div class="pc-two"><label>PACKAGE<select id="edit-plan">'+state.packages.map(p=>'<option value="'+esc(p.key)+'" '+(p.key===b.plan_key?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label><label>STATUS<select id="edit-status"><option value="ACTIVE" '+(b.status==='ACTIVE'?'selected':'')+'>ACTIVE</option><option value="SUSPENDED" '+(b.status==='SUSPENDED'?'selected':'')+'>SUSPENDED</option></select></label></div><div class="pc-inline-actions"><button class="pc-btn" id="save-tenant">SAVE TENANT SETTINGS</button></div></div></section></div>';
}
function tenantInspectorContent(){
  if(!state.selectedInspect)return '<div class="pc-loading">Loading tenant system data…</div>';
  const x=state.selectedInspect,c=x.counts||{},h=x.health||{};
  return '<div class="pc-tenant-overview"><div><span>STATUS</span><strong>'+esc(x.restaurant.status)+'</strong></div><div><span>CUSTOMERS</span><strong>'+Number(c.customers||0)+'</strong></div><div><span>ORDERS</span><strong>'+Number(c.orders||0)+'</strong></div><div><span>RIDERS</span><strong>'+Number(c.riders||0)+'</strong></div><div><span>ACTIVE TRIPS</span><strong>'+Number(c.active_trips||0)+'</strong></div><div><span>STATIONS</span><strong>'+Number(c.active_stations||0)+'</strong></div></div><div class="pc-section"><span class="pc-kicker">SERVICE HEALTH</span><div class="pc-service-health">'+(h.ok?'<strong class="pc-health-ok">ALL CORE SERVICES READY</strong>':'<strong class="pc-health-warn">'+esc(h.issues?.join(' · ')||'ATTENTION NEEDED')+'</strong>')+'</div></div><div class="pc-section"><span class="pc-kicker">RECENT TENANT ORDERS</span><div class="pc-table-wrap"><table class="pc-table"><thead><tr><th>ORDER</th><th>STATUS</th><th>PAYMENT</th><th>VALUE</th><th>CREATED</th></tr></thead><tbody>'+((x.orders||[]).length?x.orders.map(o=>'<tr><td>'+esc(o.order_number)+'</td><td>'+esc(o.status)+'</td><td>'+esc(o.payment_status)+'</td><td>'+money(o.total)+'</td><td>'+dt(o.created_at)+'</td></tr>').join(''):'<tr><td colspan="5" class="pc-empty">No orders yet.</td></tr>')+'</tbody></table></div></div><div class="pc-section"><span class="pc-kicker">TENANT ACTIVITY</span><div class="pc-list">'+((x.audit||[]).length?x.audit.map(a=>'<div class="pc-list-row"><div><strong>'+esc(a.action)+'</strong><small>'+esc(a.note||'System event')+'</small></div><small>'+dt(a.created_at)+'</small></div>').join(''):'<div class="pc-empty-card">No tenant activity yet.</div>')+'</div></div>';
}
async function bindRows(){
  document.querySelectorAll('.pc-open').forEach(btn=>btn.onclick=async()=>{
    state.selected=state.businesses.find(b=>String(b.id)===String(btn.dataset.id))||null;state.selectedInspect=null;render();
    try{state.selectedInspect=await api('/api/platform/businesses/'+encodeURIComponent(btn.dataset.id)+'/inspect');render();}catch(e){alert(e.message);}
  });
}
function bindTenant(){
  document.getElementById('tenant-close')?.addEventListener('click',()=>{state.selected=null;state.selectedInspect=null;render();});
  document.getElementById('tenant-backdrop')?.addEventListener('click',e=>{if(e.target.id==='tenant-backdrop'){state.selected=null;state.selectedInspect=null;render();}});
  document.getElementById('save-tenant')?.addEventListener('click',saveTenant);
}
async function saveTenant(){
  const b=state.selected;if(!b)return;const button=document.getElementById('save-tenant');button.disabled=true;button.textContent='SAVING…';
  try{await api('/api/platform/businesses/'+encodeURIComponent(b.id),{method:'PATCH',body:JSON.stringify({planKey:document.getElementById('edit-plan').value,status:document.getElementById('edit-status').value})});state.selected=null;state.selectedInspect=null;await load();}
  catch(e){button.disabled=false;button.textContent='SAVE TENANT SETTINGS';alert(e.message);}
}
async function logout(){try{await api('/api/platform/logout',{method:'POST'});}catch{}localStorage.removeItem('platform_admin_token');login('You have been signed out.');}

load();
})();