const DASHBOARD_API = 'https://restaurant-ordering-api-ow3p.onrender.com';
const DASHBOARD_BUSINESS_ID = '11111111-1111-4111-8111-111111111111';

const dashboardState = { orders: [], riders: [], query: '', loading: false };

async function dashboardRequest(path, options = {}) {
  const response = await fetch(DASHBOARD_API + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function dashboardMoney(value) {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 }).format(Number(value || 0));
}

function dashboardEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

function dashboardStatusLabel(status) {
  return ({ NEW:'NEW', ACCEPTED:'PREPARING', OUT_FOR_DELIVERY:'OUT FOR DELIVERY', DELIVERED:'DELIVERED' }[status] || status);
}

function dashboardPaymentLabel(status) {
  return ({ PENDING:'Payment pending', PAID:'Paid', REFUNDED:'Refunded' }[status] || status);
}

async function loadDashboard() {
  const view = document.getElementById('dashboard-view');
  if (!view) return;
  dashboardState.loading = true;
  view.innerHTML = '<div class="panel"><p>Loading live orders…</p></div>';
  try {
    const [orders, riders] = await Promise.all([
      dashboardRequest(`/api/orders?businessId=${encodeURIComponent(DASHBOARD_BUSINESS_ID)}&q=${encodeURIComponent(dashboardState.query)}`),
      dashboardRequest(`/api/riders?businessId=${encodeURIComponent(DASHBOARD_BUSINESS_ID)}`)
    ]);
    dashboardState.orders = orders;
    dashboardState.riders = riders;
    await renderRemoteDashboard();
  } catch (error) {
    view.innerHTML = `<div class="panel"><h2>Dashboard unavailable</h2><p class="muted">${dashboardEscape(error.message)}</p><button class="btn" onclick="loadDashboard()">TRY AGAIN</button></div>`;
  } finally {
    dashboardState.loading = false;
  }
}

async function renderRemoteDashboard() {
  const view = document.getElementById('dashboard-view');
  if (!view) return;
  const orders = dashboardState.orders;
  const paid = orders.filter(o => o.payment_status === 'PAID').length;
  const pending = orders.filter(o => o.payment_status === 'PENDING').length;
  const out = orders.filter(o => o.status === 'OUT_FOR_DELIVERY').length;
  const delivered = orders.filter(o => o.status === 'DELIVERED').length;
  const availableRiders = dashboardState.riders.filter(r => r.available).length;

  const cards = await Promise.all(orders.map(async order => {
    const refunds = order.payment_status === 'PAID' || order.payment_status === 'REFUNDED'
      ? await dashboardRequest(`/api/orders/${encodeURIComponent(order.id)}/refunds`).catch(() => [])
      : [];
    return renderOrderCard(order, refunds);
  }));

  view.innerHTML = `
    <div class="dashboard-head">
      <div>
        <p class="eyebrow">SAVANNA BITES • LIVE RESTAURANT</p>
        <h1>Order control.</h1>
        <p class="muted">This dashboard reads from the live PostgreSQL-backed API.</p>
      </div>
      <a class="btn" href="rider.html">Rider portal</a>
    </div>
    <section class="dashboard-stats">
      <div class="panel"><p class="eyebrow">PAID</p><h2>${paid}</h2><p class="muted">Ready for restaurant action</p></div>
      <div class="panel"><p class="eyebrow">PAYMENT PENDING</p><h2>${pending}</h2><p class="muted">Not yet confirmed</p></div>
      <div class="panel"><p class="eyebrow">DELIVERING</p><h2>${out}</h2><p class="muted">Currently out for delivery</p></div>
      <div class="panel"><p class="eyebrow">DELIVERED</p><h2>${delivered}</h2><p class="muted">Completed orders</p></div>
    </section>
    <section class="panel">
      <div class="dashboard-toolbar">
        <div><p class="eyebrow">RIDER AVAILABILITY</p><h2>${availableRiders} available now</h2></div>
        <div class="search-row"><input id="dashboard-search" value="${dashboardEscape(dashboardState.query)}" placeholder="Search name, phone, email or order"/><button class="btn" onclick="dashboardSearch()">SEARCH</button></div>
      </div>
      <div class="rider-strip">${dashboardState.riders.length ? dashboardState.riders.map(r => `<div class="rider-chip"><strong>${dashboardEscape(r.name)}</strong><span>${r.available ? 'AVAILABLE' : 'DELIVERING'} · ${Number(r.trip_count || 0)} trips</span><small>${dashboardEscape(r.vehicle_type || 'Vehicle')} · ${dashboardEscape(r.number_plate || 'No plate')}</small></div>`).join('') : '<p class="muted">No riders have been added yet.</p>'}</div>
    </section>
    <div class="orders">${cards.join('') || '<div class="empty"><h2>No orders found.</h2><p>Place a test order from the customer side.</p></div>'}</div>
  `;
}

function renderOrderCard(order, refunds) {
  const status = order.status;
  const payment = order.payment_status;
  const matchingRiders = dashboardState.riders.filter(r => r.available);
  const refundTotal = refunds.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const remaining = Math.max(0, Number(order.total || 0) - refundTotal);
  const action = status === 'NEW' && payment === 'PAID'
    ? `<button class="btn" onclick="acceptRemoteOrder('${order.id}')">ACCEPT ORDER</button>`
    : status === 'ACCEPTED'
      ? `<div class="status-actions"><select id="rider-${order.id}"><option value="">Choose available rider</option>${matchingRiders.map(r => `<option value="${r.id}">${dashboardEscape(r.name)} · ${dashboardEscape(r.vehicle_type || 'Vehicle')}</option>`).join('')}</select><button class="btn" onclick="sendRemoteOrder('${order.id}')">OUT FOR DELIVERY</button></div>`
      : status === 'OUT_FOR_DELIVERY'
        ? `<p class="muted">Waiting for delivery confirmation.</p>`
        : status === 'DELIVERED'
          ? `<p class="delivered">DELIVERED · receipt workflow next</p>`
          : `<p class="muted">${dashboardEscape(dashboardPaymentLabel(payment))}</p>`;

  const refundBlock = payment === 'PAID' || payment === 'REFUNDED' ? `
    <div class="refund-box">
      <div class="refund-head"><div><p class="eyebrow">REFUNDS</p><strong>${dashboardMoney(refundTotal)} refunded</strong><small>${dashboardMoney(remaining)} remaining</small></div>${remaining > 0 && payment === 'PAID' ? `<button class="text-link" onclick="openRefundForm('${order.id}',${remaining})">Refund</button>` : ''}</div>
      ${refunds.length ? refunds.map(r => `<div class="refund-row"><span>${dashboardMoney(r.amount)} · ${dashboardEscape(r.status)}</span><small>${new Date(r.created_at).toLocaleString()}</small></div>`).join('') : '<p class="muted">No refunds for this payment.</p>'}
    </div>` : '';

  return `<article class="order-card remote-order-card">
    <div><p class="eyebrow">${dashboardEscape(order.order_number)}</p><h3>${dashboardEscape(order.name)} · ${dashboardEscape(order.phone)}</h3><p>${dashboardEscape(order.email || '')}</p><p class="muted">Created ${new Date(order.created_at).toLocaleString()}</p>${order.delivery_note ? `<p>${dashboardEscape(order.delivery_note)}</p>` : ''}</div>
    <div><div class="order-status">${dashboardEscape(dashboardStatusLabel(status))}</div><strong>${dashboardMoney(order.total)}</strong><p class="payment-pill">${dashboardEscape(dashboardPaymentLabel(payment))} · ${dashboardEscape(order.payment_method || 'Paystack')}</p>${order.rider_name ? `<p class="muted">Rider: ${dashboardEscape(order.rider_name)} · ${dashboardEscape(order.rider_plate || '')}</p>` : ''}<div class="status-actions">${action}</div>${refundBlock}<a class="text-link" href="order.html?id=${encodeURIComponent(order.id)}">Customer tracking →</a></div>
  </article>`;
}

async function acceptRemoteOrder(id) {
  try {
    await dashboardRequest(`/api/orders/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status: 'ACCEPTED' }) });
    await loadDashboard();
  } catch (error) { alert(error.message); }
}

async function sendRemoteOrder(id) {
  const select = document.getElementById(`rider-${id}`);
  if (!select?.value) { alert('Select an available rider first.'); return; }
  try {
    await dashboardRequest(`/api/orders/${encodeURIComponent(id)}/assign-rider`, { method: 'POST', body: JSON.stringify({ riderId: select.value }) });
    await loadDashboard();
  } catch (error) { alert(error.message); }
}

async function dashboardSearch() {
  dashboardState.query = document.getElementById('dashboard-search')?.value.trim() || '';
  await loadDashboard();
}

function openRefundForm(orderId, remaining) {
  const old = document.getElementById('refund-modal');
  if (old) old.remove();
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="refund-modal"><div class="refund-modal panel"><button class="modal-close" onclick="document.getElementById('refund-modal').remove()">×</button><p class="eyebrow">PAYMENT REFUND</p><h2>Refund order</h2><p class="muted">Maximum remaining refund: ${dashboardMoney(remaining)}. This uses Paystack test mode while we develop.</p><label>Amount (KES)<input id="refund-amount" type="number" min="0.01" max="${remaining}" step="0.01" value="${remaining.toFixed(2)}"></label><label>Customer note<textarea id="refund-customer-note" placeholder="Optional message shown to the customer"></textarea></label><label>Merchant note<textarea id="refund-merchant-note" placeholder="Internal refund reason"></textarea></label><label>Refund admin key<input id="refund-admin-key" type="password" autocomplete="off" placeholder="Your Render REFUND_ADMIN_KEY"></label><p class="muted">The key is sent only in the request header and is not stored by this page.</p><button class="btn" onclick="submitRemoteRefund('${orderId}',${remaining})">CONFIRM REFUND</button></div></div>`);
}

async function submitRemoteRefund(orderId, remaining) {
  const amount = Number(document.getElementById('refund-amount')?.value);
  const key = document.getElementById('refund-admin-key')?.value || '';
  const customerNote = document.getElementById('refund-customer-note')?.value.trim() || '';
  const merchantNote = document.getElementById('refund-merchant-note')?.value.trim() || '';
  if (!key) { alert('Enter the refund admin key.'); return; }
  if (!Number.isFinite(amount) || amount <= 0 || amount > remaining + 0.0001) { alert(`Enter a refund amount from 0.01 to ${remaining.toFixed(2)} KES.`); return; }
  try {
    await dashboardRequest('/api/admin/refunds', { method: 'POST', headers: { 'x-refund-admin-key': key }, body: JSON.stringify({ orderId, amount, customerNote, merchantNote }) });
    document.getElementById('refund-modal')?.remove();
    alert('Refund request submitted. Paystack will update the final status through the webhook.');
    await loadDashboard();
  } catch (error) { alert(error.message); }
}

if (document.getElementById('dashboard-view')) loadDashboard();
