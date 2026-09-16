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

async function createRemoteOrder({ customer, phone, email, note, payment, items, total }) {
  return apiRequest('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      businessId: BUSINESS_ID,
      customer: { name: customer, phone, email },
      items: items.map(item => ({
        // The frontend currently uses catalog slugs (e.g. "burger"),
        // while order_items.product_id is a UUID. Keep this null until
        // the database product catalog is seeded and mapped to the slugs.
        productId: null,
        name: item.name,
        quantity: item.qty,
        unitPrice: item.unit,
        options: item.options || {}
      })),
      paymentMethod: payment,
      subtotal: total,
      total,
      deliveryNote: note
    })
  });
}

async function initializePaystackPayment(orderId) {
  return apiRequest('/api/payments/paystack/initialize', {
    method: 'POST',
    body: JSON.stringify({ orderId })
  });
}

async function verifyPaystackPayment(reference) {
  return apiRequest('/api/payments/paystack/verify', {
    method: 'POST',
    body: JSON.stringify({ reference })
  });
}

async function getRemoteOrder(orderId) {
  return apiRequest('/api/orders/' + encodeURIComponent(orderId));
}
