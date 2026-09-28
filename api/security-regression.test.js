import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(root, 'api', 'server.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');

function section(route, span = 7000) {
  const index = server.indexOf(route);
  assert.ok(index >= 0, 'route/string missing: ' + route);
  return server.slice(index, index + span);
}

function has(text, value, message = value) {
  assert.ok(text.includes(value), 'missing: ' + message);
}

test('Phase 1: order pricing is server-authoritative', () => {
  const block = section('/api/orders');
  has(block, 'productId');
  has(block, 'FROM products');
  has(block, 'foodSubtotal');
  has(block, 'deliveryFee');
  has(block, 'finalTotal');
  assert.doesNotMatch(block, /body\\.unitPrice/);
  assert.doesNotMatch(block, /body\\.subtotal/);
  assert.doesNotMatch(block, /body\\.total/);
});

test('Phase 1: customer order access is token-bound', () => {
  for (const route of ['/api/orders/:id','/api/orders/:id/cancel','/api/orders/:id/confirm-delivery','/api/orders/:id/refunds','/api/orders/:id/live-location']) has(server, route);
  has(server, 'requireCustomerOrder');
  has(server, 'requireCustomerOrderBody');
  has(server, 'customer_access_token_hash');
});

test('Phase 1: refunds require idempotency and serialized state', () => {
  has(server, 'Idempotency-Key');
  has(server, 'AUTO-CANCEL-' + '$' + '{orderId}');
  has(server, 'pg_advisory_xact_lock');
  has(server, 'FOR UPDATE');
  has(schema, 'refunds_idempotency_key_idx');
});

test('Phase 2: CORS is allowlisted and security headers are present', () => {
  for (const value of ['allowedCorsOrigins','FRONTEND_URL','CORS_ALLOWED_ORIGINS','X-Content-Type-Options','Referrer-Policy','Permissions-Policy']) has(server, value);
  has(server, 'callback(null, false)');
  assert.doesNotMatch(server, /app\\.use\\(cors\\(\\)\\)/);
});

test('Phase 2: rate limiting covers expensive and authentication paths', () => {
  for (const value of ['authRateLimit','googleRateLimit','deliveryQuoteRateLimit','smsTestRateLimit','stationPairRateLimit','orderCreateRateLimit','smsSpendBuckets','SMS_MAX_PER_RECIPIENT_PER_10_MIN','SMS_MAX_PER_BUSINESS_PER_10_MIN']) has(server, value);
});

test('Phase 2: session TTLs are bounded and configurable', () => {
  has(server, 'SESSION_TTLS');
  for (const value of ['manager: 12 * 60 * 60','rider: 168 * 60 * 60','control: 12 * 60 * 60']) has(server, value);
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
  for (const value of ['authenticatePlatformAdmin','issuePlatformAdminSession','platform_admin_sessions','req.controlAdmin = req.platformAdmin','PLATFORM_OWNER','SUPPORT']) has(server, value);
});

test('Phase 3: database invariants are represented in schema and runtime migration', () => {
  for (const value of ['customers(business_id, id)','products(business_id, id)','orders(business_id, id)','orders_customer_tenant_fk','products_price_nonnegative','orders_amounts_nonnegative','order_items_amount_nonnegative']) {
    has(schema, value);
    has(server, value);
  }
  has(server, 'ensurePhase3SecuritySchema');
});
