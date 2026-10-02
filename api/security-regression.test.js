import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(root, 'api', 'server.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const compliance = fs.readFileSync(path.join(root, 'api', 'compliance.js'), 'utf8');
const complianceMigration = fs.readFileSync(path.join(root, 'api', 'migrations', '009_phase_q_compliance_foundation.sql'), 'utf8');

function section(marker, span = 7000) {
  const index = server.indexOf(marker);
  assert.ok(index >= 0, 'marker missing: ' + marker);
  return server.slice(index, index + span);
}

function has(text, value, message = value) {
  assert.ok(text.includes(value), 'missing: ' + message);
}

test('Phase 1: order pricing is server-authoritative', () => {
  const block = section("app.post('/api/orders'", 14000);
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
  for (const value of ['authRateLimit','googleRateLimit','quoteRateLimit','smsTestRateLimit','stationPairRateLimit','orders:${clientIp','consumeSmsBudget','SMS_MAX_PER_RECIPIENT_PER_10_MIN','SMS_MAX_PER_BUSINESS_PER_10_MIN']) has(server, value);
});

test('Cookie migration foundation: API origin and shared session abstraction are centralized', () => {
  const apiConfig = fs.readFileSync(path.join(root, 'api-config.js'), 'utf8');
  const sessions = fs.readFileSync(path.join(root, 'session-auth.js'), 'utf8');
  const apiClient = fs.readFileSync(path.join(root, 'api-client.js'), 'utf8');
  const delivery = fs.readFileSync(path.join(root, 'delivery.js'), 'utf8');
  const platform = fs.readFileSync(path.join(root, 'platform-control.js'), 'utf8');
  has(apiConfig, 'PLATFORM_API_ORIGIN');
  for (const value of ['manager','rider','platform','__Host-manager_session','__Host-rider_session','__Host-platform_session']) has(sessions, value);
  has(apiClient, 'PlatformSession');
  has(delivery, 'PlatformSession');
  has(platform, 'PlatformSession');
  for (const value of ['getPresentedSessionToken','createAuthSession','AUTH_SESSION_DEFINITIONS']) has(server, value);
  assert.match(server, /source:\s*'cookie'/);
  assert.match(server, /source:\s*'bearer'/);
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

test('Post-Phase 5: GPS samples reject poor accuracy and impossible movement', () => {
  has(server, 'RIDER_GPS_MAX_ACCURACY_METERS');
  has(server, 'RIDER_GPS_FRESHNESS_SECONDS');
  has(server, 'RIDER_GPS_MAX_SPEED_MPS');
  has(server, 'validateGpsSample');
  has(server, 'suspicious:true');
});

test('Post-Phase 5: rider assignment requires fresh usable GPS by default', () => {
  has(server, 'RIDER_GPS_REQUIRED_FOR_ASSIGNMENT');
  has(server, 'p.location_updated_at >= now()');
  has(server, 'RIDER_GPS_FRESHNESS_SECONDS');
  has(server, 'RIDER_GPS_MAX_ACCURACY_METERS');
});

test('Post-Phase 5: public delivery quotes have business throttling and route caching', () => {
  has(server, 'quoteBusinessRateLimit');
  has(server, 'deliveryQuoteCache');
  has(server, 'DELIVERY_QUOTE_CACHE_SECONDS');
  has(server, 'DELIVERY_QUOTE_MAX_ADDRESS_LENGTH');
  has(server, "status='EXPIRED'");
});

test('Post-Phase 5: anonymous order creation has client fingerprint and pending-order abuse controls', () => {
  has(server, 'order-fingerprint:');
  has(server, 'pendingSpam');
  has(server, "o.status='NEW'");
  has(server, "o.payment_status='PENDING'");
});

test('Post-Phase 5: anonymous telemetry is rate limited and URLs are scheme validated', () => {
  has(server, 'telemetryRateLimit');
  has(server, 'Invalid telemetry URL');
  has(server, "['http:','https:']");
});

test('Post-Phase 5: customer-facing dynamic HTML is escaped', () => {
  const checkout = fs.readFileSync(path.join(root, 'checkout-ui.js'), 'utf8');
  const orderUi = fs.readFileSync(path.join(root, 'order-api-ui.js'), 'utf8');
  assert.match(checkout, /escapeCheckoutHtml/);
  assert.match(orderUi, /escapeOrderHtml/);
  assert.doesNotMatch(orderUi, /insertAdjacentHTML/);
});
test('Shared throttling: sensitive limits use PostgreSQL-backed state', () => {
  has(server, 'security_rate_limit_buckets');
  has(server, 'consumeSharedRateLimit');
  has(server, 'sharedRateLimit');
  has(server, 'on conflict(key) do update');
  has(server, 'sms-spend:');
  has(server, 'Global request limiting remains local');
});

test('Security audit: manager rider trip history is tenant-bound', () => {
  has(server, "r.business_id=$2");
  has(server, "o.business_id=$2");
  has(server, "req.manager.business_id");
});


test('Security hardening: SSE uses short-lived scoped realtime tokens instead of session credentials', () => {
  has(server, 'realtime_access_tokens');
  has(server, 'REALTIME_TOKEN_TTL_SECONDS');
  has(server, "scope in ('CUSTOMER_ORDER','MANAGER','RIDER','STATION')");
  has(server, "app.post('/api/realtime-token'");
  has(server, "getRealtimeAccessToken(String(req.query.realtimeToken||'').trim())");
  const riderSse=section("app.get('/api/riders/events'");
  const stationSse=section("app.get('/api/station/events'");
  assert.doesNotMatch(riderSse, /riderToken/);
  assert.doesNotMatch(stationSse, /stationToken/);
});

test('Security hardening: external API quotas and alert thresholds are enforced per restaurant', () => {
  has(server, 'external_api_usage_buckets');
  has(server, 'external_api_usage_alerts');
  has(server, 'EXTERNAL_API_DAILY_ROUTE_QUOTA');
  has(server, 'EXTERNAL_API_MONTHLY_ROUTE_QUOTA');
  has(server, 'EXTERNAL_API_DAILY_SMS_QUOTA');
  has(server, 'EXTERNAL_API_MONTHLY_SMS_QUOTA');
  has(server, 'EXTERNAL_API_ALERT_PERCENT');
  has(server, 'EXTERNAL_API_QUOTA_EXCEEDED');
  has(server, "provider:'GOOGLE_MAPS'");
  has(server, "provider:'AFRICASTALKING'");
});

test('Security hardening: frontend CSP is deployed and dynamic promotion content is escaped', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  has(index, 'Content-Security-Policy');
  has(index, "frame-ancestors 'none'");
  has(index, "object-src 'none'");
  has(app, 'escapeMenuHtml(p.name||\'Offer\')');
  has(app, 'escapeMenuHtml(p.banner_text');
});

test('Compliance foundation: legal acceptance, consent and rights workflows are enforced', () => {
  for (const value of ['ensureComplianceSchema','registerComplianceRoutes','privacy_consents','data_subject_requests','compliance_processors','privacy_incidents','LEGAL_VERSIONS']) has(server+compliance,value);
  const orderBlock=section("app.post('/api/orders'",22000);
  has(orderBlock,'termsAccepted');
  has(orderBlock,'privacyNoticeAccepted');
  has(orderBlock,'marketingOptIn');
  has(orderBlock,'privacy_notice_version');
  has(orderBlock,'legal_accepted_at');
});

test('Compliance foundation: privacy-by-design records are tenant scoped', () => {
  for (const value of ['business_privacy_settings','where business_id=$1','/api/manager/privacy','/api/privacy/config','/api/privacy/requests']) has(server+compliance,value);
  for (const value of ['privacy_contact_email','retention_customer_days','retention_order_days','live_gps_retention_hours']) has(complianceMigration,value);
});

test('Compliance foundation: launch documents and customer consent UI exist', () => {
  const checkout=fs.readFileSync(path.join(root,'checkout-ui.js'),'utf8');
  const apiClient=fs.readFileSync(path.join(root,'api-client.js'),'utf8');
  const menu=fs.readFileSync(path.join(root,'menu.html'),'utf8');
  has(checkout,'terms-accepted');
  has(checkout,'marketing-opt-in');
  has(apiClient,'legal: legal || {}');
  has(menu,'compliance-ui.js');
  for (const file of ['privacy.html','terms.html','cookie-policy.html','refund-policy.html','delivery-terms.html','data-rights.html','merchant-agreement.md','data-processing-agreement.md','rider-terms.md','data-protection-policy.md','privacy-dpia.md','processor-register.md','COMMERCIAL_LAUNCH_COMPLIANCE.md']) {
    assert.ok(fs.existsSync(path.join(root,file)), 'missing compliance document: '+file);
  }
});

test('Commercial launch gate: tenant health requires a real privacy contact', () => {
  has(server,'MISSING_PRIVACY_CONTACT');
  has(server,'has_privacy_contact');
  has(server,'business_privacy_settings');
});
