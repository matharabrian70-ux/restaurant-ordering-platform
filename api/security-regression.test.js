import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(root, 'api', 'server.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');

function section(marker, span = 7000) {
  const index = server.indexOf(marker);
  assert.ok(index >= 0, 'marker missing: ' + marker);
  return server.slice(index, index + span);
}

function has(text, value, message = value) {
  assert.ok(text.includes(value), 'missing: ' + message);
}

test('Phase 1: order pricing is server-authoritative', () => {
  const block = section("app.post('/api/orders'");
  has(block, 'productId'); assert.match(block, /from products/i); for (const value of ['foodSubtotal','deliveryFee','numericTotal']) has(block, value);
  assert.doesNotMatch(block, /body\\.unitPrice/);
  assert.doesNotMatch(block, /body\\.subtotal/);
  assert.doesNotMatch(block, /body\\.total/);
});

test('Phase 1: customer order access is token-bound', () => {
  for (const route of ['/api/orders/:id','/api/orders/:id/cancel','/api/orders/:id/confirm-delivery','/api/orders/:id/refunds','/api/orders/:id/live-location']) has(server, route);
  for (const value of ['requireCustomerOrder','requireCustomerOrderBody','customer_access_token_hash']) has(server, value);
});

test('Phase 1: refunds require idempotency and serialized state', () => {
  for (const value of ['Idempotency-Key','AUTO-CANCEL-','pg_advisory_xact_lock','refunds_idempotency_key_idx']) {
    has(server + schema, value);
  }
});

test('Phase 2: CORS is allowlisted and security headers are present', () => {
  for (const value of ['allowedCorsOrigins','FRONTEND_URL','CORS_ALLOWED_ORIGINS','X-Content-Type-Options','Referrer-Policy','Permissions-Policy','callback(null, false)']) has(server, value);
  assert.doesNotMatch(server, /app\\.use\\(cors\\(\\)\\)/);
});

test('Phase 2: rate limiting covers expensive and authentication paths', () => {
  for (const value of ['authRateLimit','googleRateLimit','quoteRateLimit','smsTestRateLimit','stationPairRateLimit','orders:${clientIp','smsSpendBuckets','SMS_MAX_PER_RECIPIENT_PER_10_MIN','SMS_MAX_PER_BUSINESS_PER_10_MIN']) has(server, value);
});

test('Phase 2: session TTLs are bounded and configurable', () => {
  has(server, 'SESSION_TTLS');
  for (const value of ['managerHours','riderHours','stationHours','controlHours','MANAGER_SESSION_HOURS','RIDER_SESSION_HOURS','CONTROL_SESSION_HOURS']) has(server, value);
});

test('Phase 3: manager RBAC protects owner-only mutations', () => {
  for (const route of ['/api/manager/sms-settings','/api/manager/sms-test','/api/rider-invites','/api/stations','/api/stations/:id/pairing-token','/api/stations/:id/revoke','/api/stations/:id/reactivate']) has(server, route);
  has(server, "requireManagerRole('OWNER')");
});

test('Phase 3: platform and control RBAC protect mutations', () => {
  for (const route of ['/api/platform/incidents/:id/resolve','/api/platform/businesses','/api/platform/businesses/:id','/api/platform/businesses/:id/integration','/api/control/businesses','/api/control/businesses/:id']) has(server, route);
  has(server, "requirePlatformRole('PLATFORM_OWNER')");
  has(server, "requireControlRole('PLATFORM_OWNER')");
});

test('Phase 3: platform/control authentication is consolidated', () => {
  for (const value of ['authenticatePlatformAdmin','issuePlatformAdminSession','platform_admin_sessions','req.controlAdmin=admin','req.platformAdmin=admin','PLATFORM_OWNER','SUPPORT']) has(server, value);
});

test('Phase 3: database invariants are represented in schema and runtime migration', () => {
  for (const value of ['customers_business_id_id_uidx','products_business_id_id_uidx','orders_business_id_id_uidx','orders_customer_tenant_fk','products_price_nonnegative','orders_amounts_nonnegative','order_items_amount_nonnegative']) {
    has(schema, value);
    has(server, value);
  }
  has(server, 'ensurePhase3SecuritySchema');
});

test('Phase 5: rider priority is GPS-based at the branch', () => {
  const manager = fs.readFileSync(path.join(root, 'manager.js'), 'utf8');
  const api = server;
  const delivery = fs.readFileSync(path.join(root, 'delivery.js'), 'utf8');
  for (const value of ['r.latitude','r.longitude','branch_latitude','branch_longitude','riderDistanceMeters','sortRiders']) has(manager, value);
  assert.match(manager, /dLat=\(blat-lat\)/);
  assert.match(manager, /dLng=\(blng-lng\)/);
  assert.match(manager, /Boolean\(x\.available\)!==Boolean\(y\.available\)/);
  assert.match(manager, /dx!==dy/);
  for (const value of ['latitude','longitude','accuracy_meters','location_updated_at']) has(api, value);
  assert.match(delivery, /navigator\.geolocation\.watchPosition/);
  assert.match(delivery, /riderPresenceLastSentAt<5000/);
});

test('Phase 5: rider GPS is authenticated and tenant-bound', () => {
  const block = section("app.post('/api/riders/:id/presence'");
  has(block, 'requireRiderModule');
  has(block, 'requireRiderAuth');
  has(block, 'req.rider.id');
  has(block, 'latitude');
  has(block, 'longitude');
});
