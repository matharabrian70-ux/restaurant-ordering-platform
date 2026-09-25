(function(){
  const id=typeof BUSINESS_ID!=='undefined'?BUSINESS_ID:(new URLSearchParams(location.search).get('businessId')||'11111111-1111-4111-8111-111111111111');
  const API=typeof API_BASE_URL!=='undefined'?API_BASE_URL:'https://restaurant-ordering-api-ow3p.onrender.com';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let branding=null;
  function apply(){
    if(!branding)return;
    const r=document.documentElement.style;
    r.setProperty('--brand-primary',branding.primary_color||'#176b32');
    r.setProperty('--brand-secondary',branding.secondary_color||'#172019');
    r.setProperty('--brand-accent',branding.accent_color||branding.primary_color||'#d56a2d');
    r.setProperty('--brand-paper',branding.background_color||'#f5f5f0');
    r.setProperty('--brand-text',branding.text_color||'#172019');
    r.setProperty('--brand-font',branding.font_family||'Inter,system-ui,-apple-system,"Segoe UI",sans-serif');
    document.body?.classList.add('tenant-branded');
    const name=branding.display_name||'Restaurant';
    const logo=branding.logo_url||'';
    const path=location.pathname.toLowerCase();const page=path.includes('manager')?'Manager Dashboard':path.includes('rider')?'Rider Dashboard':path.includes('checkout')?'Checkout':path.includes('order')?'Order Tracking':path.includes('menu')?'Menu':path.includes('receipt')?'Receipt':'Restaurant';document.title=name+' — '+page;
    document.querySelectorAll('.brand').forEach(el=>{el.innerHTML=(logo?'<img class="tenant-brand-logo" src="'+esc(logo)+'" alt="">':'')+'<span class="tenant-brand-name">'+esc(name)+'</span>';});
    document.querySelectorAll('.manager-header h1').forEach(el=>{el.textContent=name+'.';});
    document.querySelectorAll('.manager-login .manager-kicker').forEach(el=>{el.innerHTML='<i></i> '+esc(name.toUpperCase());});
    document.querySelectorAll('.rider-auth-brand').forEach(el=>{el.innerHTML=(logo?'<img class="tenant-auth-logo" src="'+esc(logo)+'" alt="">':'<i></i>')+' '+esc(name.toUpperCase())+' · RIDER OPERATIONS';});
    document.querySelectorAll('footer').forEach(el=>{if(!el.dataset.tenantFooter)el.dataset.tenantFooter=el.textContent;el.textContent=name+' • '+el.dataset.tenantFooter.replace(/^Savanna Bites\s*•\s*/i,'').replace(/^Restaurant management system\s*•\s*/i,'Restaurant management system • ').replace(/^Rider operations\s*•\s*/i,'Rider operations • ');});
    document.querySelectorAll('.tenant-identity-slot').forEach(el=>{el.innerHTML='<div class="tenant-identity">'+(logo?'<img src="'+esc(logo)+'" alt="">':'')+'<div><strong>'+esc(name)+'</strong><small>Restaurant operations</small></div></div>';});
  }
  async function load(){try{const res=await fetch(API+'/api/businesses/'+encodeURIComponent(id)+'/branding');if(!res.ok)return;const data=await res.json();branding=data.branding||null;window.RESTAURANT_BRANDING=branding;apply();}catch{}}
  const style=document.createElement('style');style.textContent='.tenant-branded{--accent:var(--brand-primary)!important;--ink:var(--brand-secondary)!important;--paper:var(--brand-paper)!important;--text:var(--brand-text)!important;--font:var(--brand-font)!important}body.tenant-branded{font-family:var(--brand-font)}.tenant-branded .btn,.tenant-branded button.btn{background:var(--brand-primary)!important;border-color:var(--brand-primary)!important}.tenant-branded .brand{display:flex;align-items:center;gap:9px}.tenant-brand-logo{width:34px;height:34px;object-fit:contain;border-radius:7px}.tenant-brand-name{font-weight:950;letter-spacing:-.04em;text-transform:uppercase}.tenant-branded .manager-tab.active{background:var(--brand-primary);border-color:var(--brand-primary)}.tenant-branded .signature-add-btn{background:var(--brand-primary)!important}.tenant-branded .signature-add-btn:hover{background:var(--brand-secondary)!important}.tenant-branded .signature-available{color:var(--brand-primary)}.tenant-branded .signature-dot{background:var(--brand-primary)}.tenant-branded .manager-kicker,.tenant-branded .eyebrow{color:var(--brand-primary)}.tenant-branded .rider-auth-card .btn{background:var(--brand-primary)!important;border-color:var(--brand-primary)!important}.tenant-auth-logo{width:24px;height:24px;object-fit:contain;border-radius:5px;vertical-align:middle}.tenant-identity{display:flex;align-items:center;gap:12px;margin:0 0 18px;padding:12px 14px;background:#fff;border:1px solid var(--line)}.tenant-identity img{width:44px;height:44px;object-fit:contain;border-radius:8px}.tenant-identity strong,.tenant-identity small{display:block}.tenant-identity small{font-size:10px;color:var(--muted);margin-top:3px}';document.head.appendChild(style);
  const observer=new MutationObserver(()=>apply());observer.observe(document.documentElement,{subtree:true,childList:true});
  window.applyRestaurantBranding=apply;load();
})();