const API_BASE_URL = window.PLATFORM_API_ORIGIN || 'https://restaurant-ordering-api-ow3p.onrender.com';
const DEFAULT_BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const BUSINESS_ID = new URLSearchParams(location.search).get('businessId') || (typeof getStoredPromo==='function' ? getStoredPromo()?.businessId : null) || DEFAULT_BUSINESS_ID;
const MANAGER_TOKEN_KEY = 'savanna_manager_session';
const CUSTOMER_ORDER_TOKEN_KEY = 'savanna_customer_order_token';
function getManagerToken(){ return window.PlatformSession ? PlatformSession.getLegacyToken('manager') : sessionStorage.getItem(MANAGER_TOKEN_KEY) || ''; }
function setManagerToken(token){ if(window.PlatformSession) PlatformSession.setLegacyToken('manager',token); else if(token) sessionStorage.setItem(MANAGER_TOKEN_KEY,token); else sessionStorage.removeItem(MANAGER_TOKEN_KEY); }
function managerLogoutLocal(){ setManagerToken(''); }
async function managerLogin(email,password){ const data=await apiRequest('/api/manager/login',{method:'POST',body:JSON.stringify({businessId:BUSINESS_ID,email,password})}); setManagerToken(data.token); return data; }

async function apiRequest(path, options = {}) {
  const response = await fetch(API_BASE_URL + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(window.PlatformSession ? PlatformSession.authorizationHeader('manager') : (getManagerToken()?{Authorization:'Bearer '+getManagerToken()}:{})), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `API request failed (${response.status})`);
  return data;
}

async function getDeliveryQuote({ pickupAddress, deliveryAddress, latitude, longitude, orderAmount=0 }) { return apiRequest('/api/delivery/quote-v2', { method:'POST', body: JSON.stringify({ businessId: BUSINESS_ID, pickupAddress, deliveryAddress, customerLat: latitude, customerLng: longitude, orderAmount }) }); }
function orderRequestFingerprint({ customer, phone, email, note, payment, items, quoteId, deliveryAddress, couponCode }) {
  return JSON.stringify({
    businessId: BUSINESS_ID,
    customer: { name: String(customer || '').trim(), phone: String(phone || '').trim(), email: String(email || '').trim() },
    items: items.map(item => ({ productId: item.id, quantity: item.qty, options: item.options || {} })),
    paymentMethod: payment,
    quoteId: quoteId || null,
    deliveryNote: String(note || '').trim(),
    deliveryAddress: String(deliveryAddress || '').trim(),
    couponCode: String(couponCode || '').trim().toUpperCase() || null
  });
}
async function createRemoteOrder({ customer, phone, email, note, payment, items, subtotal, total, quoteId, deliveryAddress, couponCode, legal }) {
  const fingerprint=orderRequestFingerprint({customer,phone,email,note,payment,items,quoteId,deliveryAddress,couponCode});
  let intent=null;
  try{ intent=JSON.parse(sessionStorage.getItem('savanna_order_intent')||'null'); }catch{}
  if(!intent||intent.fingerprint!==fingerprint){
    intent={fingerprint,key:crypto.randomUUID()};
    sessionStorage.setItem('savanna_order_intent',JSON.stringify(intent));
  }
  return apiRequest('/api/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': intent.key },
    body: JSON.stringify({
      businessId: BUSINESS_ID,
      customer: { name: customer, phone, email },
      items: items.map(item => ({ productId: item.id, quantity: item.qty, options: item.options || {} })),
      paymentMethod: payment,
      subtotal,
      total,
      quoteId,
      deliveryNote: note,
      deliveryAddress,
      couponCode: couponCode ? String(couponCode).trim().toUpperCase() : null,
      legal: legal || {}
    })
  });
}

async function initializePaystackPayment(orderId) {
  const keyName='savanna_paystack_intent_'+orderId;
  let key=sessionStorage.getItem(keyName);
  if(!key){ key=crypto.randomUUID(); sessionStorage.setItem(keyName,key); }
  return apiRequest('/api/payments/paystack/initialize', { method:'POST', body:JSON.stringify({orderId,orderToken:getCustomerOrderToken(),idempotencyKey:key}), headers:{Authorization:'Bearer '+getCustomerOrderToken(),'Idempotency-Key':key} });
}
async function verifyPaystackPayment(reference,orderId) {
  return apiRequest('/api/payments/paystack/verify', { method: 'POST', body: JSON.stringify({ reference, orderId, orderToken:getCustomerOrderToken() }), headers:{Authorization:'Bearer '+getCustomerOrderToken()} });
}
async function getRemoteOrder(orderId) {
  return apiRequest('/api/orders/' + encodeURIComponent(orderId), {headers:{Authorization:'Bearer '+getCustomerOrderToken()}});
}
async function cancelRemoteOrder(orderId) {
  return apiRequest('/api/orders/' + encodeURIComponent(orderId) + '/cancel', { method: 'POST', body: JSON.stringify({}), headers:{Authorization:'Bearer '+getCustomerOrderToken()} });
}
async function getRemoteRiders() {
  return apiRequest('/api/riders?businessId=' + encodeURIComponent(BUSINESS_ID));
}
async function createRemoteRider({ name, phone, email, vehicleType, numberPlate, password, payoutPhone }) {
  return apiRequest('/api/riders', { method: 'POST', body: JSON.stringify({ businessId: BUSINESS_ID, name, phone, email, vehicleType, numberPlate, password, payoutPhone }) });
}
async function getRiderActiveDelivery(riderId) {
  return apiRequest('/api/riders/' + encodeURIComponent(riderId) + '/active-delivery');
}
async function completeRiderDelivery(riderId) {
  return apiRequest('/api/riders/' + encodeURIComponent(riderId) + '/complete-delivery', { method: 'POST', body: JSON.stringify({}) });
}

async function getAdminRiders() { return apiRequest('/api/admin/riders?businessId='+encodeURIComponent(BUSINESS_ID)); }
async function getAdminRiderTrips(riderId) { return apiRequest('/api/admin/riders/'+encodeURIComponent(riderId)+'/trips'); }

function getCustomerOrderToken(){ return sessionStorage.getItem(CUSTOMER_ORDER_TOKEN_KEY) || localStorage.getItem(CUSTOMER_ORDER_TOKEN_KEY) || ''; }
function setCustomerOrderToken(token){ if(token) localStorage.setItem(CUSTOMER_ORDER_TOKEN_KEY,token); else localStorage.removeItem(CUSTOMER_ORDER_TOKEN_KEY); }
