const managerRoot = document.getElementById('manager-view');

function managerMoney(value) {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(Number(value || 0));
}

function managerDate(value) {
  return new Date(value).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
}

async function loadManager() {
  managerRoot.innerHTML = '<div class="panel"><p>Loading manager overview…</p></div>';
  try {
    const [orders, features] = await Promise.all([apiRequest('/api/orders?businessId=' + encodeURIComponent(BUSINESS_ID)), apiRequest('/api/features?businessId=' + encodeURIComponent(BUSINESS_ID))]);
    const stats = orders.reduce((s, o) => {
      s.orders += 1;
      s.revenue += Number(o.total || 0);
      if (o.payment_status === 'PAID') s.paid += 1;
      if (o.payment_status === 'PENDING') s.pending += 1;
      if (o.payment_status === 'REFUNDED') s.refunded += Number(o.total || 0);
      if (o.status === 'OUT_FOR_DELIVERY') s.delivery += 1;
      if (o.status === 'DELIVERED') s.delivered += 1;
      return s;
    }, { orders: 0, revenue: 0, paid: 0, pending: 0, refunded: 0, delivery: 0, delivered: 0 });

    let riderAnalyticsHtml = '';
    if (features.riderModule) {
      try {
        const riders = await getAdminRiders();
        riderAnalyticsHtml = '<section class="panel manager-section"><div class="section-head"><div><p class="eyebrow">DELIVERY OPERATIONS</p><h2>Rider performance</h2></div><p>Trips, distance, online status and rider earnings.</p></div><div class="orders">' + (riders.length ? riders.map(r => '<article class="order-card"><div><h3>'+r.name+'</h3><p>'+r.vehicle_type+' · '+r.number_plate+' · '+(r.phone||'')+'</p><p><strong>'+r.trip_count+'</strong> trips · <strong>'+Number(r.distance_km||0).toFixed(1)+' km</strong> · <strong>'+managerMoney(r.earnings||0)+'</strong></p></div><div><div class="order-status">'+(r.online?'ONLINE':'OFFLINE')+' · '+(r.busy?'BUSY':'AVAILABLE')+'</div><p class="muted">Payout: '+(r.payout_phone||r.phone||'Not set')+'</p></div></article>').join('') : '<p class="muted">No riders yet.</p>') + '</div></section>';
      } catch {}
    }
    managerRoot.innerHTML = riderAnalyticsHtml + `
      <div class="dashboard-head">
        <div>
          <p class="eyebrow">SAVANNA BITES • MANAGEMENT</p>
          <h1>Business overview.</h1>
          <p class="muted">A management view for orders, payments, delivery and financial activity.</p>
        </div>
        <div class="status-actions">
          <a class="btn" href="dashboard.html">Open restaurant</a>
          ${features.riderModule ? '<a class="btn" href="rider.html">Open riders</a>' : ''}
        </div>
      </div>

      <section class="manager-stats">
        <article class="panel"><p class="eyebrow">ORDERS</p><h2>${stats.orders}</h2><p class="muted">Orders recorded</p></article>
        <article class="panel"><p class="eyebrow">PAID</p><h2>${stats.paid}</h2><p class="muted">Payments confirmed</p></article>
        <article class="panel"><p class="eyebrow">REVENUE</p><h2>${managerMoney(stats.revenue)}</h2><p class="muted">Order value recorded</p></article>
        <article class="panel"><p class="eyebrow">DELIVERY</p><h2>${stats.delivery}</h2><p class="muted">Currently out for delivery</p></article>
      </section>

      <section class="panel manager-section">
        <div class="section-head"><div><p class="eyebrow">FINANCIAL CONTROL</p><h2>Payments & refunds</h2></div><p>Payment confirmation remains separate from the order workflow. Refunds are recorded independently.</p></div>
        <div class="summary-row"><span>Pending payments</span><strong>${stats.pending}</strong></div>
        <div class="summary-row"><span>Refunded order value</span><strong>${managerMoney(stats.refunded)}</strong></div>
        <div class="summary-row"><span>Delivered orders</span><strong>${stats.delivered}</strong></div>
      </section>

      <section class="panel manager-section">
        <div class="section-head"><div><p class="eyebrow">RECENT ACTIVITY</p><h2>Latest orders</h2></div><a class="text-link" href="archive.html">Open records →</a></div>
        <div class="orders">${orders.slice(0, 10).map(o => `
          <article class="order-card">
            <div><h3>${o.order_number || o.id}</h3><p>${o.name || ''} · ${o.phone || ''}</p><p>${managerDate(o.created_at)}</p></div>
            <div><div class="order-status">${o.payment_status}</div><strong>${managerMoney(o.total)}</strong><p>${o.status}</p><a class="text-link" href="order.html?id=${encodeURIComponent(o.id)}">View order →</a></div>
          </article>`).join('') || '<div class="empty"><h2>No orders yet.</h2></div>'}</div>
      </section>
    `;
  } catch (error) {
    managerRoot.innerHTML = `<div class="panel"><h2>Manager data unavailable</h2><p class="muted">${error.message}</p><button class="btn" onclick="loadManager()">Try again</button></div>`;
  }
}

loadManager();
