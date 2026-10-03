(function(){
'use strict';

const API=window.PLATFORM_API_ORIGIN || 'https://restaurant-ordering-api-ow3p.onrender.com';
const root=document.getElementById('platform-view');
const state={
  me:null,overview:{},command:null,businesses:[],packages:[],health:null,disputes:[],incidents:[],audit:[],system:null,
  selected:null,selectedInspect:null,selectedCase:null,showCreate:false,section:'overview',menu:false,loading:false,complianceProcessors:[],privacyIncidents:[]
};
let refreshTimer=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dt=v=>v?new Date(v).toLocaleString('en-KE',{dateStyle:'medium',timeStyle:'short'}):'—';
const token=()=>window.PlatformSession?PlatformSession.getLegacyToken('platform'):localStorage.getItem('platform_admin_token')||'';

async function api(path,opt={}){
  const headers={'Content-Type':'application/json',...(opt.headers||{})};
  if(token())headers.Authorization='Bearer '+token();
  const response=await fetch(API+path,{...opt,headers});
  const raw=await response.text();
  let data={};
  try{data=raw?JSON.parse(raw):{};}catch{}
  if(!response.ok){
    const detail=data.error||raw.replace(/<[^>]*>/g,' ').replace(/\\s+/g,' ').trim();
    throw new Error(detail||('Platform request failed (HTTP '+response.status+')'));
  }
  return data;
  return data;
}

function login(message){
  root.innerHTML='<section class="pc-login"><div class="pc-login-card"><span class="pc-kicker">PLATFORM OWNER</span><h1>Control Centre.</h1><p>Platform operations, security, health and controlled dispute evidence — without routine access to restaurant/customer operational data.</p>'+
    (message?'<div class="pc-message pc-error">'+esc(message)+'</div>':'')+
    '<form id="login-form"><label>Email<input id="pa-email" type="email" autocomplete="username" required></label><label>Password<span class="pc-password-field"><input id="pa-password" type="password" autocomplete="current-password" required><button type="button" class="pc-password-toggle" id="pa-password-toggle">SHOW</button></span></label><button type="submit" class="pc-btn pc-signin-btn">SIGN IN</button></form>'+
    '<div class="pc-login-divider"><span>OR</span></div><div class="pc-google-btn" id="platform-google-btn"></div><p class="pc-google-note">Google will ask which account you want to use before continuing.</p><p class="pc-note">Platform owner access only. Restaurant dashboards remain independent.</p></div></section>';
  document.getElementById('login-form').addEventListener('submit',loginSubmit);
  document.getElementById('pa-password-toggle').addEventListener('click',togglePlatformPassword);
  googlePlatformLogin();
}

async function loginSubmit(e){
  e.preventDefault();
  const button=e.submitter;button.disabled=true;button.textContent='SIGNING IN…';
  try{
    const data=await api('/api/platform/login',{method:'POST',body:JSON.stringify({email:document.getElementById('pa-email').value.trim(),password:document.getElementById('pa-password').value})});
    if(window.PlatformSession)PlatformSession.setLegacyToken('platform',data.token);else localStorage.setItem('platform_admin_token',data.token);
    await load();
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
        try{const data=await api('/api/platform/google',{method:'POST',body:JSON.stringify({credential:response.credential})});if(window.PlatformSession)PlatformSession.setLegacyToken('platform',data.token);else localStorage.setItem('platform_admin_token',data.token);await load();}
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
      api('/api/control/disputes?status=ALL').catch(()=>[]),
      api('/api/platform/incidents?limit=100').catch(()=>[]),
      api('/api/platform/system').catch(()=>null),
      api('/api/platform/audit?limit=30').catch(()=>[]),
      api('/api/platform/compliance/processors').catch(()=>[]),
      api('/api/platform/compliance/incidents').catch(()=>[])
    ]);
    [state.overview,state.businesses,state.packages,state.health,state.command,state.disputes,state.incidents,state.system,state.audit,state.complianceProcessors,state.privacyIncidents]=results;
    state.loading=false;
    if(!state.selected&&!state.selectedCase)render();
    clearTimeout(refreshTimer);refreshTimer=setTimeout(load,30000);
  }catch(error){
    state.loading=false;
    if(window.PlatformSession)PlatformSession.clearLegacyToken('platform');else localStorage.removeItem('platform_admin_token');
    login(error.message);
  }
}

function packageFor(b){return state.packages.find(p=>p.key===b.plan_key);}
function currentSectionLabel(){return ({overview:'Command Centre',restaurants:'Restaurants',disputes:'Dispute Access',health:'System Health',issues:'Issues & Alerts',activity:'Activity Log',updates:'System Updates'}[state.section]||'Command Centre');}

function render(){
  root.innerHTML='<div class="pc-shell"><header class="pc-nav"><div class="pc-brand"><span>PLATFORM OWNER</span><strong>RESTAURANT ORDERING PLATFORM</strong></div><div class="pc-nav-right"><span class="pc-live-dot"></span><span class="pc-admin">'+esc(state.me?.name||'Platform Owner')+'</span><button class="pc-menu-btn" id="pc-menu-btn">☰ MENU</button></div></header>'+
    '<div class="pc-body"><aside class="pc-sidebar">'+navItems()+'<div class="pc-sidebar-foot"><span>SECURITY MODEL</span><strong>ISOLATED DATA</strong><small>Break-glass dispute access</small></div></aside><main class="pc-main"><div class="pc-mobile-section"><span class="pc-kicker">CONTROL CENTRE</span><strong>'+esc(currentSectionLabel())+'</strong></div>'+sectionContent()+'</main></div>'+
    (state.menu?menuDrawer():'')+(state.showCreate?createPanel():'')+(state.selected?tenantPanel(state.selected):'')+(state.selectedCase?disputePanel():'')+'</div>';
  document.getElementById('pc-menu-btn')?.addEventListener('click',()=>{state.menu=!state.menu;render();});
  bindNav();document.getElementById('refresh-btn')?.addEventListener('click',load);document.getElementById('health-refresh')?.addEventListener('click',load);
  document.getElementById('add-btn')?.addEventListener('click',()=>{state.showCreate=true;render();document.getElementById('new-name')?.focus();});
  bindCreate();bindRows();bindDisputes();bindIncidentActions();bindTenant();
}

function navItems(){
  const items=[['overview','⌂','Command Centre'],['restaurants','▦','Restaurants'],['disputes','⚖','Dispute Access'],['health','✓','System Health'],['issues','!','Issues & Alerts'],['activity','≡','Activity Log'],['updates','↻','System Updates'],['compliance','⚖','Compliance']];
  return '<nav class="pc-nav-menu">'+items.map(x=>'<button class="'+(state.section===x[0]?'active':'')+'" data-section="'+x[0]+'"><span>'+x[1]+'</span>'+x[2]+(x[0]==='issues'&&state.incidents.length?'<b class="pc-nav-badge">'+state.incidents.length+'</b>':'')+'</button>').join('')+'</nav>';
}
function bindNav(){document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{state.section=b.dataset.section;state.menu=false;state.selectedCase=null;render();});}
function menuDrawer(){return '<div class="pc-drawer-backdrop"><aside class="pc-drawer"><div class="pc-drawer-head"><div><span class="pc-kicker">MASTER MENU</span><h2>Control Centre</h2></div><button class="pc-modal-close" id="pc-drawer-close">×</button></div>'+navItems()+'<div class="pc-drawer-rule"></div><button class="pc-drawer-signout" id="logout-btn">SIGN OUT</button><p class="pc-drawer-note">Normal Control Centre access excludes restaurant orders, revenue, customer records and rider personal data.</p></aside></div>';}

function sectionContent(){
  if(state.section==='restaurants')return restaurantsSection();
  if(state.section==='disputes')return disputesSection();
  if(state.section==='health')return healthSection();
  if(state.section==='issues')return issuesSection();
  if(state.section==='activity')return activitySection();
  if(state.section==='updates')return updatesSection();
  if(state.section==='compliance')return complianceSection();
  return overviewSection();
}

function stat(label,value,note){return '<article class="pc-stat"><span>'+label+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></article>';}
function overviewSection(){
  const o=state.overview||{},c=state.command||{};
  return '<header class="pc-head"><div><span class="pc-kicker">MASTER CONTROL CENTRE</span><h1>Platform, not restaurant data.</h1><p>Operate platform configuration, health, security and disputes without routine access to restaurant orders, revenue, customer records or rider personal data.</p></div><div class="pc-actions"><button class="pc-btn" id="add-btn">+ ADD RESTAURANT</button><button class="pc-btn secondary" id="refresh-btn">REFRESH</button></div></header>'+
    '<section class="pc-grid pc-grid-6">'+stat('RESTAURANTS',o.restaurants||0,'tenant registry')+stat('ACTIVE',o.active||0,'active tenants')+stat('INTEGRATIONS',c.metrics?.activeIntegrations||0,'active integrations')+stat('OPEN ISSUES',c.incidents?.total||0,(c.incidents?.critical||0)+' critical')+stat('DISPUTES',state.disputes.length,'controlled evidence cases')+stat('DIRECT DB','BLOCKED','no general browsing')+'</section>'+
    healthPanel()+
    '<div class="pc-two-col"><section class="pc-panel"><div class="pc-panel-head"><div><span class="pc-kicker">DATA ACCESS</span><h2>Isolation policy</h2></div><button class="pc-mini" data-section="disputes">OPEN DISPUTE ACCESS</button></div><div class="pc-list">'+
    '<div class="pc-list-row"><div><strong>Restaurant orders</strong><small>Removed from the normal Control Centre.</small></div><strong class="pc-health-ok">BLOCKED</strong></div>'+
    '<div class="pc-list-row"><div><strong>Restaurant revenue</strong><small>No platform-wide revenue browser.</small></div><strong class="pc-health-ok">BLOCKED</strong></div>'+
    '<div class="pc-list-row"><div><strong>Customer personal data</strong><small>Not returned by normal platform endpoints.</small></div><strong class="pc-health-ok">BLOCKED</strong></div>'+
    '<div class="pc-list-row"><div><strong>Dispute evidence</strong><small>Purpose-bound, minimum-necessary and time-limited.</small></div><strong class="pc-health-ok">CONTROLLED</strong></div>'+
    '</div></section><section class="pc-panel"><div class="pc-panel-head"><div><span class="pc-kicker">ATTENTION</span><h2>Open issues</h2></div><button class="pc-mini" data-section="issues">ISSUE CENTRE</button></div>'+issueRows((c.openIssues||[]).slice(0,6))+'</section></div>';
}
function healthPanel(){
  const h=state.health||{},env=h.environment||{},tenants=h.tenants||[];
  const envItems=[['DATABASE',env.database],['GOOGLE MAPS',env.googleMaps],['SMS',env.smsProvider],['PAYMENTS',env.payments]];
  return '<section class="pc-panel pc-health"><div class="pc-panel-head"><div><span class="pc-kicker">AUTOMATIC HEALTH</span><h2>System health</h2><p class="pc-panel-sub">Infrastructure and tenant configuration health only.</p></div><div class="pc-health-actions"><span class="pc-health-status '+(h.ok?'ok':'warn')+'">'+(h.ok?'HEALTHY':'ATTENTION NEEDED')+'</span><button class="pc-mini" id="health-refresh">RUN CHECK</button></div></div><div class="pc-health-grid">'+envItems.map(x=>'<div class="pc-health-card"><span>'+x[0]+'</span><strong class="'+(x[1]?'ok':'warn')+'">'+(x[1]?'READY':'NOT CONFIGURED')+'</strong></div>').join('')+'<div class="pc-health-card"><span>TENANTS</span><strong>'+tenants.length+'</strong><small>configuration checks only</small></div></div><div class="pc-health-foot"><span>Checked '+(h.checkedAt?dt(h.checkedAt):'not yet')+'</span><span>'+((h.responseMs||0)?h.responseMs+' ms':'')+'</span></div></section>';
}

function restaurantsSection(){
  return '<header class="pc-head compact"><div><span class="pc-kicker">TENANT OPERATIONS</span><h1>Restaurants.</h1><p>Tenant registry and configuration only. Operational records and personal data remain outside the normal Control Centre surface.</p></div><div class="pc-actions"><button class="pc-btn" id="add-btn">+ ADD RESTAURANT</button><button class="pc-btn secondary" id="refresh-btn">REFRESH</button></div></header>'+
    '<section class="pc-panel"><div class="pc-panel-head"><div><span class="pc-kicker">TENANTS</span><h2>Restaurant registry</h2></div><span class="pc-count">'+state.businesses.length+' tenant'+(state.businesses.length===1?'':'s')+'</span></div><div class="pc-table-wrap"><table class="pc-table"><thead><tr><th>RESTAURANT</th><th>PACKAGE</th><th>WEBSITE</th><th>INTEGRATION</th><th>STATUS</th><th></th></tr></thead><tbody>'+(
      state.businesses.length?state.businesses.map(row).join(''):'<tr><td colspan="6" class="pc-empty">No restaurants have been provisioned.</td></tr>'
    )+'</tbody></table></div></section>';
}
function row(b){
  return '<tr><td><div class="pc-tenant-name"><span class="pc-logo-dot" style="background:'+esc(b.primary_color||'#c96b3b')+'"></span><div><strong>'+esc(b.name)+'</strong><small>'+esc(b.slug)+'</small></div></div></td><td><strong>'+esc(b.plan_name||b.plan_key||'STARTER')+'</strong></td><td><span class="pc-site">'+esc(b.website_url||'Not connected')+'</span></td><td><span class="pc-module '+(b.integration_active?'on':'off')+'">'+(b.integration_active?'ACTIVE':'NOT CONFIGURED')+'</span></td><td><span class="pc-pill '+(b.status==='ACTIVE'?'active':'suspended')+'">'+esc(b.status)+'</span></td><td><button class="pc-mini pc-open" data-id="'+esc(b.id)+'">INSPECT</button></td></tr>';
}

function disputesSection(){
  return '<header class="pc-head compact"><div><span class="pc-kicker">CONTROLLED EVIDENCE</span><h1>Dispute access.</h1><p>No routine order or customer browser exists. A documented case is required before evidence can be accessed.</p></div><div class="pc-actions"><button class="pc-btn" id="new-dispute-btn">+ NEW DISPUTE CASE</button><button class="pc-btn secondary" id="refresh-btn">REFRESH</button></div></header>'+
    '<section class="pc-panel"><div class="pc-panel-head"><div><span class="pc-kicker">CASES</span><h2>Controlled evidence cases</h2></div><span class="pc-count">'+state.disputes.length+' case'+(state.disputes.length===1?'':'s')+'</span></div><div class="pc-table-wrap"><table class="pc-table"><thead><tr><th>CASE</th><th>RESTAURANT</th><th>PURPOSE</th><th>STATUS</th><th>CREATED</th><th></th></tr></thead><tbody>'+
    (state.disputes.length?state.disputes.map(d=>'<tr><td><strong>'+esc(d.case_reference)+'</strong></td><td>'+esc(d.business_name)+'</td><td>'+esc(d.category)+'</td><td><span class="pc-pill '+(d.status==='CLOSED'?'suspended':'active')+'">'+esc(d.status)+'</span></td><td>'+dt(d.created_at)+'</td><td><button class="pc-mini pc-dispute-open" data-id="'+esc(d.id)+'">OPEN CASE</button></td></tr>').join(''):'<tr><td colspan="6" class="pc-empty">No cases. Routine tenant data remains isolated.</td></tr>')+
    '</tbody></table></div></section>';
}

function issuesSection(){
  return '<header class="pc-head compact"><div><span class="pc-kicker">PLATFORM INCIDENTS</span><h1>Issues & alerts.</h1><p>System and security incidents only. Tenant order/customer records are not used as a monitoring feed.</p></div><button class="pc-btn secondary" id="refresh-btn">REFRESH</button></header><section class="pc-panel"><div class="pc-list">'+issueRows(state.incidents)+'</div></section>';
}
function issueRows(rows){
  return rows.length?rows.map(i=>'<div class="pc-issue-row"><span class="pc-severity '+String(i.severity||'info').toLowerCase()+'">'+esc(i.severity||'INFO')+'</span><div><strong>'+esc(i.source||i.action||'SYSTEM')+'</strong><small class="pc-issue-message">'+esc(i.message||i.note||'Platform event')+'</small></div><small>'+dt(i.last_seen_at||i.created_at)+'</small></div>').join(''):'<div class="pc-empty-card">No open issues.</div>';
}
function activitySection(){
  return '<header class="pc-head compact"><div><span class="pc-kicker">PLATFORM AUDIT</span><h1>Activity log.</h1><p>Administrative platform actions and access-control events.</p></div><button class="pc-btn secondary" id="refresh-btn">REFRESH</button></header><section class="pc-panel"><div class="pc-activity-list">'+(state.audit.length?state.audit.map(a=>'<article><span class="pc-activity-dot"></span><div><strong>'+esc(a.action)+'</strong><p>'+esc(a.note||'Platform action')+'</p></div><time>'+dt(a.created_at)+'</time></article>').join(''):'<div class="pc-empty-card">No activity.</div>')+'</div></section>';
}
function updatesSection(){
  const s=state.system||{};
  return '<header class="pc-head compact"><div><span class="pc-kicker">SYSTEM</span><h1>System updates.</h1><p>Platform runtime and integration readiness without tenant operational metrics.</p></div></header><section class="pc-panel"><div class="pc-update-grid"><div><span>VERSION</span><strong>'+esc(s.version||'—')+'</strong></div><div><span>ENVIRONMENT</span><strong>'+esc(s.apiEnvironment||'—')+'</strong></div><div><span>DATABASE</span><strong>CONNECTED</strong></div><div><span>OPEN INCIDENTS</span><strong>'+esc(s.counts?.open_incidents||0)+'</strong></div></div></section>';
}
function healthSection(){return overviewSection().replace(/^[\\s\\S]*?(?=<section class="pc-panel pc-health">)/,'').replace(/<div class="pc-two-col">[\\s\\S]*$/,'');}

function createPanel(){
  const options=state.packages.map(p=>'<option value="'+esc(p.key)+'">'+esc(p.name||p.key)+'</option>').join('');
  return '<div class="pc-modal-backdrop"><section class="pc-modal pc-create-modal"><button class="pc-modal-close" id="create-close">×</button><div class="pc-modal-head"><div><span class="pc-kicker">TENANT PROVISIONING</span><h2>Add restaurant.</h2><p>Only tenant configuration is collected here.</p></div></div><div class="pc-form"><label>RESTAURANT NAME<input id="new-name" required></label><label>SLUG<input id="new-slug" required></label><label>PICKUP ADDRESS<input id="new-address" required></label><label>WEBSITE URL<input id="new-website"></label><label>PACKAGE<select id="new-plan">'+options+'</select></label><label>CUSTOM DOMAIN<input id="new-domain"></label><div class="pc-form-actions"><button class="pc-btn secondary" id="create-close-2">CANCEL</button><button class="pc-btn" id="create-save">CREATE RESTAURANT</button></div></div></section></div>';
}
function bindCreate(){
  document.getElementById('create-close')?.addEventListener('click',()=>{state.showCreate=false;render();});
  document.getElementById('create-close-2')?.addEventListener('click',()=>{state.showCreate=false;render();});
  document.getElementById('create-save')?.addEventListener('click',createTenant);
}
async function createTenant(){
  const button=document.getElementById('create-save');button.disabled=true;button.textContent='CREATING…';
  try{
    await api('/api/platform/businesses',{method:'POST',body:JSON.stringify({name:document.getElementById('new-name').value.trim(),slug:document.getElementById('new-slug').value.trim(),address:document.getElementById('new-address').value.trim(),websiteUrl:document.getElementById('new-website').value.trim(),planKey:document.getElementById('new-plan').value,domain:document.getElementById('new-domain').value.trim()})});
    state.showCreate=false;await load();
  }catch(e){button.disabled=false;button.textContent='CREATE RESTAURANT';alert(e.message);}
}
function bindRows(){
  document.querySelectorAll('.pc-open').forEach(btn=>btn.onclick=async()=>{
    state.selected=state.businesses.find(b=>String(b.id)===String(btn.dataset.id))||null;state.selectedInspect=null;render();
    try{state.selectedInspect=await api('/api/platform/businesses/'+encodeURIComponent(btn.dataset.id)+'/inspect');render();}catch(e){alert(e.message);}
  });
  document.querySelectorAll('.pc-dispute-open').forEach(btn=>btn.onclick=async()=>{
    try{state.selectedCase=await api('/api/control/disputes/'+encodeURIComponent(btn.dataset.id));render();}catch(e){alert(e.message);}
  });
}
function bindDisputes(){
  document.querySelectorAll('[data-section="disputes"]').forEach(b=>b.onclick=()=>{state.section='disputes';state.menu=false;render();});
  document.getElementById('new-dispute-btn')?.addEventListener('click',()=>{state.selectedCase={newCase:true};render();});
  document.getElementById('dispute-cancel')?.addEventListener('click',()=>{state.selectedCase=null;render();});
  document.getElementById('dispute-create')?.addEventListener('click',createDispute);
  document.querySelectorAll('[data-evidence-scope]').forEach(btn=>btn.addEventListener('click',()=>grantEvidence(btn.dataset.evidenceScope)));
  document.getElementById('dispute-close')?.addEventListener('click',closeDispute);
}
async function createDispute(){
  const button=document.getElementById('dispute-create');button.disabled=true;button.textContent='CREATING…';
  try{
    const data=await api('/api/control/disputes',{method:'POST',body:JSON.stringify({businessId:document.getElementById('dispute-business').value,orderNumber:document.getElementById('dispute-order').value.trim(),category:document.getElementById('dispute-category').value,reason:document.getElementById('dispute-reason').value.trim()})});
    state.selectedCase=await api('/api/control/disputes/'+encodeURIComponent(data.case.id));
    state.disputes=await api('/api/control/disputes?status=ALL');render();
  }catch(e){button.disabled=false;button.textContent='CREATE CASE';alert(e.message);}
}
async function grantEvidence(scope){
  if(!state.selectedCase?.case?.id)return;
  try{
    await api('/api/control/disputes/'+encodeURIComponent(state.selectedCase.case.id)+'/access',{method:'POST',body:JSON.stringify({scope:scope,minutes:15})});
    const evidence=await api('/api/control/disputes/'+encodeURIComponent(state.selectedCase.case.id)+'/evidence?scope='+encodeURIComponent(scope));
    const detail=await api('/api/control/disputes/'+encodeURIComponent(state.selectedCase.case.id));
    state.selectedCase={...detail,evidence:evidence};render();
  }catch(e){alert(e.message);}
}
async function closeDispute(){
  if(!state.selectedCase?.case?.id)return;
  try{await api('/api/control/disputes/'+encodeURIComponent(state.selectedCase.case.id)+'/close',{method:'POST'});state.selectedCase=null;await load();}catch(e){alert(e.message);}
}
function disputePanel(){
  const d=state.selectedCase;
  if(d.newCase){
    const options=state.businesses.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>').join('');
    return '<div class="pc-modal-backdrop"><section class="pc-modal pc-create-modal"><button class="pc-modal-close" id="dispute-cancel">×</button><div class="pc-modal-head"><div><span class="pc-kicker">BREAK-GLASS CASE</span><h2>Create dispute case.</h2><p>Use a specific restaurant and order reference. This does not display order contents or customer data.</p></div></div><div class="pc-form"><label>RESTAURANT<select id="dispute-business">'+options+'</select></label><label>ORDER REFERENCE<input id="dispute-order" placeholder="e.g. ORD-1042" autocomplete="off"></label><label>CATEGORY<select id="dispute-category"><option value="DELIVERY_DISPUTE">DELIVERY DISPUTE</option><option value="REFUND_DISPUTE">REFUND DISPUTE</option><option value="SECURITY_INCIDENT">SECURITY INCIDENT</option><option value="LEGAL_REQUEST">LEGAL REQUEST</option><option value="OTHER">OTHER</option></select></label><label>REASON<textarea id="dispute-reason" rows="5" placeholder="Why is this evidence required?"></textarea></label><div class="pc-form-note">Access is not automatic. Evidence is purpose-bound, maximum 30 minutes, and every grant/view is audited.</div><div class="pc-form-actions"><button class="pc-btn secondary" id="dispute-cancel-2">CANCEL</button><button class="pc-btn" id="dispute-create">CREATE CASE</button></div></div></section></div>';
  }
  const c=d.case||{},e=d.evidence;
  return '<div class="pc-modal-backdrop"><section class="pc-modal pc-tenant-modal"><button class="pc-modal-close" id="dispute-cancel">×</button><div class="pc-modal-head"><div><span class="pc-kicker">CASE '+esc(c.caseReference)+'</span><h2>Controlled investigation.</h2><p>'+esc(c.businessName)+' · '+esc(c.category)+'</p></div><button class="pc-btn secondary" id="dispute-close">CLOSE CASE</button></div><div class="pc-section"><div class="pc-tenant-overview"><div><span>STATUS</span><strong>'+esc(c.status)+'</strong></div><div><span>PURPOSE</span><strong>'+esc(c.category)+'</strong></div><div><span>ORDER DATA</span><strong class="pc-health-ok">ISOLATED</strong></div><div><span>CUSTOMER DATA</span><strong class="pc-health-ok">ISOLATED</strong></div><div><span>DIRECT DB</span><strong class="pc-health-ok">BLOCKED</strong></div><div><span>ACCESS</span><strong class="pc-health-ok">AUDITED</strong></div></div></div><div class="pc-section"><span class="pc-kicker">REASON</span><p class="pc-panel-sub">'+esc(c.reason)+'</p></div><div class="pc-section"><span class="pc-kicker">REQUEST EVIDENCE</span><div class="pc-actions pc-evidence-actions"><button class="pc-btn" data-evidence-scope="ORDER_TIMELINE">ORDER TIMELINE</button><button class="pc-btn" data-evidence-scope="DELIVERY_EVIDENCE">DELIVERY EVIDENCE</button><button class="pc-btn secondary" data-evidence-scope="REFUND_EVIDENCE">REFUND STATUS</button><button class="pc-btn secondary" data-evidence-scope="LOCATION_DETAIL">EXACT LOCATION</button><button class="pc-btn secondary" data-evidence-scope="CUSTOMER_CONTACT">CUSTOMER CONTACT</button></div><div class="pc-form-note">Exact location and customer contact require PLATFORM_OWNER authorization. All restricted views expire automatically.</div></div>'+(e?'<div class="pc-section"><span class="pc-kicker">RESTRICTED EVIDENCE — '+esc(e.scope)+'</span><pre class="pc-evidence">'+esc(JSON.stringify(e,null,2))+'</pre></div>':'')+'</section></div>';
}
function bindTenant(){
  document.getElementById('tenant-close')?.addEventListener('click',()=>{state.selected=null;state.selectedInspect=null;render();});
  document.getElementById('tenant-backdrop')?.addEventListener('click',e=>{if(e.target.id==='tenant-backdrop'){state.selected=null;state.selectedInspect=null;render();}});
}
function tenantPanel(b){
  const x=state.selectedInspect;
  return '<div class="pc-modal-backdrop" id="tenant-backdrop"><section class="pc-modal pc-tenant-modal"><button class="pc-modal-close" id="tenant-close">×</button><div class="pc-modal-head"><div><span class="pc-kicker">TENANT CONFIGURATION</span><h2>'+esc(b.name)+'</h2><p>Configuration and service health only. No order/customer records are loaded.</p></div></div>'+(!x?'<div class="pc-loading">Loading safe tenant configuration…</div>':'<div class="pc-section"><div class="pc-tenant-overview"><div><span>STATUS</span><strong>'+esc(x.restaurant.status)+'</strong></div><div><span>PACKAGE</span><strong>'+esc(x.restaurant.plan_name||x.restaurant.plan_key)+'</strong></div><div><span>BRANCH</span><strong>'+(String(x.health?.issues||[]).includes('MISSING_BRANCH')?'MISSING':'READY')+'</strong></div><div><span>MANAGER</span><strong>'+(String(x.health?.issues||[]).includes('MISSING_MANAGER')?'MISSING':'READY')+'</strong></div><div><span>INTEGRATION</span><strong>'+(String(x.health?.issues||[]).includes('NO_ACTIVE_INTEGRATION')?'NOT READY':'READY')+'</strong></div><div><span>DATA ACCESS</span><strong class="pc-health-ok">ISOLATED</strong></div></div></div>')+'</section></div>';
}
function bindIncidentActions(){
  document.getElementById('logout-btn')?.addEventListener('click',logout);
}
async function logout(){try{await api('/api/platform/logout',{method:'POST'});}catch{}if(window.PlatformSession)PlatformSession.clearLegacyToken('platform');else localStorage.removeItem('platform_admin_token');login('You have been signed out.');}

load();
})();