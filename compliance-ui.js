(() => {
  const API='https://restaurant-ordering-api-ow3p.onrender.com';
  const params=new URLSearchParams(location.search);
  const businessId=params.get('businessId')||'11111111-1111-4111-8111-111111111111';
  const links=[
    ['Privacy','privacy.html'],['Terms','terms.html'],['Cookies','cookie-policy.html'],
    ['Data rights','data-rights.html'],['Refunds','refund-policy.html'],['Delivery terms','delivery-terms.html']
  ];
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
  document.addEventListener('DOMContentLoaded',()=>{addFooter();if(!localStorage.getItem('privacy_notice_seen_v1'))addNotice();});
})();
