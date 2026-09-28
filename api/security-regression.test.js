import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(root, 'api', 'server.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');

function routeMatches(methods, route) {
  const re = new RegExp("app\\.(?:" + methods + ")\\(\\s*['\"]" + route + "[\\s\\S]*?\\n\\s*\\}\\);", 'g');
  return [...server.matchAll(re)].map(m => m[0]);
}

test('Phase 1: order pricing is server-authoritative', () => {
  const blocks = routeMatches('post', '/api/orders');
  assert.ok(blocks.length > 0);
  const block = blocks[0];
  assert.match(block, /productId/);
  assert.match(block, /SELECT[\\s\\S]*FROM products/);
  assert.match(block, /foodSubtotal/);
  assert.match(block, /deliveryFee/);
  assert.match(block, /finalTotal/);
  assert.doesNotMatch(block, /body\\.unitPrice/);
  assert.doesNotMatch(block, /body\\.subtotal/);
  assert.doesNotMatch(block, /body\\.total/);
});

test('Phase 1: customer order access is token-bound', () => {
  for (const route of ['/api/orders/:id','/api/orders/:id/cancel','/api/orders/:id/confirm-delivery','/api/orders/:id/refunds','/api/orders/:id/live-location']) {
    const blocks = routeMatches('get|post', route);
    assert.ok(blocks.length > 0, 'missing protected route: ' + route);
    assert.ok(blocks.some(block => /requireCustomerOrder/.test(block)), 'route is not token protected: ' + route);
  }
  assert.match(server, /requireCustomerOrderBody/);
  assert.match(server, /customer_access_token_hash/);
});

test('Phase 1: refunds require idempotency and serialize refund state', () => {
  assert.match(server, /Idempotency-Key/);
  assert.match(server, /AUTO-CANCEL-\\\$\\{orderId\\}/);
  assert.match(server, /pg_advisory_xact_lock/);
  assert.match(server, /FOR UPDATE/);
  assert.match(schema, /refunds_idempotency_key_idx/);
});

test('Phase 2: CORS is allowlisted and security headers are present', () => {
  assert.match(server, /allowedCorsOrigins/);
  assert.match(server, /callback\\(null, false\\)/);
  assert.match(server, /FRONTEND_URL/);
  assert.match(server, /CORS_ALLOWED_ORIGINS/);
  assert.match(server, /X-Content-Type-Options/);
  assert.match(server, /Referrer-Policy/);
  assert.match(server, /Permissions-Policy/);
  assert.doesNotMatch(server, /app\\.use\\(cors\\(\\)\\)/);
});

test('Phase 2: rate limiting covers expensive and authentication paths', () => {
  for (const pattern of [/authRateLimit/,/googleRateLimit/,/deliveryQuoteRateLimit/,/smsTestRateLimit/,/stationPairRateLimit/,/orderCreateRateLimit/]) assert.match(server, pattern);
  assert.match(server, /smsSpendBuckets/);
  assert.match(server, /SMS_MAX_PER_RECIPIENT_PER_10_MIN/);
  assert.match(server, /SMS_MAX_PER_BUSINESS_PER_10_MIN/);
});

test('Phase 2: session TTLs are bounded and configurable', () => {
  assert.match(server, /SESSION_TTLS/);
  assert.match(server, /manager:\\s*12\\s*\\*\\s*60\\s*\\*\\s*60/);
  assert.match(server, /rider:\\s*168\\s*\\*\\s*60\\s*\\*\\s*60/);
  assert.match(server, /control:\\s*12\\s*\\*\\s*60\\s*\\*\\s*60/);
});

test('Phase 3: manager RBAC protects owner-only mutations', () => {
  for (const route of ['/api/manager/sms-settings','/api/manager/sms-test','/api/rider-invites','/api/stations','/api/stations/:id/pairing-token','/api/stations/:id/revoke','/api/stations/:id/reactivate']) {
    const blocks = routeMatches('post|put', route);
    assert.ok(blocks.length > 0, 'missing manager mutation: ' + route);
    assert.ok(blocks.some(block => /requireManagerRole\\(['"]OWNER['"]\\)/.test(block)), 'owner protection missing: ' + route);
  }
});

test('Phase 3: platform and control RBAC protect mutations', () => {
  for (const route of ['/api/platform/incidents/:id/resolve','/api/platform/businesses','/api/platform/businesses/:id','/api/platform/businesses/:id/integration','/api/control/businesses','/api/control/businesses/:id']) {
    const blocks = routeMatches('post|patch|delete', route);
    assert.ok(blocks.length > 0, 'missing platform/control mutation: ' + route);
    assert.ok(blocks.some(block => /require(?:Platform|Control)Role\\(['"]PLATFORM_OWNER['"]\\)/.test(block)), 'owner protection missing: ' + route);
  }
});

test('Phase 3: platform/control authentication is consolidated', () => {
  assert.match(server, /authenticatePlatformAdmin/);
  assert.match(server, /issuePlatformAdminSession/);
  assert.match(server, /platform_admin_sessions/);
  assert.match(server, /req\\.controlAdmin\\s*=\\s*req\\.platformAdmin/);
  assert.match(server, /PLATFORM_OWNER/);
  assert.match(server, /SUPPORT/);
});

test('Phase 3: database invariants are represented in schema and runtime migration', () => {
  for (const pattern of [/customers\\(business_id, id\\)/,/products\\(business_id, id\\)/,/orders\\(business_id, id\\)/,/orders_customer_tenant_fk/,/products_price_nonnegative/,/orders_amounts_nonnegative/,/order_items_amount_nonnegative/]) {
    assert.match(schema, pattern);
    assert.match(server, pattern);
  }
  assert.match(server, /ensurePhase3SecuritySchema/);
});
