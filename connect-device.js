const API='https://restaurant-ordering-api-ow3p.onrender.com';const STATION_KEY='savanna_station_session';const view=document.getElementById('connect-view');let pairingInProgress=false;
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function tokenFromValue(v){try{const u=new URL(v);return u.searchParams.get('token')||u.searchParams.get('stationToken')||'';}catch{return String(v||'').trim();}}
async function pair(token){
  token=String(token||'').trim();
  if(!token||pairingInProgress)return;
  pairingInProgress=true;
  view.innerHTML='<section class="connect-card"><div class="station-spinner"></div><h1>Connecting device…</h1><p>Verifying the one-time pairing code.</p></section>';
  try{
    const r=await fetch(API+'/api/station/pair',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'Pairing failed');
    localStorage.setItem(STATION_KEY,JSON.stringify(d));
    location.href='station.html';
  }catch(e){
    pairingInProgress=false;
    view.innerHTML='<section class="connect-card"><span class="eyebrow">PAIRING FAILED</span><h1>Could not connect</h1><p>'+esc(e.message)+'</p><button class="station-btn" onclick="render()">TRY AGAIN</button></section>';
  }
}
function render(){
  pairingInProgress=false;
  const q=new URLSearchParams(location.search),t=q.get('token');
  if(t)return pair(t);
  view.innerHTML='<section class="connect-card"><span class="eyebrow">ORDER CONTROL DEVICE</span><h1>Connect this device</h1><p>Open the camera scanner to scan the QR shown on the manager dashboard.</p><div id="reader"></div><label class="manual-code">Or paste connection link/token<input id="manual" placeholder="https://…/connect-device.html?token=…"><button class="station-btn" onclick="pair(tokenFromValue(document.getElementById(\'manual\').value))">CONNECT</button></label><p class="connect-note">Camera scanning requires the site to be opened over HTTPS and camera permission.</p></section>';
  startScanner();
}
async function startScanner(){
  if(!window.Html5Qrcode)return;
  try{
    const scanner=new Html5Qrcode('reader');
    let scanned=false;
    await scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:250,height:250}},async text=>{
      if(scanned||pairingInProgress)return;
      scanned=true;
      const t=tokenFromValue(text);
      try{await scanner.stop();}catch{}
      if(t)pair(t);else{scanned=false;pairingInProgress=false;}
    });
  }catch(e){
    const reader=document.getElementById('reader');
    if(reader)reader.innerHTML='<div class="scanner-note">Camera scanner unavailable. Use the connection link/token below.</div>';
  }
}
render();
