(function(){
  const BUSINESS_ID_VALUE=typeof BUSINESS_ID!=='undefined'?BUSINESS_ID:(new URLSearchParams(location.search).get('businessId')||'11111111-1111-4111-8111-111111111111');
  const API=typeof API_BASE_URL!=='undefined'?API_BASE_URL:'https://restaurant-ordering-api-ow3p.onrender.com';
  const DEFAULT={display_name:'Restaurant',logo_url:'',favicon_url:'',primary_color:'#176b32',secondary_color:'#172019',accent_color:'#d56a2d',background_color:'#f5f5f0',text_color:'#172019',font_family:'Inter,system-ui,-apple-system,"Segoe UI",sans-serif'};
  let brand={...DEFAULT};
  const cacheKey='tenant-branding:'+BUSINESS_ID_VALUE;
  function safe(v,f=''){return v==null||v===''?f:String(v);}
  function apply(next){
    brand={...DEFAULT,...(next||{})};
    const root=document.documentElement;
    root.style.setProperty('--tenant-primary',brand.primary_color);
    root.style.setProperty('--tenant-secondary',brand.secondary_color);
    root.style.setProperty('--tenant-accent',brand.accent_color||brand.primary_color);
    root.style.setProperty('--tenant-paper',brand.background_color);
    root.style.setProperty('--tenant-text',brand.text_color);
    root.style.setProperty('--tenant-font',brand.font_family);
    root.style.setProperty('--accent','var(--tenant-primary)');
    root.style.setProperty('--ink','var(--tenant-secondary)');
    root.style.setProperty('--paper','var(--tenant-paper)');
    root.style.setProperty('--text','var(--tenant-text)');
    root.style.setProperty('--font','var(--tenant-font)');
    document.body?.setAttribute('data-tenant-id',BUSINESS_ID_VALUE);
    document.body?.setAttribute('data-tenant-name',brand.display_name||'Restaurant');
    const name=brand.display_name||'Restaurant';
    document.querySelectorAll('.brand').forEach(el=>{el.replaceChildren();if(brand.logo_url){const img=document.createElement('img');img.src=brand.logo_url;img.alt='';el.appendChild(img);}const span=document.createElement('span');span.textContent=name;el.appendChild(span);});document.querySelectorAll('[data-tenant-name-target]').forEach(el=>el.textContent=name);
    document.querySelectorAll('[data-tenant-logo]').forEach(el=>{if(brand.logo_url){el.src=brand.logo_url;el.hidden=false;}else{el.hidden=true;}});
    document.querySelectorAll('[data-tenant-name]').forEach(el=>el.textContent=name);
    if(brand.favicon_url){let icon=document.querySelector('link[data-tenant-favicon]');if(!icon){icon=document.createElement('link');icon.rel='icon';icon.dataset.tenantFavicon='true';document.head.appendChild(icon);}icon.href=brand.favicon_url;}
    const path=location.pathname.toLowerCase();
    const page=path.includes('manager')?'Manager Dashboard':path.includes('rider')?'Rider Dashboard':path.includes('checkout')?'Checkout':path.includes('order')?'Order Tracking':path.includes('menu')?'Menu':path.includes('station')?'Order Station':'Restaurant';
    document.title=name+' — '+page;
    window.RESTAURANT_BRANDING=brand;
    window.dispatchEvent(new CustomEvent('tenant:ready',{detail:brand}));
  }
  async function load(){
    try{const cached=sessionStorage.getItem(cacheKey);if(cached)apply(JSON.parse(cached));}catch{}
    try{const res=await fetch(API+'/api/businesses/'+encodeURIComponent(BUSINESS_ID_VALUE)+'/branding',{cache:'no-store'});if(!res.ok)throw new Error('branding '+res.status);const data=await res.json();apply(data.branding||DEFAULT);try{sessionStorage.setItem(cacheKey,JSON.stringify(data.branding||DEFAULT));}catch{}}catch{if(!window.RESTAURANT_BRANDING)apply(DEFAULT);}
  }
  window.TenantTheme={id:BUSINESS_ID_VALUE,name:()=>brand.display_name||'Restaurant',logo:()=>brand.logo_url||'',get:()=>({...brand}),ready:null};window.TenantTheme.ready=load();
})();