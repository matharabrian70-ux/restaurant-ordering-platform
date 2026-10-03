(() => {
  const API=window.PLATFORM_API_ORIGIN || 'https://restaurant-ordering-api-ow3p.onrender.com';
  const params=new URLSearchParams(location.search);
  const businessId=params.get('businessId')||'11111111-1111-4111-8111-111111111111';
  const page=document.body?.dataset.page || '';
  const isRider=page==='rider' || location.pathname.endsWith('/rider.html');
  const isRestaurant=page==='manager' || location.pathname.endsWith('/manager.html') || location.pathname.endsWith('/station.html') || location.pathname.endsWith('/records.html');
  // Keep legal navigation simple and role-specific:
  // customers see the policies governing their order; restaurant staff see
  // the same merchant-facing legal set; riders see only rider-relevant terms.
  const links=isRider
    ? [['Privacy','privacy.html'],['Rider terms','rider-terms.md']]
    : [['Terms','terms.html'],['Privacy','privacy.html'],['Refund policy','refund-policy.html']];
  function addFooter(){
    let footer=document.querySelector('footer');
    if(!footer){footer=document.createElement('footer');document.body.appendChild(footer);}
    const wrap=document.createElement('div');wrap.className='compliance-footer';
    const label=document.createElement('span');label.textContent='Legal & privacy';
    wrap.appendChild(label);
    links.forEach(([text,url])=>{const a=document.createElement('a');a.href=url+'?businessId='+encodeURIComponent(businessId);a.textContent=text;wrap.appendChild(a);});
    footer.appendChild(wrap);
  }
  function addNotice(){
    if(!document.body||document.querySelector('[data-privacy-notice]'))return;
    const box=document.createElement('aside');box.setAttribute('data-privacy-notice','true');box.className='privacy-notice';
    const text=document.createElement('span');text.textContent='We use personal data to process orders, delivery and support. Read the Privacy Notice to understand your rights and how data is handled.';
    const a=document.createElement('a');a.href='privacy.html?businessId='+encodeURIComponent(businessId);a.textContent='Privacy Notice';
    const button=document.createElement('button');button.type='button';button.textContent='Dismiss';
    button.addEventListener('click',()=>{localStorage.setItem('privacy_notice_seen_v1','1');box.remove();});
    box.append(text,a,button);document.body.appendChild(box);
  }
  document.addEventListener('DOMContentLoaded',()=>{
    addFooter();
    // The privacy notice is a customer-facing consent/information prompt.
    // Do not place it over manager, station, records, or rider dashboards.
    if(!isRider && !isRestaurant && !localStorage.getItem('privacy_notice_seen_v1'))addNotice();
  });
})();
