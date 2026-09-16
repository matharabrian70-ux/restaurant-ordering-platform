const DASHBOARD_API = 'https://restaurant-ordering-api-ow3p.onrender.com';
const DASHBOARD_BUSINESS_ID = '11111111-1111-4111-8111-111111111111';

const dashboardState = {
  orders: [],
  riders: [],
  query: '',
  filter: 'NEW',
  loading: false,
  firstLoad: true,
  lastSeenPaidOrders: new Set(),
  alertsEnabled: false,
  refreshTimer: null
};

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
  return ({
    NEW: 'NEW ORDER',
    ACCEPTED: 'PREPARING',
    OUT_FOR_DELIVERY: 'OUT FOR DELIVERY',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED'
  }[status] || status);
}

function dashboardPaymentLabel(status) {
  return ({ PENDING:'Payment pending', PAID:'PAYMENT CONFIRMED', REFUNDED:'Refunded' }[status] || status);
}

function dashboardAge(createdAt) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

function dashboardFilterOrders() {
  const orders = dashboardState.orders;
  if (dashboardState.filter === 'ALL') return orders;
  if (dashboardState.filter === 'NEW') return orders.filter(o => o.status === 'NEW');
  if (dashboardState.filter === 'PREPARING') return orders.filter(o => o.status === 'ACCEPTED');
  if (dashboardState.filter === 'DELIVERY') return orders.filter(o => o.status === 'OUT_FOR_DELIVERY');
  if (dashboardState.filter === 'COMPLETED') return orders.filter(o => o.status === 'DELIVERED');
  if (dashboardState.filter === 'CANCELLED') return orders.filter(o => o.status === 'CANCELLED');
  return orders;
}

async function loadDashboard() {
  const view = document.getElementById('dashboard-view');
  if (!view) return;
  dashboardState.loading = true;
  if (dashboardState.firstLoad) view.innerHTML = '<div class="ops-loading"><div class="ops-spinner"></div><strong>Connecting to restaurant operations…</strong><span>Loading live orders and rider availability.</span></div>';

  try {
    const [orders, riders] = await Promise.all([
      dashboardRequest(`/api/orders?businessId=${encodeURIComponent(DASHBOARD_BUSINESS_ID)}&q=${encodeURIComponent(dashboardState.query)}`),
      dashboardRequest(`/api/riders?businessId=${encodeURIComponent(DASHBOARD_BUSINESS_ID)}`)
    ]);

    const paidNow = new Set(orders.filter(o => o.status === 'NEW' && o.payment_status === 'PAID').map(o => o.id));
    if (!dashboardState.firstLoad && dashboardState.alertsEnabled) {
      const hasNewPaidOrder = [...paidNow].some(id => !dashboardState.lastSeenPaidOrders.has(id));
      if (hasNewPaidOrder) playOrderAlert();
    }
    dashboardState.lastSeenPaidOrders = paidNow;
    dashboardState.orders = orders;
    dashboardState.riders = riders;
    dashboardState.firstLoad = false;
    await renderRemoteDashboard();
  } catch (error) {
    view.innerHTML = `<div class="ops-error panel"><div><p class="eyebrow">CONNECTION</p><h2>Restaurant system unavailable</h2><p class="muted">${dashboardEscape(error.message)}</p></div><button class="btn" onclick="loadDashboard()">RECONNECT</button></div>`;
  } finally {
    dashboardState.loading = false;
    scheduleDashboardRefresh();
  }
}

function scheduleDashboardRefresh() {
  if (dashboardState.refreshTimer) clearTimeout(dashboardState.refreshTimer);
  dashboardState.refreshTimer = setTimeout(loadDashboard, 5000);
}

function playOrderAlert() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(1175, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.5);
  } catch {}
}

function enableOrderAlerts() {
  dashboardState.alertsEnabled = true;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      const ctx = new AudioContextClass();
      ctx.resume().then(() => ctx.close()).catch(() => {});
    }
  } catch {}
  renderRemoteDashboard();
}

async function renderRemoteDashboard() {
  const view = document.getElementById('dashboard-view');
  if (!view) return;
  const orders = dashboardState.orders;
  const paid = orders.filter(o => o.payment_status === 'PAID' && o.status !== 'CANCELLED').length;
  const pending = orders.filter(o => o.payment_status === 'PENDING').length;
  const newPaid = orders.filter(o => o.status === 'NEW' && o.payment_status === 'PAID').length;
  const preparing = orders.filter(o => o.status === 'ACCEPTED').length;
  const out = orders.filter(o => o.status === 'OUT_FOR_DELIVERY').length;
  const delivered = orders.filter(o => o.status === 'DELIVERED').length;
  const cancelled = orders.filter(o => o.status === 'CANCELLED').length;
  const availableRiders = dashboardState.riders.filter(r => r.available).length;
  const visibleOrders = dashboardFilterOrders();

  const cards = await Promise.all(visibleOrders.map(async order => {
    const refunds = order.payment_status === 'PAID' || order.payment_status === 'REFUNDED'
      ? await dashboardRequest(`/api/orders/${encodeURIComponent(order.id)}/refunds`).catch(() => [])
      : [];
    return renderOrderCard(order, refunds);
  }));

  view.innerHTML = `
    <section class="ops-header">
      <div>
        <div class="ops-kicker"><span class="ops-pulse"></span> LIVE ORDER STATION</div>
        <h1>Orders.</h1>
        <p class="muted">Everything the restaurant needs to receive, confirm and move orders forward.</p>
      </div>
      <div class="ops-header-actions">
        <button class="alert-toggle ${dashboardState.alertsEnabled ? 'active' : ''}" onclick="enableOrderAlerts()">${dashboardState.alertsEnabled ? '🔔 Alerts on' : '🔕 Enable order alerts'}</button>
        <button class="refresh-button" onclick="loadDashboard()" ${dashboardState.loading ? 'disabled' : ''}>↻ Refresh</button>
      </div>
    </section>

    <section class="ops-summary">
      <button class="ops-summary-card urgent" onclick="setDashboardFilter('NEW')"><span>NEW PAID ORDERS</span><strong>${newPaid}</strong><small>Need restaurant action</small></button>
      <button class="ops-summary-card" onclick="setDashboardFilter('PREPARING')"><span>PREPARING</span><strong>${preparing}</strong><small>Accepted orders</small></button>
      <button class="ops-summary-card" onclick="setDashboardFilter('DELIVERY')"><span>OUT FOR DELIVERY</span><strong>${out}</strong><small>Currently with riders</small></button>
      <button class="ops-summary-card" onclick="setDashboardFilter('COMPLETED')"><span>COMPLETED</span><strong>${delivered}</strong><small>Delivered orders</small></button>
    </section>

    <section class="ops-control-bar">
      <div class="ops-tabs" role="tablist" aria-label="Order filters">
        ${renderFilterButton('NEW', `New <b>${newPaid}</b>`)}
        ${renderFilterButton('PREPARING', `Preparing <b>${preparing}</b>`)}
        ${renderFilterButton('DELIVERY', `Delivery <b>${out}</b>`)}
        ${renderFilterButton('COMPLETED', `Completed <b>${delivered}</b>`)}
        ${renderFilterButton('CANCELLED', `Cancelled <b>${cancelled}</b>`)}
        ${renderFilterButton('ALL', `All <b>${orders.length}</b>`)}
      </div>
      <div class="ops-search"><input id="dashboard-search" value="${dashboardEscape(dashboardState.query)}" placeholder="Search order, customer or phone" onkeydown="if(event.key==='Enter')dashboardSearch()"><button onclick="dashboardSearch()">Search</button></div>
    </section>

    <section class="ops-status-strip">
      <div><span class="status-led green"></span><strong>System online</strong><small>Auto-refresh every 5 seconds</small></div>
      <div><strong>${paid}</strong><small>paid orders</small></div>
      <div><strong>${pending}</strong><small>awaiting payment</small></div>
      <div><strong>${availableRiders}</strong><small>riders available</small></div>
      <a href="rider.html">Manage rider operations →</a>
    </section>

    <section class="ops-orders-head">
      <div><p class="eyebrow">${dashboardState.filter === 'ALL' ? 'ALL ORDERS' : dashboardState.filter}</p><h2>${visibleOrders.length} ${visibleOrders.length === 1 ? 'order' : 'orders'}</h2></div>
      <span class="last-sync">Last checked just now</span>
    </section>

    <div class="ops-orders">${cards.join('') || `<div class="ops-empty"><div class="empty-icon">✓</div><h2>No ${dashboardState.filter === 'ALL' ? '' : dashboardState.filter.toLowerCase()} orders</h2><p>New activity will appear here automatically.</p></div>`}</div>
  `;
}

function renderFilterButton(filter, label) {
  return `<button class="ops-tab ${dashboardState.filter === filter ? 'active' : ''}" onclick="setDashboardFilter('${filter}')">${label}</button>`;
}

function setDashboardFilter(filter) {
  dashboardState.filter = filter;
  renderRemoteDashboard();
}

function renderOrderCard(order, refunds) {
  const status = order.status;
  const payment = order.payment_status;
  const matchingRiders = dashboardState.riders.filter(r => r.available);
  const refundTotal = refunds.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const remaining = Math.max(0, Number(order.total || 0) - refundTotal);
  const isNewPaid = status === 'NEW' && payment === 'PAID';
  const isPending = payment === 'PENDING';

  const action = isNewPaid
    ? `<button class="primary-order-action" onclick="acceptRemoteOrder('${order.id}')"><span>✓</span> ACCEPT ORDER</button>`
    : status === 'ACCEPTED'
      ? `<div class="dispatch-action"><label>Assign available rider<select id="rider-${order.id}"><option value="">Choose rider</option>${matchingRiders.map(r => `<option value="${r.id}">${dashboardEscape(r.name)} · ${dashboardEscape(r.vehicle_type || 'Vehicle')}</option>`).join('')}</select></label><button class="primary-order-action" onclick="sendRemoteOrder('${order.id}')">SEND FOR DELIVERY →</button></div>`
      : status === 'OUT_FOR_DELIVERY'
        ? `<div class="waiting-action"><span class="status-led green"></span><strong>Delivery in progress</strong><small>Waiting for delivery confirmation.</small></div>`
        : status === 'DELIVERED'
          ? `<div class="completed-action">✓ Delivery completed</div>`
          : status === 'CANCELLED'
            ? `<div class="cancelled-action">Order cancelled${payment === 'REFUNDED' ? ' · refund completed' : ''}</div>`
            : `<div class="waiting-action"><span class="status-led amber"></span><strong>Awaiting payment</strong><small>Do not accept until payment is confirmed.</small></div>`;

  const refundBlock = payment === 'PAID' || payment === 'REFUNDED' ? `
    <div class="refund-box">
      <div class="refund-head"><div><p class="eyebrow">PAYMENT</p><strong>${dashboardMoney(order.total)}</strong><small>${dashboardMoney(refundTotal)} refunded · ${dashboardMoney(remaining)} refundable</small></div>${remaining > 0 && payment === 'PAID' ? `<button class="text-link" onclick="openRefundForm('${order.id}',${remaining})">Refund</button>` : ''}</div>
      ${refunds.length ? refunds.map(r => `<div class="refund-row"><span>${dashboardMoney(r.amount)} · ${dashboardEscape(r.status)}</span><small>${new Date(r.created_at).toLocaleString()}</small></div>`).join('') : ''}
    </div>` : '';

  const orderClass = isNewPaid ? 'ops-order-card new-order' : '';
  const delivery = order.rider_name ? `<div class="rider-assignment"><span class="mini-icon">R</span><div><strong>${dashboardEscape(order.rider_name)}</strong><small>${dashboardEscape(order.rider_vehicle || 'Vehicle')} · ${dashboardEscape(order.rider_plate || '')}</small></div></div>` : '';

  return `<article class="ops-order-card ${orderClass}">
    <div class="ops-order-main">
      <div class="ops-order-top">
        <div><span class="order-number">${dashboardEscape(order.order_number)}</span><span class="order-age">${dashboardAge(order.created_at)}</span></div>
        <span class="ops-status ${status.toLowerCase()}">${dashboardEscape(dashboardStatusLabel(status))}</span>
      </div>
      ${isNewPaid ? `<div class="payment-confirmed-banner"><span>✓</span><strong>PAYMENT CONFIRMED</strong><small>${dashboardEscape(order.payment_method || 'Paystack')}</small></div>` : `<div class="payment-line"><span class="payment-dot ${payment.toLowerCase()}"></span>${dashboardEscape(dashboardPaymentLabel(payment))} · ${dashboardEscape(order.payment_method || 'Paystack')}</div>`}
      <div class="customer-block"><div class="customer-avatar">${dashboardEscape((order.name || '?').charAt(0).toUpperCase())}</div><div><strong>${dashboardEscape(order.name)}</strong><span>${dashboardEscape(order.phone)}</span>${order.email ? `<span>${dashboardEscape(order.email)}</span>` : ''}</div></div>
      ${order.delivery_note ? `<div class="order-note"><strong>Customer note</strong><p>${dashboardEscape(order.delivery_note)}</p></div>` : ''}
      ${delivery}
    </div>
    <div class="ops-order-side">
      <div class="order-total-label">ORDER TOTAL<strong>${dashboardMoney(order.total)}</strong></div>
      <div class="ops-action-area">${action}</div>
      ${refundBlock}
      <div class="order-links"><a href="order.html?id=${encodeURIComponent(order.id)}">Open customer tracking</a></div>
    </div>
  </article>`;
}

async function acceptRemoteOrder(id) {
  try {
    await dashboardRequest(`/api/orders/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status: 'ACCEPTED' }) });
    dashboardState.filter = 'PREPARING';
    await loadDashboard();
  } catch (error) { alert(error.message); }
}

async function sendRemoteOrder(id) {
  const select = document.getElementById(`rider-${id}`);
  if (!select?.value) { alert('Select an available rider first.'); return; }
  try {
    await dashboardRequest(`/api/orders/${encodeURIComponent(id)}/assign-rider`, { method: 'POST', body: JSON.stringify({ riderId: select.value }) });
    dashboardState.filter = 'DELIVERY';
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
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="refund-modal"><div class="refund-modal panel"><button class="modal-close" onclick="document.getElementById('refund-modal').remove()">×</button><p class="eyebrow">PAYMENT REFUND</p><h2>Refund order</h2><p class="muted">Maximum remaining refund: ${dashboardMoney(remaining)}. This uses Paystack test mode while we develop.</p><label>Amount (KES)<input id="refund-amount" type="number" min="0.01" max="${remaining}" step="0.01" value="${remaining.toFixed(2)}"></label><label>Customer note<textarea id="refund-customer-note" placeholder="Optional message shown to the customer"></textarea></label><label>Merchant note<textarea id="refund-merchant-note" placeholder="Internal refund reason"></textarea></label><label>Refund admin key<input id="refund-admin-key" type="password" autocomplete="off" placeholder="Manager authorization key"></label><p class="muted">Temporary development authorization. We will replace this with manager/staff authentication before production.</p><button class="btn wide" onclick="submitRemoteRefund('${orderId}',${remaining})">CONFIRM REFUND</button></div></div>`);
}

async function submitRemoteRefund(orderId, remaining) {
  const amount = Number(document.getElementById('refund-amount')?.value);
  const key = document.getElementById('refund-admin-key')?.value || '';
  const customerNote = document.getElementById('refund-customer-note')?.value.trim() || '';
  const merchantNote = document.getElementById('refund-merchant-note')?.value.trim() || '';
  if (!key) { alert('Enter the manager authorization key.'); return; }
  if (!Number.isFinite(amount) || amount <= 0 || amount > remaining + 0.0001) { alert(`Enter a refund amount from 0.01 to ${remaining.toFixed(2)} KES.`); return; }
  try {
    await dashboardRequest('/api/admin/refunds', { method: 'POST', headers: { 'x-refund-admin-key': key }, body: JSON.stringify({ orderId, amount, customerNote, merchantNote }) });
    document.getElementById('refund-modal')?.remove();
    alert('Refund request submitted. Paystack will update the final status through the webhook.');
    await loadDashboard();
  } catch (error) { alert(error.message); }
}

if (document.getElementById('dashboard-view')) loadDashboard();