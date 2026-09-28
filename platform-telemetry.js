(function(){
'use strict';
const API='https://restaurant-ordering-api-ow3p.onrender.com';
const params=new URLSearchParams(location.search);
const path=location.pathname.toLowerCase();
const businessId=path.includes('platform-control')?null:(params.get('businessId')||'11111111-1111-4111-8111-111111111111');
const dashboard=path.includes('rider')?'RIDER':path.includes('manager')?'MANAGER':path.includes('station')?'ORDER_STATION':path.includes('checkout')?'CHECKOUT':path.includes('cart')?'CART':path.includes('order')?'ORDER_TRACKING':path.includes('records')?'CUSTOMER_RECORDS':path.includes('menu')||path.includes('index')?'CUSTOMER_MENU':path.includes('platform-control')?'CONTROL_CENTRE':'WEB';
const sent=new Map();
function report(message,stack,severity){
  const key=String(message||'').slice(0,500)+'|'+dashboard;
  const now=Date.now();
  if(sent.has(key)&&now-sent.get(key)<30000)return;
  sent.set(key,now);
  const body={businessId,dashboard,source:'BROWSER',severity,message:String(message||'Unknown browser error').slice(0,1000),stack:String(stack||'').slice(0,5000),url:location.href};
  try{fetch(API+'/api/platform/telemetry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true}).catch(()=>{});}catch{}
}
window.addEventListener('error',e=>{report(e.message,e.error?.stack||`${e.filename||''}:${e.lineno||''}:${e.colno||''}`,'ERROR');});
window.addEventListener('unhandledrejection',e=>{const r=e.reason;report(r?.message||String(r||'Unhandled promise rejection'),r?.stack,'ERROR');});
window.platformReportError=report;
})();