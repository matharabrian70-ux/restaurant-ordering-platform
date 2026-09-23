const API_BASE_URL = 'https://restaurant-ordering-api-ow3p.onrender.com';
const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';

async function apiRequest(path, options = {}) {
  const response = await fetch(API_BASE_URL + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `API request failed (${response.status})`);
  return data;
}

async function getDeliveryQuote({ pickupAddress, deliveryAddress }) { return apiRequest('/api/delivery/quote', { method:'POST', body: JSON.stringify({ businessId: BUSINESS_ID, pickupAddress, deliveryAddress }) }); }
async function createRemoteOrder({ customer, phone, email, note, payment, items, total, quoteId, deliveryAddress }) {
  return apiRequest('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      businessId: BUSINESS_ID,
      customer: { name: customer, phone, email },
      items: items.map(item => ({ productId: null, name: item.name, quantity: item.qty, unitPrice: item.unit, options: item.options || {} })),
      paymentMethod: payment,
      subtotal: total,
      total,
      quoteId,
      deliveryNote: note,
      deliveryAddress
    })
  });
}

async function initializePaystackPayment(orderId) {
  return apiRequest('/api/payments/paystack/initialize', { method: 'POST', body: JSON.stringify({ orderId }) });
}
async function verifyPaystackPayment(reference) {
  return apiRequest('/api/payments/paystack/verify', { method: 'POST', body: JSON.stringify({ reference }) });
}
async function getRemoteOrder(orderId) {
  return apiRequest('/api/orders/' + encodeURIComponent(orderId));
}
async function cancelRemoteOrder(orderId) {
  return apiRequest('/api/orders/' + encodeURIComponent(orderId) + '/cancel', { method: 'POST', body: JSON.stringify({}) });
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
