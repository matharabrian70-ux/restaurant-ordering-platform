(function(){
'use strict';
const API=window.PLATFORM_API_ORIGIN || 'https://restaurant-ordering-api-ow3p.onrender.com';
const params=new URLSearchParams(location.search);
const path=location.pathname.toLowerCase();
const businessId=path.includes('platform-control')?null:(params.get('businessId')||'11111111-1111-4111-8111-111111111111');
const dashboard=path.includes('rider')?'RIDER':path.includes('manager')?'MANAGER':path.includes('station')?'ORDER_STATION':path.includes('checkout')?'CHECKOUT':path.includes('cart')?'CART':path.includes('order')?'ORDER_TRACKING':path.includes('records')?'CUSTOMER_RECORDS':path.includes('menu')||path.includes('index')?'CUSTOMER_MENU':path.includes('platform-control')?'CONTROL_CENTRE':'WEB';
const sent=new Map();
let telemetryTokenPromise=null;
function authContext(){
  if(dashboard==='CONTROL_CENTRE'){
    const token=window.PlatformSession?PlatformSession.getLegacyToken('platform'):localStorage.getItem('platform_admin_token')||'';
    return token?{token,scope:'PLATFORM'}:null;
  }
  if(dashboard==='MANAGER'){
    const token=window.PlatformSession?PlatformSession.getLegacyToken('manager'):sessionStorage.getItem('savanna_manager_session')||'';
    return token?{token,scope:'MANAGER'}:null;
  }
  if(dashboard==='RIDER'){
    const token=window.PlatformSession?PlatformSession.getLegacyToken('rider'):localStorage.getItem('rider_session_token')||'';
    return token?{token,scope:'RIDER'}:null;
  }
  if(dashboard==='ORDER_STATION'){
    try{
      const session=JSON.parse(localStorage.getItem('savanna_station_session')||'null');
      return session?.token?{token:session.token,scope:'STATION'}:null;
    }catch{return null}
  }
  return null;
}
async function getTelemetryToken(){
  if(telemetryTokenPromise)return telemetryTokenPromise;
  const auth=authContext();
  if(!auth)return null;
  telemetryTokenPromise=fetch(API+'/api/telemetry-token',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+auth.token},body:JSON.stringify({scope:auth.scope}),keepalive:true})
    .then(r=>r.ok?r.json():null).then(d=>d?.token||null).catch(()=>null);
  return telemetryTokenPromise;
}
async function report(message,stack,severity){
  const key=String(message||'').slice(0,500)+'|'+dashboard;
  const now=Date.now();
  if(sent.has(key)&&now-sent.get(key)<30000)return;
  sent.set(key,now);
  const token=await getTelemetryToken();
  if(!token)return;
  const body={businessId,dashboard,source:'BROWSER',severity,message:String(message||'Unknown browser error').slice(0,1000),stack:String(stack||'').slice(0,5000),url:location.href};
  try{fetch(API+'/api/platform/telemetry',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(body),keepalive:true}).catch(()=>{});}catch{}
}
window.addEventListener('error',e=>{void report(e.message,e.error?.stack||`${e.filename||''}:${e.lineno||''}:${e.colno||''}`,'ERROR');});
window.addEventListener('unhandledrejection',e=>{const r=e.reason;void report(r?.message||String(r||'Unhandled promise rejection'),r?.stack,'ERROR');});
window.platformReportError=report;
})();