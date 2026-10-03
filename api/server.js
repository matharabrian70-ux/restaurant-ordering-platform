import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import QRCode from 'qrcode';
import { registerDeliveryEngine } from './delivery-engine.js';
import { registerMenuEngine } from './menu-engine.js';
import { registerPosEngine } from './pos-engine.js';
import { registerCustomerGrowth } from './customer-growth.js';
import { registerAdvancedOperations } from './advanced-operations.js';
import { registerIntelligence, runIntelligenceSweep } from './intelligence.js';
import { registerBrandingEngine } from './branding-engine.js';
import { registerReceiptEngine, ensureReceipt } from './receipt-engine.js';
import { runSelfHealingSweep } from './self-healing.js';
import { registerProductionObservability } from './production-observability.js';
import { ensureComplianceSchema, registerComplianceRoutes, runComplianceRetentionSweep, LEGAL_VERSIONS } from './compliance.js';
import { ensureControlDataIsolationSchema, registerControlDataIsolation } from './control-data-isolation.js';

const { Pool } = pg;
const app = express();
// Phase O correlation IDs provide a lightweight trace across production requests without persisting request payloads.
app.use((req, res, next) => {
  const supplied = String(req.get('X-Correlation-ID') || '').trim();
  const id = /^[A-Za-z0-9._:-]{8,128}$/.test(supplied) ? supplied : crypto.randomUUID();
  req.correlationId = id;
  res.setHeader('X-Correlation-ID', id);
  next();
});
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
const PAYSTACK_API = 'https://api.paystack.co';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://matharabrian70-ux.github.io/restaurant-ordering-platform';
// Phase 2 security controls are intentionally backend-only; dashboard structure is unchanged.

function parsePositiveInt(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

const RIDER_GPS_MAX_ACCURACY_METERS = parsePositiveInt(process.env.RIDER_GPS_MAX_ACCURACY_METERS, 250, 25, 1000);
const RIDER_GPS_FRESHNESS_SECONDS = parsePositiveInt(process.env.RIDER_GPS_FRESHNESS_SECONDS, 90, 15, 600);
const RIDER_GPS_MAX_SPEED_MPS = parsePositiveInt(process.env.RIDER_GPS_MAX_SPEED_MPS, 90, 20, 200);
const RIDER_GPS_REQUIRED_FOR_ASSIGNMENT = String(process.env.RIDER_GPS_REQUIRED_FOR_ASSIGNMENT || 'true').toLowerCase() !== 'false';
const REALTIME_TOKEN_TTL_SECONDS = parsePositiveInt(process.env.REALTIME_TOKEN_TTL_SECONDS, 300, 60, 900);
const EXTERNAL_API_DAILY_ROUTE_QUOTA = parsePositiveInt(process.env.EXTERNAL_API_DAILY_ROUTE_QUOTA, 1000, 10, 1000000);
const EXTERNAL_API_MONTHLY_ROUTE_QUOTA = parsePositiveInt(process.env.EXTERNAL_API_MONTHLY_ROUTE_QUOTA, 20000, 100, 10000000);
const EXTERNAL_API_DAILY_SMS_QUOTA = parsePositiveInt(process.env.EXTERNAL_API_DAILY_SMS_QUOTA, 200, 5, 1000000);
const EXTERNAL_API_MONTHLY_SMS_QUOTA = parsePositiveInt(process.env.EXTERNAL_API_MONTHLY_SMS_QUOTA, 5000, 10, 10000000);
const EXTERNAL_API_ALERT_PERCENT = parsePositiveInt(process.env.EXTERNAL_API_ALERT_PERCENT, 80, 50, 99);

function haversineMeters(lat1, lng1, lat2, lng2) {
  const rad=Math.PI/180, R=6371000;
  const dLat=(lat2-lat1)*rad, dLng=(lng2-lng1)*rad;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function pointInPolygon(lat,lng,points){
  if(!Array.isArray(points)||points.length<3)return false;
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const yi=Number(points[i]?.lat),xi=Number(points[i]?.lng),yj=Number(points[j]?.lat),xj=Number(points[j]?.lng);
    if(![yi,xi,yj,xj].every(Number.isFinite))continue;
    const hit=((yi>lat)!==(yj>lat))&&(lng<(xj-xi)*(lat-yi)/(yj-yi)+xi);
    if(hit)inside=!inside;
  }
  return inside;
}

function validateGpsSample({lat,lng,accuracy,previous=null,nowMs=Date.now()}) {
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180) return {ok:false,error:'Valid latitude and longitude are required'};
  if(Number.isFinite(accuracy) && (accuracy<0||accuracy>RIDER_GPS_MAX_ACCURACY_METERS)) return {ok:false,error:'GPS accuracy is too low for reliable rider positioning'};
  if(previous?.latitude!=null && previous?.longitude!=null && previous?.updated_at){
    const elapsed=Math.max(1,(nowMs-new Date(previous.updated_at).getTime())/1000);
    const distance=haversineMeters(Number(previous.latitude),Number(previous.longitude),lat,lng);
    const speed=distance/elapsed;
    if(Number.isFinite(speed) && speed>RIDER_GPS_MAX_SPEED_MPS) return {ok:false,error:'GPS movement is inconsistent with a realistic rider speed',suspicious:true};
  }
  return {ok:true};
}
const SESSION_TTLS = {
  managerHours: parsePositiveInt(process.env.MANAGER_SESSION_HOURS, 12, 1, 72),
  riderHours: parsePositiveInt(process.env.RIDER_SESSION_HOURS, 168, 1, 720),
  stationHours: parsePositiveInt(process.env.STATION_SESSION_HOURS, 168, 1, 720),
  controlHours: parsePositiveInt(process.env.CONTROL_SESSION_HOURS, 12, 1, 72),
};

// Shared authentication session abstraction. Bearer tokens remain the active transport
// during the migration; cookie transport will use the same server-side session records.
const AUTH_SESSION_DEFINITIONS = Object.freeze({
  manager:  { table: 'manager_sessions', column: 'manager_id', cookie: '__Host-manager_session', ttlHours: () => SESSION_TTLS.managerHours },
  rider:    { table: 'rider_sessions', column: 'rider_id', cookie: '__Host-rider_session', ttlHours: () => SESSION_TTLS.riderHours },
  platform: { table: 'platform_admin_sessions', column: 'admin_id', cookie: '__Host-platform_session', ttlHours: () => SESSION_TTLS.controlHours }
});
function getAuthSessionDefinition(role) {
  const definition = AUTH_SESSION_DEFINITIONS[String(role || '').toLowerCase()];
  if (!definition) throw new Error('Unknown authentication session role');
  return definition;
}
function getCookieValue(req, name) {
  const header = String(req.headers.cookie || '');
  if (!header || !name) return '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}
function getPresentedSessionToken(req, role) {
  const definition = getAuthSessionDefinition(role);
  const authorization = String(req.headers.authorization || '');
  if (authorization.startsWith('Bearer ')) return { token: authorization.slice(7).trim(), source: 'bearer' };
  const cookie = getCookieValue(req, definition.cookie);
  return cookie ? { token: cookie, source: 'cookie' } : null;
}
async function createAuthSession(role, subjectId) {
  const definition = getAuthSessionDefinition(role);
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `insert into ${definition.table}(id,${definition.column},token_hash,expires_at)
     values(gen_random_uuid(),$1,$2,now()+make_interval(hours => $3))`,
    [subjectId, hashSessionToken(token), definition.ttlHours()]
  );
  return token;
}


const allowedCorsOrigins = new Set(
  [FRONTEND_URL, ...(String(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean))]
    .map(v => { try { return new URL(v).origin; } catch { return ''; } })
    .filter(Boolean)
);

app.set('trust proxy', 1);

const rateLimitBuckets = new Map();
function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}
function rateLimit({ windowMs = 60_000, max = 60, keyFn = clientIp, message = 'Too many requests. Please try again later.' } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const key = String(keyFn(req));
    let bucket = rateLimitBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      rateLimitBuckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// Prevent an unbounded in-memory limiter map on a long-running Render instance.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) {
    if (now >= bucket.resetAt) rateLimitBuckets.delete(key);
  }
}, 60_000).unref?.();


const sharedRateLimitFallback = new Map();

async function consumeSharedRateLimit(key, windowMs, max) {
  const now = Date.now();
  const windowStarted = now;
  try {
    const result = await pool.query(`
      insert into security_rate_limit_buckets(key, window_started_ms, count, updated_at)
      values($1,$2,1,now())
      on conflict(key) do update set
        count = case
          when security_rate_limit_buckets.window_started_ms + $3 <= $2 then 1
          else security_rate_limit_buckets.count + 1
        end,
        window_started_ms = case
          when security_rate_limit_buckets.window_started_ms + $3 <= $2 then $2
          else security_rate_limit_buckets.window_started_ms
        end,
        updated_at = now()
      returning count, window_started_ms
    `, [String(key), windowStarted, windowMs]);
    const row = result.rows[0];
    const resetAt = Number(row.window_started_ms) + windowMs;
    return { allowed: Number(row.count) <= max, count: Number(row.count), resetAt };
  } catch (error) {
    // PostgreSQL is the shared source of truth. If it is temporarily unavailable,
    // keep a small per-process emergency limiter rather than disabling protection.
    const fallbackKey = String(key);
    let bucket = sharedRateLimitFallback.get(fallbackKey);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      sharedRateLimitFallback.set(fallbackKey, bucket);
    }
    bucket.count += 1;
    if (sharedRateLimitFallback.size > 10000) {
      for (const [k, v] of sharedRateLimitFallback) if (now >= v.resetAt) sharedRateLimitFallback.delete(k);
    }
    return { allowed: bucket.count <= max, count: bucket.count, resetAt: bucket.resetAt, fallback: true };
  }
}

function sharedRateLimit({ windowMs = 60_000, max = 60, keyFn = clientIp, message = 'Too many requests. Please try again later.' } = {}) {
  return async (req, res, next) => {
    const key = String(keyFn(req));
    const result = await consumeSharedRateLimit(key, windowMs, max);
    const remaining = Math.max(0, max - result.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
    if (!result.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

setInterval(async () => {
  try {
    await pool.query(`delete from security_rate_limit_buckets where updated_at < now() - interval '2 hours'`);
  } catch {}
}, 10 * 60_000).unref?.();

// Global request limiting remains local to avoid a database query on every API request. Sensitive route-specific limits below use shared PostgreSQL state.
const apiRateLimit = rateLimit({
  windowMs: 60_000,
  max: parsePositiveInt(process.env.API_RATE_LIMIT_PER_MINUTE, 180, 60, 600),
  keyFn: req => `${clientIp(req)}:${req.method}:${req.path}`,
});
const authRateLimit = sharedRateLimit({
  windowMs: 10 * 60_000,
  max: parsePositiveInt(process.env.AUTH_RATE_LIMIT_PER_10_MIN, 8, 3, 30),
  keyFn: req => `auth:${clientIp(req)}`,
  message: 'Too many login attempts. Please wait before trying again.',
});
const googleRateLimit = sharedRateLimit({
  windowMs: 10 * 60_000,
  max: parsePositiveInt(process.env.GOOGLE_RATE_LIMIT_PER_10_MIN, 5, 2, 20),
  keyFn: req => `google:${clientIp(req)}`,
  message: 'Too many Google sign-in attempts. Please wait before trying again.',
});
const quoteRateLimit = sharedRateLimit({
  windowMs: 60_000,
  max: parsePositiveInt(process.env.DELIVERY_QUOTE_RATE_LIMIT_PER_MIN, 20, 5, 60),
  keyFn: req => `quote:${clientIp(req)}:${String(req.body?.businessId || '')}`,
  message: 'Too many delivery quote requests. Please wait before requesting another quote.',
});
const quoteBusinessRateLimit = sharedRateLimit({
  windowMs: 60_000,
  max: parsePositiveInt(process.env.DELIVERY_QUOTE_PER_BUSINESS_PER_MIN, 120, 20, 600),
  keyFn: req => `quote-business:${String(req.body?.businessId || '')}`,
  message: 'This restaurant is receiving too many delivery quote requests. Please try again shortly.',
});
const telemetryRateLimit = sharedRateLimit({
  windowMs: 60_000,
  max: parsePositiveInt(process.env.TELEMETRY_RATE_LIMIT_PER_MIN, 20, 5, 120),
  keyFn: req => `telemetry:${clientIp(req)}`,
  message: 'Too many telemetry reports. Please try again shortly.',
});
const smsTestRateLimit = sharedRateLimit({
  windowMs: 10 * 60_000,
  max: parsePositiveInt(process.env.SMS_TEST_RATE_LIMIT_PER_10_MIN, 3, 1, 10),
  keyFn: req => `sms-test:${clientIp(req)}`,
  message: 'Too many SMS test requests. Please wait before trying again.',
});
const stationPairRateLimit = sharedRateLimit({
  windowMs: 10 * 60_000,
  max: 5,
  keyFn: req => `station-pair:${clientIp(req)}`,
  message: 'Too many device-pairing attempts. Please wait and try again.',
});

const corsOptions = {
  origin(origin, callback) {
    // Non-browser clients and same-origin requests do not send Origin.
    if (!origin) return callback(null, true);
    let normalized = '';
    try { normalized = new URL(origin).origin; } catch {}
    if (allowedCorsOrigins.has(normalized)) return callback(null, normalized);
    return callback(null, false);
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Refund-Admin-Key'],
  optionsSuccessStatus: 204,
  maxAge: 600,
};

app.use(cors(corsOptions));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});
app.use('/api', apiRateLimit);
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
// Package entitlements are enforced centrally after JSON parsing and before route handlers.
// Frontend visibility is advisory only; the database-backed plan feature map is authoritative.
app.use('/api', enforcePackageCapabilities);


// Optional advanced module flag. The core ordering system remains usable when disabled.
app.get('/api/features', async (req, res) => {
  const businessId = String(req.query.businessId || '').trim();
  if (!businessId) return res.json({ riderModule: false, features: {} });
  try {
    const result = await pool.query(
      `select b.plan_key, p.features
         from businesses b
         left join platform_packages p on p.key=b.plan_key
        where b.id=$1
        limit 1`,
      [businessId]
    );
    if (!result.rowCount || !result.rows[0].features) return res.json({ riderModule: false, features: {} });
    const features = result.rows[0].features || {};
    return res.json({ riderModule: Boolean(features.riderModule), planKey: result.rows[0].plan_key, features });
  } catch {
    return res.json({ riderModule: false, features: {} });
  }
});
async function getTenantFeatureState(businessId, feature) {
  const id = String(businessId || '').trim();
  const key = String(feature || '').trim();
  if (!id || !key) return { allowed: false, reason: 'MISSING_TENANT' };
  const result = await pool.query(
    `select b.plan_key, p.key as package_key, p.active, coalesce((p.features->>$2)::boolean,false) as enabled
       from businesses b
       left join platform_packages p on p.key=b.plan_key
      where b.id=$1
      limit 1`,
    [id, key]
  );
  if (!result.rowCount) return { allowed: false, reason: 'BUSINESS_NOT_FOUND' };
  const row = result.rows[0];
  return {
    allowed: Boolean(row.active && row.enabled),
    planKey: row.plan_key,
    packageKey: row.package_key,
    feature: key
  };
}

async function requireFeature(feature, businessId) {
  const state = await getTenantFeatureState(businessId, feature);
  if (!state.allowed) {
    const error = new Error(`Feature "${feature}" is not included in this restaurant's package`);
    error.code = 'FEATURE_NOT_INCLUDED';
    error.status = state.reason === 'BUSINESS_NOT_FOUND' ? 404 : 403;
    error.feature = feature;
    error.planKey = state.planKey || null;
    throw error;
  }
  return state;
}

function capabilityForRequest(req) {
  const path = String(req.path || '');
  const method = String(req.method || 'GET').toUpperCase();
  const capabilities = [];

  if (/^\/riders(?:\/|$)/.test(path) || /^\/rider-invites(?:\/|$)/.test(path) || /^\/admin\/riders(?:\/|$)/.test(path)) {
    capabilities.push('riderModule');
  }
  if (/^\/riders\/(?:[^/]+\/)?(?:presence|events|dashboard)/.test(path) ||
      /^\/riders\/[^/]+\/deliveries\/[^/]+\/(?:location|route)/.test(path) ||
      /^\/orders\/[^/]+\/live-location$/.test(path)) {
    capabilities.push('riderTracking');
  }
  if (/^\/orders\/[^/]+\/(?:assign-rider|cancel-rider-assignment|reassign-rider)$/.test(path)) {
    capabilities.push('advancedDelivery','riderModule');
  }
  if (/^\/delivery\/quote(?:$|\/)/.test(path)) {
    capabilities.push('advancedDelivery');
  }
  // quote-v2 and zone quotes are dual-mode: Starter uses restaurant zones,
  // Growth/Pro use the connected Rider Dashboard delivery engine.
  if (/^\/businesses\/[^/]+\/delivery-pricing$/.test(path)) {
    // Delivery pricing is available to every manager. The delivery engine
    // decides whether rules are editable or automatic.
  }
  if (/^\/businesses\/[^/]+\/branches/.test(path)) {
    capabilities.push(method === 'GET' ? 'branchRouting' : 'multiBranch');
  }
  if (/^\/manager\/intelligence(?:\/|$)/.test(path)) {
    capabilities.push('advancedAnalytics');
    if (/^\/manager\/intelligence\/(?:branches|benchmarks)(?:\/|$)/.test(path)) capabilities.push('multiBranch');
  }
  if (/^\/manager\/sms(?:-|\/|$)/.test(path)) {
    capabilities.push('sms');
  }
  if (/^\/manager\/(?:aggregator-integrations|aggregator-orders)/.test(path) ||
      /^\/aggregator\//.test(path)) {
    capabilities.push('apiIntegrations');
  }
  // Restaurant-controlled delivery zones are core ordering functionality.
  if (/^\/manager\/branding$/.test(path) || /^\/control\/businesses\/[^/]+\/branding\/import$/.test(path)) {
    capabilities.push('websiteIntegration');
  }
  if (/^\/platform\/businesses\/[^/]+\/integration/.test(path)) {
    capabilities.push('apiIntegrations');
  }
  if (/^\/platform\/businesses\/[^/]+$/.test(path) && method === 'PATCH' && req.body?.domain !== undefined) {
    capabilities.push('customDomain');
  }
  return [...new Set(capabilities)];
}

async function resolveFeatureTenant(req) {
  const path = String(req.path || '');
  const platformMatch = path.match(/^\/platform\/businesses\/([^/]+)/);
  if (platformMatch) return platformMatch[1];
  const controlMatch = path.match(/^\/control\/businesses\/([^/]+)/);
  if (controlMatch) return controlMatch[1];
  const businessMatch = path.match(/^\/businesses\/([^/]+)/);
  if (businessMatch) return businessMatch[1];
  if (req.body?.businessId) return String(req.body.businessId);
  if (req.query?.businessId) return String(req.query.businessId);

  const riderInviteMatch = path.match(/^\/rider-invites\/([^/]+)/);
  if (riderInviteMatch) {
    const invite = await pool.query(
      'select business_id from rider_invites where token_hash=$1 limit 1',
      [hashSessionToken(String(riderInviteMatch[1]))]
    );
    if (invite.rows[0]?.business_id) return String(invite.rows[0].business_id);
  }

  const orderMatch = path.match(/^\/orders\/([^/]+)/);
  if (orderMatch) {
    const order = await pool.query('select business_id from orders where id=$1 limit 1',[orderMatch[1]]);
    if (order.rows[0]?.business_id) return String(order.rows[0].business_id);
  }

  const manager = await getManagerFromSession(req);
  if (manager?.business_id) return String(manager.business_id);

  const rider = await getRiderFromSession(req);
  if (rider?.business_id) return String(rider.business_id);

  const station = await getStationFromSession(req);
  if (station?.business_id) return String(station.business_id);

  if (/^\/public\/integrations\//.test(path)) {
    const token = String(req.params?.token || '').trim();
    if (token) {
      const integration = await pool.query(
        'select business_id from business_integrations where public_token_hash=$1 and status=\'ACTIVE\' limit 1',
        [hashSessionToken(token)]
      );
      return integration.rows[0]?.business_id ? String(integration.rows[0].business_id) : '';
    }
  }
  return '';
}

async function enforcePackageCapabilities(req, res, next) {
  const capabilities = capabilityForRequest(req);
  if (!capabilities.length) return next();
  try {
    const businessId = await resolveFeatureTenant(req);
    if (!businessId) return res.status(400).json({ error: 'businessId is required for this package-protected feature' });
    for (const feature of capabilities) await requireFeature(feature, businessId);
    return next();
  } catch (error) {
    if (error.code === 'FEATURE_NOT_INCLUDED') {
      return res.status(error.status || 403).json({
        error: error.message,
        code: error.code,
        feature: error.feature,
        planKey: error.planKey
      });
    }
    return res.status(500).json({ error: 'Unable to verify package capability' });
  }
}

async function requireRiderModule(req, res, next) {
  const businessId = await resolveFeatureTenant(req);
  if (!businessId) return res.status(400).json({ error: 'businessId is required for rider operations' });
  try {
    await requireFeature('riderModule', businessId);
    next();
  } catch (error) {
    if (error.code === 'FEATURE_NOT_INCLUDED') return res.status(error.status || 403).json({ error: error.message, code: error.code, feature: error.feature, planKey: error.planKey });
    res.status(500).json({ error: 'Unable to verify rider package capability' });
  }
}

app.use('/api/riders', (req,res,next)=>{
  // Login must reach the credential check itself. The login handler validates
  // the business, rider status and password before issuing a session.
  if(req.path==='/login' && req.method==='POST') return next();
  return requireRiderModule(req,res,next);
});

// Server-Sent Events: one persistent connection replaces the dashboard's 5-second polling.
const realtimeClients = new Set();
const stationRealtimeClients = new Set();
const realtimeBusInstanceId = crypto.randomUUID();
let realtimeBusClient = null;
function sendRealtime(client,event,data){
  try{client.res.write(`event: ${event}\\ndata: ${JSON.stringify(data)}\\n\\n`)}catch{}
}
function sendLocalRealtime(message){
  const businessId=String(message.businessId||''),orderId=message.orderId?String(message.orderId):null,riderId=message.riderId?String(message.riderId):null;
  for(const client of realtimeClients){
    if(client.businessId!==businessId)continue;
    if(client.orderId&&orderId&&client.orderId!==orderId)continue;
    if(client.orderId&&!orderId)continue;
    if(client.riderId&&riderId&&client.riderId!==riderId)continue;
    if(client.riderId&&!riderId)continue;
    sendRealtime(client,message.event,message.data);
  }
  for(const client of stationRealtimeClients){
    if(client.businessId!==businessId)continue;
    sendRealtime(client,message.event,message.data);
  }
}
async function publishRealtimeBus(message){
  if(!realtimeBusClient)return;
  try{await realtimeBusClient.query('select pg_notify($1,$2)',['restaurant_realtime',JSON.stringify({instanceId:realtimeBusInstanceId,message})])}catch{}
}
function broadcastRealtime({businessId,orderId=null,riderId=null,event='order.updated',data={}}){
  const message={businessId:String(businessId),orderId,riderId,event,data};
  sendLocalRealtime(message);
  void publishRealtimeBus(message);
}
async function startRealtimeBus(){
  try{
    const client=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:false});
    await client.connect();
    await client.query('listen restaurant_realtime');
    client.on('notification',notification=>{
      try{
        const payload=JSON.parse(notification.payload||'{}');
        if(payload.instanceId===realtimeBusInstanceId)return;
        sendLocalRealtime(payload.message||{});
      }catch{}
    });
    client.on('error',()=>{});
    realtimeBusClient=client;
  }catch(error){console.error('Realtime shared bus unavailable; local realtime only:',error.message)}
}

function broadcastRider({ businessId, riderId, orderId = null, action, data = {} }) {
  broadcastRealtime({businessId,riderId,orderId,event:'rider.updated',data:{riderId,action,...data}});
}
function broadcastOrder(order, extra = {}) {
  if (!order) return;
  broadcastRealtime({
    businessId: order.business_id,
    orderId: order.id,
    event: 'order.updated',
    data: { orderId: order.id, status: order.status, paymentStatus: order.payment_status, ...extra }
  });
}

function requirePaystackKey() {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new Error('PAYSTACK_SECRET_KEY is not configured');
  return process.env.PAYSTACK_SECRET_KEY;
}
function requireRefundAdmin(req, res) {
  const configured = process.env.REFUND_ADMIN_KEY;
  const supplied = req.headers['x-refund-admin-key'];
  if (!configured || !supplied || supplied !== configured) { res.status(401).json({ error: 'Refund authorization required' }); return false; }
  return true;
}
async function paystackRequest(path, options = {}) {
  const response = await fetch(PAYSTACK_API + path, { ...options, headers: { Authorization: `Bearer ${requirePaystackKey()}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.status) throw new Error(data.message || `Paystack request failed (${response.status})`);
  return data;
}
function normalizeKenyanPhone(phone) {
  const value = String(phone || '').replace(/[\s()-]/g, '');
  if (/^\+254\d{9}$/.test(value)) return value;
  if (/^254\d{9}$/.test(value)) return `+${value}`;
  if (/^0\d{9}$/.test(value)) return `+254${value.slice(1)}`;
  throw new Error('Enter a valid Kenyan phone number');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { hash: `${salt}:${hash}`, salt };
}
function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function createCustomerOrderToken(orderId = null) {
  if (orderId) {
    const secret = process.env.CUSTOMER_ORDER_TOKEN_SECRET || process.env.PAYSTACK_SECRET_KEY || process.env.DATABASE_URL || 'restaurant-ordering-order-token-secret';
    const token = crypto.createHmac('sha256', secret).update(String(orderId)).digest('hex');
    return { token, hash: hashSessionToken(token) };
  }
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashSessionToken(token) };
}
function stableSerialize(value) {
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableSerialize(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
function hashOrderRequest(value) {
  return crypto.createHash('sha256').update(stableSerialize(value)).digest('hex');
}
async function getCustomerOrderAccess(req) {
  const auth = String(req.headers.authorization || '');
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const queryToken = String(req.query.orderToken || '').trim();
  const token = bearer || queryToken;
  if (!token) return null;
  const hash = hashSessionToken(token);
  const result = await pool.query(
    'select o.*,c.phone as customer_phone,c.email as customer_email from orders o join customers c on c.id=o.customer_id where o.id=$1 and o.customer_access_token_hash=$2 limit 1',
    [req.params.id, hash]
  );
  return result.rows[0] || null;
}
async function requireCustomerOrder(req,res,next) {
  try {
    const order = await getCustomerOrderAccess(req);
    if (!order) return res.status(401).json({error:'Order access authorization required'});
    req.customerOrder = order;
    next();
  } catch {
    res.status(500).json({error:'Unable to verify order access'});
  }
}
async function requireCustomerOrderBody(req,res,next) {
  try {
    const id=String(req.body?.orderId||'').trim();
    const token=String(req.headers.authorization||'').startsWith('Bearer ')
      ? String(req.headers.authorization).slice(7).trim()
      : String(req.body?.orderToken||'').trim();
    if(!id||!token) return res.status(401).json({error:'Order access authorization required'});
    const result=await pool.query(
      'select o.*,c.phone as customer_phone,c.email as customer_email from orders o join customers c on c.id=o.customer_id where o.id=$1 and o.customer_access_token_hash=$2 limit 1',
      [id,hashSessionToken(token)]
    );
    if(!result.rowCount)return res.status(401).json({error:'Order access authorization required'});
    req.customerOrder=result.rows[0];
    next();
  }catch{res.status(500).json({error:'Unable to verify order access'});}
}
async function ensureSharedSecuritySchema() {
  await pool.query(`
    create table if not exists security_rate_limit_buckets (
      key text primary key,
      window_started_ms bigint not null,
      count integer not null default 0,
      updated_at timestamptz not null default now()
    );
    create index if not exists security_rate_limit_buckets_updated_idx
      on security_rate_limit_buckets(updated_at);
  `);
}

async function ensureRealtimeAndExternalApiSecuritySchema() {
  await pool.query(`
    create table if not exists realtime_access_tokens (
      token_hash text primary key,
      scope text not null check (scope in ('CUSTOMER_ORDER','MANAGER','RIDER','STATION')),
      business_id uuid not null references businesses(id) on delete cascade,
      order_id uuid references orders(id) on delete cascade,
      rider_id uuid references riders(id) on delete cascade,
      station_id uuid references restaurant_order_stations(id) on delete cascade,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    );
    create index if not exists realtime_access_tokens_expiry_idx on realtime_access_tokens(expires_at);
    create index if not exists realtime_access_tokens_scope_idx on realtime_access_tokens(scope,business_id,expires_at);
    create table if not exists external_api_usage_buckets (
      business_id uuid not null references businesses(id) on delete cascade,
      provider text not null,
      operation text not null,
      period_type text not null check (period_type in ('DAILY','MONTHLY')),
      period_key text not null,
      request_count integer not null default 0,
      updated_at timestamptz not null default now(),
      primary key (business_id,provider,operation,period_type,period_key)
    );
    create index if not exists external_api_usage_buckets_updated_idx on external_api_usage_buckets(updated_at);
    create table if not exists external_api_usage_alerts (
      id uuid primary key default gen_random_uuid(),
      business_id uuid not null references businesses(id) on delete cascade,
      provider text not null,
      operation text not null,
      period_type text not null,
      period_key text not null,
      threshold_percent integer not null,
      request_count integer not null,
      quota integer not null,
      created_at timestamptz not null default now(),
      unique(business_id,provider,operation,period_type,period_key,threshold_percent)
    );
    create index if not exists external_api_usage_alerts_business_idx on external_api_usage_alerts(business_id,created_at desc);
  `);
}
async function issueTelemetryAccessToken({scope,businessId=null}){
  const token=crypto.randomBytes(32).toString('hex');
  await pool.query(`insert into telemetry_access_tokens(token_hash,scope,business_id,expires_at)
    values($1,$2,$3,now()+interval '10 minutes')`,[hashSessionToken(token),scope,businessId]);
  return token;
}
async function getTelemetryAccessToken(token){
  if(!token)return null;
  const r=await pool.query('select * from telemetry_access_tokens where token_hash=$1 and expires_at>now() limit 1',[hashSessionToken(token)]);
  return r.rows[0]||null;
}

async function issueRealtimeAccessToken({scope,businessId,orderId=null,riderId=null,stationId=null}) {
  const token=crypto.randomBytes(32).toString('hex');
  await pool.query(`insert into realtime_access_tokens(token_hash,scope,business_id,order_id,rider_id,station_id,expires_at)
    values($1,$2,$3,$4,$5,$6,now()+make_interval(secs=>$7))`,[hashSessionToken(token),scope,businessId,orderId,riderId,stationId,REALTIME_TOKEN_TTL_SECONDS]);
  return token;
}
async function getRealtimeAccessToken(token) {
  if(!token)return null;
  const r=await pool.query('select * from realtime_access_tokens where token_hash=$1 and expires_at>now() limit 1',[hashSessionToken(token)]);
  return r.rows[0]||null;
}
async function consumeExternalApiQuota({businessId,provider,operation,dailyQuota,monthlyQuota,units=1}) {
  if(!businessId)return {allowed:true};
  const now=new Date(),dayKey=now.toISOString().slice(0,10),monthKey=now.toISOString().slice(0,7),client=await pool.connect();
  try{
    await client.query('begin'); const rows=[];
    for(const [periodType,periodKey,quota] of [['DAILY',dayKey,dailyQuota],['MONTHLY',monthKey,monthlyQuota]]){
      const q=await client.query(`insert into external_api_usage_buckets(business_id,provider,operation,period_type,period_key,request_count,updated_at)
        values($1,$2,$3,$4,$5,$6,now()) on conflict(business_id,provider,operation,period_type,period_key)
        do update set request_count=external_api_usage_buckets.request_count+$6,updated_at=now() returning request_count`,[businessId,provider,operation,periodType,periodKey,units]);
      rows.push({periodType,periodKey,quota,count:Number(q.rows[0].request_count)});
    }
    const blocked=rows.some(x=>x.count>x.quota);
    for(const row of rows)for(const threshold of [EXTERNAL_API_ALERT_PERCENT,90]){
      if(row.count>=Math.ceil(row.quota*threshold/100))await client.query(`insert into external_api_usage_alerts(business_id,provider,operation,period_type,period_key,threshold_percent,request_count,quota)
        values($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing`,[businessId,provider,operation,row.periodType,row.periodKey,threshold,row.count,row.quota]);
    }
    await client.query('commit'); return {allowed:!blocked,dailyCount:rows[0].count,dailyQuota,monthlyCount:rows[1].count,monthlyQuota};
  }catch(e){try{await client.query('rollback')}catch{}throw e}finally{client.release()}
}
async function guardExternalApiQuota(args){
  const result=await consumeExternalApiQuota(args);
  if(!result.allowed){const e=new Error(`External ${args.provider} usage quota reached for this restaurant. The integration is temporarily paused until the quota window resets.`);e.status=429;e.code='EXTERNAL_API_QUOTA_EXCEEDED';e.quota=result;throw e}
  return result;
}

async function ensurePhaseASchema(){
  await pool.query(`
    alter table payments add column if not exists idempotency_key text;
    alter table payments add column if not exists authorization_url text;
    alter table payments add column if not exists payment_mode text;
    create unique index if not exists payments_idempotency_key_idx on payments(idempotency_key) where idempotency_key is not null;
    create table if not exists paystack_webhook_events (
      id uuid primary key default gen_random_uuid(),
      event_id text,
      event_type text not null,
      resource_id text,
      payload jsonb not null,
      received_at timestamptz not null default now(),
      processed_at timestamptz,
      unique(event_type,resource_id)
    );
    create index if not exists paystack_webhook_events_received_idx on paystack_webhook_events(received_at desc);
    create table if not exists outbox_events (
      id uuid primary key default gen_random_uuid(),
      event_type text not null,
      aggregate_type text,
      aggregate_id uuid,
      business_id uuid references businesses(id) on delete cascade,
      payload jsonb not null default '{}'::jsonb,
      status text not null default 'PENDING',
      attempts integer not null default 0,
      available_at timestamptz not null default now(),
      processed_at timestamptz,
      last_error text,
      created_at timestamptz not null default now()
    );
    create index if not exists outbox_events_pending_idx on outbox_events(status,available_at,created_at);
    do $$
    begin
      if not exists(select 1 from pg_constraint where conname='payments_amount_nonnegative') then
        alter table payments add constraint payments_amount_nonnegative check (amount >= 0) not valid;
      end if;
      if not exists(select 1 from pg_constraint where conname='refunds_amount_nonnegative') then
        alter table refunds add constraint refunds_amount_nonnegative check (amount > 0) not valid;
      end if;
    end $$;
  `);
}

async function ensurePhaseFSchema(){
  const fs = await import('node:fs/promises');
  const sql = await fs.readFile(new URL('./migrations/003_phase_f_customer_growth.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

async function ensurePhaseGSchema(){
  const fs = await import('node:fs/promises');
  const sql = await fs.readFile(new URL('./migrations/004_phase_g_advanced_operations.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

async function ensurePhaseISchema(){
  const fs = await import('node:fs/promises');
  const sql = await fs.readFile(new URL('./migrations/006_phase_i_transaction_integrity.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

async function ensurePhaseJSchema(){
  const fs = await import('node:fs/promises');
  const sql = await fs.readFile(new URL('./migrations/007_phase_j_order_delivery_integrity.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

async function ensurePhaseKSchema(){
  const fs = await import('node:fs/promises');
  const sql = await fs.readFile(new URL('./migrations/008_phase_k_tenant_authorization_lockdown.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

async function ensurePhaseHSchema(){
  const fs = await import('node:fs/promises');
  const sql = await fs.readFile(new URL('./migrations/005_phase_h_intelligence.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

async function ensurePhaseBSchema(){
  const fs = await import('node:fs/promises');
  const sql = await fs.readFile(new URL('./migrations/002_phase_b_restaurant_core.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

async function ensureMenuOptionsSchema() {
  // Older databases may have an incorrectly typed products.options UUID column.
  // Menu variables are structured JSON and must be stored as jsonb.
  const typeCheck=await pool.query(`
    select data_type, udt_name
    from information_schema.columns
    where table_schema='public' and table_name='products' and column_name='options'
    limit 1
  `);
  if(typeCheck.rowCount && typeCheck.rows[0].udt_name !== 'jsonb'){
    await pool.query(`
      alter table products
      alter column options type jsonb
      using '[]'::jsonb
    `);
  }else{
    await pool.query(`
      alter table products add column if not exists options jsonb not null default '[]'::jsonb
    `);
  }
}

async function ensurePhase1SecuritySchema() {
  await pool.query(`
    alter table orders add column if not exists customer_access_token_hash text;
    create unique index if not exists orders_customer_access_token_idx
      on orders(customer_access_token_hash)
      where customer_access_token_hash is not null;
    alter table refunds add column if not exists idempotency_key text;
    create unique index if not exists refunds_idempotency_key_idx
      on refunds(idempotency_key)
      where idempotency_key is not null;
  `);
}

async function ensurePackageArchitectureSchema() {
  await pool.query(`
    alter table businesses add column if not exists plan_key text;
    update businesses
       set plan_key = case
         when upper(coalesce(package_type,''))='ADVANCED' then 'GROWTH'
         else coalesce(nullif(upper(plan_key),''),'STARTER')
       end
     where plan_key is null or trim(plan_key)='';
    alter table businesses alter column plan_key set default 'STARTER';
    alter table businesses alter column plan_key set not null;

    insert into platform_packages(key,name,description,monthly_price_kes,features)
    values
      ('STARTER','Starter','Core online ordering',0,'{}'::jsonb),
      ('GROWTH','Growth','Ordering plus delivery operations',3500,'{}'::jsonb),
      ('PRO','Pro','Full restaurant operations platform',7500,'{}'::jsonb)
    on conflict(key) do nothing;

    update platform_packages set features='{"ordering":true,"digitalOrdering":true,"tenantIsolation":true,"websiteIntegration":true,"auditTrail":true}'::jsonb,updated_at=now() where key='STARTER';
    update platform_packages set features='{"ordering":true,"digitalOrdering":true,"advancedDelivery":true,"branchRouting":true,"riderModule":true,"riderTracking":true,"sms":true,"advancedAnalytics":true,"customDomain":true,"apiIntegrations":true,"auditTrail":true,"tenantIsolation":true,"websiteIntegration":true}'::jsonb,updated_at=now() where key='GROWTH';
    update platform_packages set features='{"ordering":true,"digitalOrdering":true,"advancedDelivery":true,"branchRouting":true,"riderModule":true,"riderTracking":true,"sms":true,"advancedAnalytics":true,"customDomain":true,"apiIntegrations":true,"auditTrail":true,"tenantIsolation":true,"websiteIntegration":true,"multiBranch":true,"prioritySupport":true,"automation":true}'::jsonb,updated_at=now() where key='PRO';
  `);
}

async function ensurePhase3SecuritySchema() {
  await pool.query(`
    alter table manager_users add column if not exists role text not null default 'MANAGER';
    alter table platform_admin_users add column if not exists role text not null default 'PLATFORM_OWNER';
    update manager_users set role=upper(coalesce(role,'MANAGER'));
    update platform_admin_users set role=upper(coalesce(role,'PLATFORM_OWNER'));

    create unique index if not exists customers_business_id_id_uidx on customers(business_id,id);
    create unique index if not exists products_business_id_id_uidx on products(business_id,id);
    create unique index if not exists orders_business_id_id_uidx on orders(business_id,id);
  `);

  const constraints = await pool.query(
    `select conname from pg_constraint where conname = any($1::text[])`,
    [[
      'manager_users_role_check',
      'platform_admin_users_role_check',
      'orders_customer_tenant_fk',
      'products_price_nonnegative',
      'orders_amounts_nonnegative',
      'order_items_amount_nonnegative'
    ]]
  );
  const existing = new Set(constraints.rows.map(row => row.conname));

  if (!existing.has('manager_users_role_check')) {
    await pool.query(`alter table manager_users add constraint manager_users_role_check
      check (role in ('OWNER','MANAGER')) not valid`);
  }
  if (!existing.has('platform_admin_users_role_check')) {
    await pool.query(`alter table platform_admin_users add constraint platform_admin_users_role_check
      check (role in ('PLATFORM_OWNER','SUPPORT')) not valid`);
  }
  if (!existing.has('orders_customer_tenant_fk')) {
    await pool.query(`alter table orders add constraint orders_customer_tenant_fk
      foreign key (business_id,customer_id) references customers(business_id,id) not valid`);
  }
  if (!existing.has('products_price_nonnegative')) {
    await pool.query(`alter table products add constraint products_price_nonnegative
      check (price >= 0) not valid`);
  }
  if (!existing.has('orders_amounts_nonnegative')) {
    await pool.query(`alter table orders add constraint orders_amounts_nonnegative
      check (subtotal >= 0 and total >= 0 and delivery_fee >= 0 and coalesce(food_subtotal,0) >= 0) not valid`);
  }
  if (!existing.has('order_items_amount_nonnegative')) {
    await pool.query(`alter table order_items add constraint order_items_amount_nonnegative
      check (unit_price >= 0) not valid`);
  }
}

async function ensureSmsSchema() {
  await pool.query(`
    create table if not exists business_sms_settings (
      business_id uuid primary key references businesses(id) on delete cascade,
      sender_id text,
      assignment_template text not null default 'You have a new delivery assignment from {restaurant}. Order {order}. Open your Rider Dashboard to view and accept it.',
      enabled boolean not null default true,
      updated_at timestamptz not null default now()
    );
    create index if not exists business_sms_settings_enabled_idx on business_sms_settings(business_id,enabled);
    create table if not exists sms_message_log (
      id uuid primary key,
      business_id uuid not null references businesses(id) on delete cascade,
      rider_id uuid references riders(id) on delete set null,
      order_id uuid references orders(id) on delete set null,
      recipient text not null,
      sender_id text,
      message text not null,
      purpose text not null default 'ASSIGNMENT',
      environment text not null default 'production',
      status text not null default 'PENDING',
      provider_status text,
      provider_message_id text,
      provider_cost text,
      error_message text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists sms_message_log_business_idx on sms_message_log(business_id,created_at desc);
    create index if not exists sms_message_log_rider_idx on sms_message_log(rider_id,created_at desc);
  `);
}

async function ensureDeliveryTrackingSchema() {
  await pool.query(`
    alter table rider_presence add column if not exists latitude numeric(10,7);
    alter table rider_presence add column if not exists longitude numeric(10,7);
    alter table rider_presence add column if not exists accuracy_meters numeric(10,2);
    alter table rider_presence add column if not exists location_updated_at timestamptz;
    create table if not exists rider_live_locations (
      rider_id uuid primary key references riders(id) on delete cascade,
      trip_id uuid not null unique references rider_trips(id) on delete cascade,
      order_id uuid not null references orders(id) on delete cascade,
      latitude numeric(10,7) not null,
      longitude numeric(10,7) not null,
      accuracy_meters numeric(10,2),
      heading numeric(7,2),
      speed_mps numeric(10,2),
      updated_at timestamptz not null default now()
    );
    create index if not exists rider_live_locations_order_idx on rider_live_locations(order_id,updated_at desc);
  `);
}

function smsEnvironment() {
  return String(process.env.AFRICASTALKING_ENVIRONMENT || 'production').toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
}
function smsApiBase() {
  return smsEnvironment() === 'sandbox'
    ? 'https://api.sandbox.africastalking.com'
    : 'https://api.africastalking.com';
}
function requireSmsConfig() {
  const environment=smsEnvironment();
  const username=String(process.env.AFRICASTALKING_USERNAME || '').trim();
  const apiKey=String(process.env.AFRICASTALKING_API_KEY || '').trim();
  const defaultSender=String(process.env.AFRICASTALKING_SENDER_ID || '').trim();
  if(!username || !apiKey) throw new Error('Africa\'s Talking SMS is not configured on the server');
  if(environment==='sandbox' && username.toLowerCase()!=='sandbox') {
    throw new Error('Sandbox mode requires AFRICASTALKING_USERNAME=sandbox and a Sandbox API key');
  }
  return {username,apiKey,defaultSender,environment};
}
function normalizeSenderId(value) {
  const sender=String(value||'').trim();
  if(!sender)return '';
  if(sender.length>11 || /\s/.test(sender)) throw new Error('Sender ID must be 11 characters or fewer and cannot contain spaces');
  if(!/^[A-Za-z0-9_-]+$/.test(sender)) throw new Error('Sender ID may only contain letters, numbers, hyphens or underscores');
  return sender;
}
function renderSmsTemplate(template, vars={}) {
  return String(template||'').replace(/\{\s*(restaurant|order|rider|dashboard)\s*\}/gi,(_,key)=>String(vars[String(key).toLowerCase()]||'')).trim();
}
async function getBusinessSmsSettings(businessId) {
  await ensureSmsSchema();
  const r=await pool.query(`select b.name,coalesce(s.sender_id,'') as sender_id,
      coalesce(s.assignment_template,'You have a new delivery assignment from {restaurant}. Order {order}. Open your Rider Dashboard to view and accept it.') as assignment_template,
      coalesce(s.enabled,true) as enabled
    from businesses b
    left join business_sms_settings s on s.business_id=b.id
    where b.id=$1 limit 1`,[businessId]);
  if(!r.rowCount) throw new Error('Restaurant not found');
  return r.rows[0];
}
async function consumeSmsBudget(key, windowMs, max) {
  const result = await consumeSharedRateLimit(`sms-spend:${key}`, windowMs, max);
  return result.allowed;
}

async function sendSms({businessId,to,message,senderId=null,riderId=null,orderId=null,purpose='ASSIGNMENT'}) {
  const config=requireSmsConfig();
  const recipient=normalizeKenyanPhone(to);
  // Protect the paid provider from accidental retry loops and repeated assignment spam.
  await guardExternalApiQuota({businessId,provider:'AFRICASTALKING',operation:'SMS',dailyQuota:EXTERNAL_API_DAILY_SMS_QUOTA,monthlyQuota:EXTERNAL_API_MONTHLY_SMS_QUOTA});
   const recipientBudget = await consumeSmsBudget(`recipient:${recipient}`, 10*60_000, parsePositiveInt(process.env.SMS_MAX_PER_RECIPIENT_PER_10_MIN, 3, 1, 10));
  const businessBudget = await consumeSmsBudget(`business:${businessId}`, 10*60_000, parsePositiveInt(process.env.SMS_MAX_PER_BUSINESS_PER_10_MIN, 30, 5, 200));
  if(!recipientBudget || !businessBudget) throw new Error('SMS sending is temporarily rate limited for this recipient or restaurant');
  const settings=await getBusinessSmsSettings(businessId);

  // Sandbox deliberately omits the Sender ID. Production requires a Sender ID
  // that Africa's Talking has approved for this account.
  let sender='';
  if(config.environment!=='sandbox') {
    sender=normalizeSenderId(senderId || settings.sender_id || config.defaultSender);
    if(!sender) throw new Error('No SMS Sender ID is configured for this restaurant');
  }

  const logId=crypto.randomUUID();
  const bodyMessage=String(message).slice(0,918);
  await pool.query(`insert into sms_message_log
    (id,business_id,rider_id,order_id,recipient,sender_id,message,purpose,environment,status)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING')`,
    [logId,businessId,riderId||null,orderId||null,recipient,sender||null,bodyMessage,String(purpose||'ASSIGNMENT').toUpperCase(),config.environment]);

  try {
    const body=new URLSearchParams({
      username:config.username,
      to:recipient,
      message:bodyMessage,
      ...(sender?{from:sender}:{}),
    });
    const response=await fetch(smsApiBase()+'/version1/messaging',{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','apiKey':config.apiKey,'Accept':'application/json'},
      body:body.toString()
    });
    const data=await response.json().catch(()=>({}));
    const recipientResult=data?.SMSMessageData?.Recipients?.[0];
    if(!response.ok || !recipientResult || String(recipientResult.statusCode)!=='101') {
      const rawError=recipientResult?.status || data?.SMSMessageData?.Message || data?.message || `SMS provider request failed (${response.status})`;
      const errorMessage=/InvalidSenderId/i.test(String(rawError))
        ? `Africa's Talking rejected the Sender ID "${sender}". It must be an approved Sender ID for this SMS account.`
        : String(rawError);
      await pool.query('update sms_message_log set status=$1,error_message=$2,updated_at=now() where id=$3',['FAILED',errorMessage,logId]);
      throw new Error(errorMessage);
    }
    await pool.query(`update sms_message_log set status='ACCEPTED',provider_status=$1,provider_message_id=$2,provider_cost=$3,updated_at=now() where id=$4`,
      [recipientResult.status||'Success',recipientResult.messageId||null,recipientResult.cost||null,logId]);
    return {
      logId,
      recipient:recipientResult.number || recipient,
      status:recipientResult.status || 'Success',
      statusCode:recipientResult.statusCode,
      messageId:recipientResult.messageId||null,
      cost:recipientResult.cost||null,
      environment:config.environment,
      senderId:sender || null
    };
  } catch(error) {
    try {
      await pool.query('update sms_message_log set status=case when status=\'PENDING\' then \'FAILED\' else status end,error_message=coalesce(error_message,$1),updated_at=now() where id=$2',[String(error.message||'SMS send failed'),logId]);
    } catch {}
    throw error;
  }
}
async function sendRiderAssignmentSms({businessId,riderId,orderId}) {
  const riderResult=await pool.query('select r.name,r.phone,o.order_number,b.name as restaurant_name from riders r join orders o on o.id=$2 and o.business_id=$1 join businesses b on b.id=$1 where r.id=$3 and r.business_id=$1 limit 1',[businessId,orderId,riderId]);
  if(!riderResult.rowCount)return null;
  const rider=riderResult.rows[0];
  if(!rider.phone)return null;
  const settings=await getBusinessSmsSettings(businessId);
  if(!settings.enabled)return {skipped:true,reason:'disabled'};
  const dashboard=`${FRONTEND_URL.replace(/\/$/,'')}/rider.html?businessId=${encodeURIComponent(businessId)}`;
  const message=renderSmsTemplate(settings.assignment_template,{
    restaurant:rider.restaurant_name,
    order:rider.order_number,
    rider:rider.name,
    dashboard
  });
  return sendSms({businessId,to:rider.phone,message,riderId,purpose:'ASSIGNMENT'});
}

async function ensureIntegrationSchema() {
  await pool.query(`
    create table if not exists business_integrations (
      id uuid primary key,
      business_id uuid not null unique references businesses(id) on delete cascade,
      integration_type text not null check (integration_type in ('ORDER_BUTTON','EMBEDDED_MENU','FULL_ORDERING_PAGE','FULL_ORDERING_SUBDOMAIN')),
      status text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED')),
      public_token_hash text not null unique,
      generated_at timestamptz not null default now(),
      revoked_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists business_integrations_business_idx on business_integrations(business_id,status);
  `);
}

function hashManagerPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return `scrypt$131072$8$1${salt}:${derived.toString('hex')}`;
}
function verifyManagerPassword(password, stored) {
  const match = String(stored || '').match(/^scrypt\$(\d+)\$(\d+)\$(\d+)\$([^:]+):([0-9a-f]+)$/i);
  if (!match) return false;
  const [, n, r, p, salt, expected] = match;
  try {
    const actual = crypto.scryptSync(String(password), salt, expected.length / 2, { N: Number(n), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 }).toString('hex');
    return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}
async function getControlAdminFromSession(req){
  const presented=getPresentedSessionToken(req,'platform');
  const token=presented?.token||'';
  if(!token)return null;
  const r=await pool.query(`select a.*,s.id as session_id,s.expires_at from platform_admin_sessions s join platform_admin_users a on a.id=s.admin_id where s.token_hash=$1 and s.expires_at>now() and a.active=true`,[hashSessionToken(token)]);
  return r.rows[0]||null;
}
async function requireControl(req,res,next){
  try{
    const admin=await getControlAdminFromSession(req);
    if(!admin)return res.status(401).json({error:'Platform control login required'});
    if(!['PLATFORM_OWNER','SUPPORT'].includes(String(admin.role||'').toUpperCase())) return res.status(403).json({error:'Platform control role is not permitted'});
    req.controlAdmin=admin;
    req.platformAdmin=admin;
    next();
  }catch(e){res.status(500).json({error:'Unable to verify control session'});}
}
async function getManagerFromSession(req) {
  const presented = getPresentedSessionToken(req, 'manager');
  const token = presented?.token || '';
  if (!token) return null;
  const result = await pool.query(`select m.*,s.id as session_id,s.expires_at
    from manager_sessions s join manager_users m on m.id=s.manager_id
    where s.token_hash=$1 and s.expires_at>now() and m.active=true`, [hashSessionToken(token)]);
  return result.rows[0] || null;
}
async function requireManager(req, res, next) {
  try {
    const manager = await getManagerFromSession(req);
    if (!manager) return res.status(401).json({ error: 'Manager login required' });
    const requestedBusinessId = String(req.body?.businessId || req.query?.businessId || req.params?.businessId || '');
    if (requestedBusinessId && requestedBusinessId !== String(manager.business_id)) {
      return res.status(403).json({ error: 'You can only access your own restaurant' });
    }
    // Tenant-scoped management endpoints under /api/businesses/:id must bind
    // the URL tenant directly to the authenticated manager session. Never trust
    // the URL tenant merely because the manager is otherwise authenticated.
    if (req.params?.id && req.path.startsWith('/businesses/')) {
      if (String(req.params.id) !== String(manager.business_id)) {
        return res.status(403).json({ error: 'You can only access your own restaurant' });
      }
    }
    req.manager = manager;
    next();
  } catch { res.status(500).json({ error: 'Unable to verify manager session' }); }
}

function requireManagerRole(...allowedRoles) {
  const roles = new Set(allowedRoles.map(role => String(role).toUpperCase()));
  return (req, res, next) => {
    const role = String(req.manager?.role || '').toUpperCase();
    if (!roles.has(role)) return res.status(403).json({ error: 'This manager role is not permitted to perform this action' });
    next();
  };
}
async function requireManagerOrder(req, res, next) {
  return requireManager(req, res, async () => {
    try {
      const result = await pool.query('select business_id from orders where id=$1', [req.params.id]);
      if (!result.rowCount) return res.status(404).json({ error: 'Order not found' });
      if (String(result.rows[0].business_id) !== String(req.manager.business_id)) return res.status(403).json({ error: 'You can only access your own restaurant' });
      next();
    } catch { res.status(500).json({ error: 'Unable to verify order access' }); }
  });
}
async function requireManagerStation(req, res, next) {
  return requireManager(req, res, async () => {
    try {
      const result = await pool.query('select business_id from restaurant_order_stations where id=$1', [req.params.id]);
      if (!result.rowCount) return res.status(404).json({ error: 'Station not found' });
      if (String(result.rows[0].business_id) !== String(req.manager.business_id)) return res.status(403).json({ error: 'You can only access your own restaurant' });
      next();
    } catch { res.status(500).json({ error: 'Unable to verify station access' }); }
  });
}
async function getStationFromSession(req) {
  const raw = String(req.headers.authorization || '');
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
  if (!token) return null;
  const result = await pool.query(`select s.*,st.name,st.device_type,st.mode,st.business_id,st.active
    from station_sessions s join restaurant_order_stations st on st.id=s.station_id
    where s.token_hash=$1 and s.expires_at>now() and st.active=true`, [hashSessionToken(token)]);
  return result.rows[0] || null;
}
async function requireStation(req, res, next) {
  try {
    const station = await getStationFromSession(req);
    if (!station) return res.status(401).json({ error: 'Station pairing required' });
    const requestedBusinessId = String(req.body?.businessId || req.query?.businessId || req.params?.businessId || '');
    if (requestedBusinessId && requestedBusinessId !== String(station.business_id)) {
      return res.status(403).json({ error: 'You can only access your own restaurant station' });
    }
    req.station = station;
    next();
  } catch { res.status(500).json({ error: 'Unable to verify station session' }); }
}

async function getRiderFromSession(req) {
  const presented = getPresentedSessionToken(req, 'rider');
  const token = presented?.token || '';
  if (!token) return null;
  const result = await pool.query(`select r.*,s.id as session_id,s.expires_at from rider_sessions s join riders r on r.id=s.rider_id where s.token_hash=$1 and s.expires_at>now() and r.active=true and r.rider_status='ACTIVE'`, [hashSessionToken(token)]);
  return result.rows[0] || null;
}
async function requireRiderAuth(req, res, next) {
  try {
    const rider = await getRiderFromSession(req);
    if (!rider) return res.status(401).json({ error: 'Rider login required' });
    if (req.params?.id && String(req.params.id) !== String(rider.id)) return res.status(403).json({ error: 'You can only access your own rider account' });
    const requestedBusinessId = String(req.body?.businessId || req.query?.businessId || req.params?.businessId || '');
    if (requestedBusinessId && requestedBusinessId !== String(rider.business_id)) {
      return res.status(403).json({ error: 'You can only access your own restaurant rider resources' });
    }
    req.rider = rider;
    next();
  } catch { res.status(500).json({ error: 'Unable to verify rider session' }); }
}
async function computeGoogleRoute(origin, destination, businessId=null) {
  if (!process.env.GOOGLE_MAPS_API_KEY) throw new Error('GOOGLE_MAPS_API_KEY is not configured');
  await guardExternalApiQuota({businessId,provider:'GOOGLE_MAPS',operation:'ROUTE',dailyQuota:EXTERNAL_API_DAILY_ROUTE_QUOTA,monthlyQuota:EXTERNAL_API_MONTHLY_ROUTE_QUOTA});
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'X-Goog-Api-Key':process.env.GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask':'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline'
    },
    body:JSON.stringify({
      origin:{address:String(origin)},
      destination:{address:String(destination)},
      travelMode:'TWO_WHEELER',
      routingPreference:'TRAFFIC_AWARE',
      languageCode:'en',
      units:'METRIC'
    })
  });
  const data=await response.json().catch(()=>({}));
  if (!response.ok || !data.routes?.[0]) throw new Error(data.error?.message || 'Google Maps route could not be calculated');
  const route=data.routes[0];
  return {
    distanceMeters:Number(route.distanceMeters||0),
    durationSeconds:Math.round(parseFloat(String(route.duration||'0').replace('s',''))||0),
    encodedPolyline:route.polyline?.encodedPolyline||null
  };
}
async function getNairobiFuelPrice() {
  const cached=await pool.query(`select petrol_price_kes from fuel_price_snapshots where city='Nairobi' order by fetched_at desc limit 1`);
  const cachedAt=await pool.query(`select fetched_at from fuel_price_snapshots where city='Nairobi' order by fetched_at desc limit 1`);
  if(cached.rowCount && cachedAt.rowCount && Date.now()-new Date(cachedAt.rows[0].fetched_at).getTime()<6*60*60*1000) return Number(cached.rows[0].petrol_price_kes);
  const configured=Number(process.env.NAIROBI_FUEL_PRICE_KES||0);
  if(configured>0){
    await pool.query(`insert into fuel_price_snapshots(id,city,petrol_price_kes,source,effective_from) values(gen_random_uuid(),'Nairobi',$1,'environment',current_date)`,[configured]);
    return configured;
  }
  try {
    const response=await fetch(process.env.EPRA_FUEL_PRICE_URL||'https://www.epra.go.ke/EPRA%20Pump%20Prices',{headers:{'User-Agent':'RestaurantDeliveryPlatform/1.0'}});
    const html=await response.text();
    const match=html.match(/Nairobi\s+PMS\s+([0-9]+(?:\.[0-9]+)?)/i);
    if(match){
      const price=Number(match[1]);
      if(Number.isFinite(price)&&price>0){
        await pool.query(`insert into fuel_price_snapshots(id,city,petrol_price_kes,source,effective_from) values(gen_random_uuid(),'Nairobi',$1,'EPRA',current_date)`,[price]);
        return price;
      }
    }
  } catch {}
  if(cached.rowCount) return Number(cached.rows[0].petrol_price_kes);
  return 214.03;
}
async function calculateDeliveryQuote({businessId,pickupAddress,deliveryAddress}) {
  const route=await computeGoogleRoute(pickupAddress,deliveryAddress,businessId);
  const km=route.distanceMeters/1000;
  const minutes=route.durationSeconds/60;
  const fuel=await getNairobiFuelPrice();
  const online=await pool.query(`select count(*)::int as count from riders r join rider_presence p on p.rider_id=r.id where r.business_id=$1 and r.active=true and p.online=true`,[businessId]);
  const availableOnline=Number(online.rows[0]?.count||0);
  const demandMultiplier=availableOnline===0?1.18:availableOnline===1?1.10:1.0;
  const baseFee=70;
  const distanceFee=km*34;
  const timeFee=minutes*1.35;
  const fuelMultiplier=Math.max(0.9,Math.min(1.2,fuel/200));
  const raw=(baseFee+distanceFee+timeFee)*fuelMultiplier*demandMultiplier;
  const fee=Math.max(100,Math.ceil(raw/10)*10);
  return {...route,km,minutes,fuelPriceKes:fuel,baseFeeKes:baseFee,distanceFeeKes:distanceFee,timeFeeKes:timeFee,demandMultiplier,deliveryFeeKes:fee};
}


app.post('/api/manager/login', authRateLimit, async (req,res)=>{
  try{
    const businessId=String(req.body.businessId||process.env.MANAGER_BUSINESS_ID||'11111111-1111-4111-8111-111111111111');
    const email=String(req.body.email||'').trim().toLowerCase();
    const password=String(req.body.password||'');
    if(!email||!password) return res.status(400).json({error:'Email and password are required'});
    if(password.length>256) return res.status(400).json({error:'Password is too long'});
    let result=await pool.query('select * from manager_users where business_id=$1 and lower(email)=lower($2) and active=true',[businessId,email]);
    if(!result.rowCount){
      const configuredEmail=String(process.env.MANAGER_EMAIL||'').trim().toLowerCase();
      const configuredPassword=String(process.env.MANAGER_PASSWORD||'');
      if(!configuredEmail||!configuredPassword||email!==configuredEmail||password!==configuredPassword) return res.status(401).json({error:'Invalid manager login'});
      const name=String(process.env.MANAGER_NAME||'Restaurant Manager').trim()||'Restaurant Manager';
      const hash=hashManagerPassword(password);
      await pool.query('insert into manager_users(id,business_id,name,email,password_hash,role,active) values(gen_random_uuid(),$1,$2,$3,$4,$5,true) on conflict(business_id,email) do nothing',[businessId,name,email,hash,String(process.env.MANAGER_ROLE||'OWNER').toUpperCase()==='OWNER'?'OWNER':'MANAGER']);
      result=await pool.query('select * from manager_users where business_id=$1 and lower(email)=lower($2) and active=true',[businessId,email]);
    }
    const manager=result.rows[0];
    const configuredEmail=String(process.env.MANAGER_EMAIL||'').trim().toLowerCase();
    const configuredPassword=String(process.env.MANAGER_PASSWORD||'');
    const envCredentialsMatch=Boolean(configuredEmail&&configuredPassword&&email===configuredEmail&&password===configuredPassword);
    if(!verifyManagerPassword(password,manager.password_hash)){
      if(!envCredentialsMatch) return res.status(401).json({error:'Invalid manager login'});
      await pool.query('update manager_users set password_hash=$1 where id=$2',[hashManagerPassword(password),manager.id]);
    }
    const token=await createAuthSession('manager',manager.id);
    await pool.query('update manager_users set last_login_at=now() where id=$1',[manager.id]);
    res.json({token,manager:{id:manager.id,businessId:manager.business_id,name:manager.name,email:manager.email,role:manager.role}});
  }catch(error){res.status(500).json({error:error.message||'Unable to sign in manager'});}
});
app.get('/api/manager/google/config',(req,res)=>res.json({clientId:String(process.env.GOOGLE_CLIENT_ID||'')}));
app.post('/api/manager/google', googleRateLimit, async (req,res)=>{
  try{
    const businessId=String(req.body.businessId||process.env.MANAGER_BUSINESS_ID||'11111111-1111-4111-8111-111111111111');
    const credential=String(req.body.credential||'').trim();
    const clientId=String(process.env.GOOGLE_CLIENT_ID||'').trim();
    if(!clientId) return res.status(503).json({error:'Google sign-in is not configured on the server'});
    if(!credential) return res.status(400).json({error:'Google credential is required'});
    const verify=await fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(credential));
    const profile=await verify.json().catch(()=>({}));
    if(!verify.ok || profile.aud!==clientId || profile.iss!=='https://accounts.google.com' || profile.email_verified!=='true') return res.status(401).json({error:'Google account could not be verified'});
    const email=String(profile.email||'').trim().toLowerCase();
    if(!email) return res.status(401).json({error:'Google did not provide an email address'});
    let result=await pool.query('select * from manager_users where business_id=$1 and lower(email)=lower($2) and active=true',[businessId,email]);
    if(!result.rowCount){
      const configuredEmail=String(process.env.MANAGER_EMAIL||'').trim().toLowerCase();
      if(email!==configuredEmail) return res.status(403).json({error:'This Google account is not authorized for this restaurant'});
      const name=String(profile.name||process.env.MANAGER_NAME||'Restaurant Manager').trim()||'Restaurant Manager';
      const hash=hashManagerPassword(crypto.randomBytes(32).toString('hex'));
      await pool.query('insert into manager_users(id,business_id,name,email,password_hash,role,active) values(gen_random_uuid(),$1,$2,$3,$4,$5,true) on conflict(business_id,email) do nothing',[businessId,name,email,hash,String(process.env.MANAGER_ROLE||'OWNER').toUpperCase()==='OWNER'?'OWNER':'MANAGER']);
      result=await pool.query('select * from manager_users where business_id=$1 and lower(email)=lower($2) and active=true',[businessId,email]);
    }
    const manager=result.rows[0];
    if(!manager) return res.status(403).json({error:'Manager account is not configured'});
    const token=crypto.randomBytes(32).toString('hex');
    await pool.query('insert into manager_sessions(id,manager_id,token_hash,expires_at) values(gen_random_uuid(),$1,$2,now()+make_interval(hours => $3))',[manager.id,hashSessionToken(token),SESSION_TTLS.managerHours]);
    await pool.query('update manager_users set last_login_at=now() where id=$1',[manager.id]);
    res.json({token,manager:{id:manager.id,businessId:manager.business_id,name:manager.name,email:manager.email,role:manager.role}});
  }catch(error){res.status(500).json({error:error.message||'Unable to sign in with Google'});}
});


// Phase 4 Restaurant Operations OS: one manager view for dispatch state across orders, riders and live tracking.
app.get('/api/manager/dispatch', requireManager, async (req, res) => {
  try {
    if(!await getRiderConnectionState(req.manager.business_id)) return res.status(403).json({error:'Rider Dashboard is not connected for this restaurant',code:'RIDER_DASHBOARD_NOT_CONNECTED'});
    await ensureDeliveryTrackingSchema();
    await ensureMenuOptionsSchema();
  await ensurePhase1SecuritySchema();
  await ensureRealtimeAndExternalApiSecuritySchema();
    const businessId = req.manager.business_id;
    const [connection, riders, unassigned, active] = await Promise.all([
      pool.query('select coalesce(rider_connected,false) as rider_connected from business_connections where business_id=$1 limit 1', [businessId]),
      pool.query(`
        select r.id,r.name,r.phone,r.vehicle_type,r.number_plate,r.profile_image_url,r.rider_status,
          coalesce(p.online,false) as online,
          a.trip_id,a.order_id,a.order_number,a.order_status,a.delivery_status,a.delivery_event_status,a.assigned_at,
          a.customer_name,a.delivery_address,a.route_distance_meters,a.route_duration_seconds,a.delivery_fee,a.rider_earning,
          l.latitude,l.longitude,l.accuracy_meters,l.updated_at as location_updated_at
        from riders r
        left join rider_presence p on p.rider_id=r.id
        left join lateral (
          select t.id as trip_id,t.order_id,t.assigned_at,o.order_number,o.status as order_status,o.delivery_status,
            o.delivery_address,o.route_distance_meters,o.route_duration_seconds,o.delivery_fee,o.rider_earning,c.name as customer_name,
            (select de.status from delivery_events de where de.trip_id=t.id order by de.created_at desc limit 1) as delivery_event_status
          from rider_trips t
          join orders o on o.id=t.order_id
          join customers c on c.id=o.customer_id
          where t.rider_id=r.id and t.completed_at is null
          order by t.assigned_at desc limit 1
        ) a on true
        left join rider_live_locations l on l.rider_id=r.id and l.trip_id=a.trip_id
        where r.business_id=$1
        order by r.rider_status,r.name`, [businessId]),
      pool.query(`
        select o.id,o.order_number,o.status,o.payment_status,o.total,o.delivery_fee,o.delivery_address,
          o.route_distance_meters,o.route_duration_seconds,o.created_at,c.name as customer_name,c.phone as customer_phone,
          o.branch_id,bb.name as branch_name,bb.latitude as branch_latitude,bb.longitude as branch_longitude
        from orders o
        join customers c on c.id=o.customer_id
        left join business_branches bb on bb.id=o.branch_id
        where o.business_id=$1 and o.status='ACCEPTED'
          and not exists(select 1 from rider_trips t where t.order_id=o.id and t.completed_at is null)
        order by o.created_at asc`, [businessId]),
      pool.query(`
        select o.id,o.order_number,o.status,o.payment_status,o.total,o.delivery_fee,o.delivery_status,
          o.delivery_address,o.route_distance_meters,o.route_duration_seconds,o.created_at,c.name as customer_name,c.phone as customer_phone,
          t.id as trip_id,t.assigned_at,r.id as rider_id,r.name as rider_name,r.vehicle_type,r.number_plate,
          (select de.status from delivery_events de where de.trip_id=t.id order by de.created_at desc limit 1) as rider_event_status
        from rider_trips t
        join orders o on o.id=t.order_id
        join customers c on c.id=o.customer_id
        join riders r on r.id=t.rider_id
        where o.business_id=$1 and t.completed_at is null
        order by t.assigned_at asc`, [businessId])
    ]);
    const riderRows=riders.rows.map(r=>({
      ...r,
      available:Boolean(r.rider_status==='ACTIVE' && r.online && !r.trip_id),
      liveLocation:Boolean(r.location_updated_at && (Date.now()-new Date(r.location_updated_at).getTime())<60000)
    }));
    res.json({
      riderConnected:Boolean(connection.rows[0]?.rider_connected),
      riders:riderRows,
      unassigned:unassigned.rows,
      active:active.rows,
      summary:{
        riders:riderRows.length,
        online:riderRows.filter(r=>r.online).length,
        available:riderRows.filter(r=>r.available).length,
        busy:riderRows.filter(r=>Boolean(r.trip_id)).length,
        unassigned:unassigned.rowCount,
        active:active.rowCount,
        liveLocations:riderRows.filter(r=>r.liveLocation).length
      }
    });
  } catch (error) {
    res.status(500).json({error:error.message||'Unable to load dispatch operations'});
  }
});

app.get('/api/manager/payments', requireManager, async (req, res) => {
  try {
    const result=await pool.query(`
      select p.id,p.order_id,p.provider,p.provider_reference,p.amount,p.status,p.confirmed_at,p.created_at,
        o.order_number,o.status as order_status,o.payment_status,o.payment_method,o.total,
        c.name as customer_name,c.phone as customer_phone
      from payments p
      join orders o on o.id=p.order_id
      join customers c on c.id=o.customer_id
      where o.business_id=$1
      order by p.created_at desc
      limit 300`, [req.manager.business_id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({error:error.message||'Unable to load payments'});
  }
});

app.post('/api/manager/payments/:id/verify', requireManager, async (req, res) => {
  try {
    const result=await pool.query(`
      select p.id,p.provider,p.provider_reference,p.status,o.id as order_id,o.business_id
      from payments p join orders o on o.id=p.order_id
      where p.id=$1 and o.business_id=$2
      limit 1`, [req.params.id, req.manager.business_id]);
    if(!result.rowCount) return res.status(404).json({error:'Payment not found'});
    const payment=result.rows[0];
    if(payment.provider!=='PAYSTACK') return res.status(400).json({error:'Only Paystack payments can be verified here'});
    if(!payment.provider_reference) return res.status(409).json({error:'Payment provider reference is missing'});
    const verified=await paystackRequest(`/transaction/verify/${encodeURIComponent(payment.provider_reference)}`,{method:'GET'});
    const data=verified.data||{};
    if(data.status==='success'){
      const orderId=await markPaymentSuccessful(payment.provider_reference,data);
      return res.json({status:'success',orderId});
    }
    res.json({status:data.status||'pending',orderId:payment.order_id});
  } catch(error) {
    res.status(500).json({error:error.message||'Unable to verify payment'});
  }
});

app.get('/api/manager/refunds', requireManager, async (req, res) => {
  try {
    const result=await pool.query(`
      select rf.id,rf.order_id,rf.provider,rf.provider_refund_id,rf.transaction_reference,rf.amount,rf.currency,rf.status,
        rf.customer_note,rf.merchant_note,rf.created_at,rf.updated_at,o.order_number,c.name as customer_name
      from refunds rf
      join orders o on o.id=rf.order_id
      join customers c on c.id=o.customer_id
      where o.business_id=$1
      order by rf.created_at desc limit 200`, [req.manager.business_id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({error:error.message||'Unable to load refunds'});
  }
});

app.get('/api/manager/sms-settings',requireManager,async(req,res)=>{
  try{
    const config=await getBusinessSmsSettings(req.manager.business_id);
    const serverSender=String(process.env.AFRICASTALKING_SENDER_ID||'').trim();
    res.json({
      businessId:req.manager.business_id,
      enabled:Boolean(config.enabled),
      senderId:config.sender_id||'',
      systemSenderId:serverSender,
      effectiveSenderId:config.sender_id||serverSender||'',
      environment:smsEnvironment(),
      assignmentTemplate:config.assignment_template
    });
  }catch(e){res.status(500).json({error:e.message||'Unable to load SMS settings'});}
});
app.put('/api/manager/sms-settings',requireManager,requireManagerRole('OWNER'),async(req,res)=>{
  try{
    await ensureSmsSchema();
    const senderId=normalizeSenderId(req.body.senderId);
    const assignmentTemplate=String(req.body.assignmentTemplate||'').trim();
    const enabled=req.body.enabled!==false;
    if(!assignmentTemplate)return res.status(400).json({error:'Assignment message template is required'});
    if(assignmentTemplate.length>320)return res.status(400).json({error:'SMS template must be 320 characters or fewer'});
    await pool.query(`insert into business_sms_settings(business_id,sender_id,assignment_template,enabled,updated_at)
      values($1,$2,$3,$4,now())
      on conflict(business_id) do update set sender_id=excluded.sender_id,assignment_template=excluded.assignment_template,enabled=excluded.enabled,updated_at=now()`,
      [req.manager.business_id,senderId||null,assignmentTemplate,enabled]);
    res.json(await getBusinessSmsSettings(req.manager.business_id));
  }catch(e){res.status(400).json({error:e.message||'Unable to save SMS settings'});}
});
app.post('/api/manager/sms-test', smsTestRateLimit,requireManager,requireManagerRole('OWNER'),async(req,res)=>{
  try{
    const phone=normalizeKenyanPhone(req.body.phone);
    const settings=await getBusinessSmsSettings(req.manager.business_id);
    const message=String(req.body.message||'').trim() || renderSmsTemplate(settings.assignment_template,{
      restaurant:settings.name,order:'DEMO-0001',rider:req.manager.name||'Rider',
      dashboard:`${FRONTEND_URL.replace(/\/$/,'')}/rider.html?businessId=${encodeURIComponent(req.manager.business_id)}`
    });
    if(message.length>918)return res.status(400).json({error:'SMS message is too long'});
    const result=await sendSms({businessId:req.manager.business_id,to:phone,message,purpose:'TEST'});
    res.json({ok:true,message:'SMS accepted by Africa\'s Talking',...result});
  }catch(e){res.status(400).json({error:e.message||'Unable to send test SMS'});}
});

app.get('/api/manager/sms-log',requireManager,async(req,res)=>{
  try{
    await ensureSmsSchema();
    const result=await pool.query(`select l.id,l.recipient,l.sender_id,l.message,l.purpose,l.environment,l.status,
      l.provider_status,l.provider_message_id,l.provider_cost,l.error_message,l.created_at,
      l.rider_id,l.order_id,o.order_number,r.name as rider_name
      from sms_message_log l
      left join orders o on o.id=l.order_id
      left join riders r on r.id=l.rider_id
      where l.business_id=$1
      order by l.created_at desc
      limit 50`,[req.manager.business_id]);
    res.json(result.rows);
  }catch(e){res.status(500).json({error:e.message||'Unable to load SMS log'});}
});

app.get('/api/manager/me',requireManager,(req,res)=>res.json({id:req.manager.id,businessId:req.manager.business_id,name:req.manager.name,email:req.manager.email,role:req.manager.role}));
app.post('/api/manager/logout',requireManager,async(req,res)=>{
  try{await pool.query('delete from manager_sessions where id=$1',[req.manager.session_id]);res.json({ok:true});}
  catch(error){res.status(500).json({error:error.message||'Unable to log out'});}
});

app.get('/api/businesses/:id', async (req,res)=>{
  try{
    const result=await pool.query('select id,name,slug,pickup_address from businesses where id=$1',[req.params.id]);
    if(!result.rowCount)return res.status(404).json({error:'Business not found'});
    res.json(result.rows[0]);
  }catch{res.status(500).json({error:'Unable to load business'});}
});
app.post('/api/riders/:id/deliveries/:tripId/location',requireRiderModule,requireRiderAuth,async(req,res)=>{
  try{
    const lat=Number(req.body.latitude), lng=Number(req.body.longitude);
    const accuracy=Number(req.body.accuracy);
    const heading=Number(req.body.heading);
    const speed=Number(req.body.speed);
    const previous=await pool.query('select latitude,longitude,accuracy_meters,updated_at from rider_live_locations where rider_id=$1',[req.rider.id]);
    const gpsCheck=validateGpsSample({lat,lng,accuracy,previous:previous.rows[0]});
    if(!gpsCheck.ok)return res.status(gpsCheck.suspicious?422:400).json({error:gpsCheck.error,suspicious:Boolean(gpsCheck.suspicious)});
    if(Number.isFinite(heading)&&(heading<0||heading>360))return res.status(400).json({error:'Invalid heading'});
    if(Number.isFinite(speed)&&(speed<0||speed>RIDER_GPS_MAX_SPEED_MPS))return res.status(400).json({error:'Invalid GPS speed'});
    const trip=await pool.query(`select t.id,t.order_id,o.business_id,o.status,o.delivery_status
      from rider_trips t join orders o on o.id=t.order_id
      where t.id=$1 and t.rider_id=$2 and t.completed_at is null limit 1`,[req.params.tripId,req.rider.id]);
    if(!trip.rowCount)return res.status(404).json({error:'Active delivery not found'});
    const row=trip.rows[0];
    if(!['OUT_FOR_DELIVERY','ACCEPTED'].includes(String(row.status)) && String(row.delivery_status)!=='ASSIGNED'){
      return res.status(409).json({error:'This delivery is no longer active'});
    }
    await ensureDeliveryTrackingSchema();
    await pool.query(`insert into rider_live_locations(rider_id,trip_id,order_id,latitude,longitude,accuracy_meters,heading,speed_mps,updated_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,now())
      on conflict(rider_id) do update set trip_id=excluded.trip_id,order_id=excluded.order_id,latitude=excluded.latitude,longitude=excluded.longitude,accuracy_meters=excluded.accuracy_meters,heading=excluded.heading,speed_mps=excluded.speed_mps,updated_at=now()`,
      [req.rider.id,row.id,row.order_id,lat,lng,Number.isFinite(accuracy)?accuracy:null,Number.isFinite(heading)?heading:null,Number.isFinite(speed)?speed:null]);
    broadcastRealtime({
      businessId:row.business_id,
      orderId:row.order_id,
      riderId:req.rider.id,
      event:'delivery.location',
      data:{orderId:row.order_id,tripId:row.id,riderId:req.rider.id,latitude:lat,longitude:lng,accuracy:Number.isFinite(accuracy)?accuracy:null,heading:Number.isFinite(heading)?heading:null,speed:Number.isFinite(speed)?speed:null,updatedAt:new Date().toISOString()}
    });
    res.json({ok:true,latitude:lat,longitude:lng,updatedAt:new Date().toISOString()});
  }catch(e){res.status(400).json({error:e.message||'Unable to update rider location'});}
});

app.get('/api/orders/:id/live-location',requireCustomerOrder,async(req,res)=>{
  try{
    await ensureDeliveryTrackingSchema();
    const r=await pool.query(`select l.latitude,l.longitude,l.accuracy_meters,l.heading,l.speed_mps,l.updated_at,
        t.id as trip_id,t.rider_id,r.name as rider_name
      from rider_live_locations l
      join rider_trips t on t.id=l.trip_id
      join riders r on r.id=t.rider_id
      where l.order_id=$1 and t.completed_at is null
      limit 1`,[req.params.id]);
    if(!r.rowCount)return res.status(404).json({error:'Live rider location not available'});
    res.json(r.rows[0]);
  }catch(e){res.status(500).json({error:'Unable to load live rider location'});}
});

app.post('/api/realtime-token', async (req,res)=>{
  try{
    const scope=String(req.body?.scope||'').toUpperCase();
    const bearer=String(req.headers.authorization||'').startsWith('Bearer ')?String(req.headers.authorization).slice(7).trim():'';
    if(!bearer)return res.status(401).json({error:'Authentication required'});
    if(scope==='CUSTOMER_ORDER'){
      const orderId=String(req.body?.orderId||'').trim();
      const q=await pool.query('select id,business_id from orders where id=$1 and customer_access_token_hash=$2 limit 1',[orderId,hashSessionToken(bearer)]);
      if(!q.rowCount)return res.status(401).json({error:'Order access authorization required'});
      return res.json({token:await issueRealtimeAccessToken({scope,businessId:q.rows[0].business_id,orderId:q.rows[0].id}),expiresIn:REALTIME_TOKEN_TTL_SECONDS});
    }
    if(scope==='MANAGER'){
      const manager=await getManagerFromSession({headers:{authorization:'Bearer '+bearer}});
      if(!manager)return res.status(401).json({error:'Manager login required'});
      return res.json({token:await issueRealtimeAccessToken({scope,businessId:manager.business_id}),expiresIn:REALTIME_TOKEN_TTL_SECONDS});
    }
    if(scope==='RIDER'){
      const rider=await getRiderFromSession({headers:{authorization:'Bearer '+bearer}});
      if(!rider)return res.status(401).json({error:'Rider login required'});
      return res.json({token:await issueRealtimeAccessToken({scope,businessId:rider.business_id,riderId:rider.id}),expiresIn:REALTIME_TOKEN_TTL_SECONDS});
    }
    if(scope==='STATION'){
      const station=await getStationFromSession({headers:{authorization:'Bearer '+bearer}});
      if(!station)return res.status(401).json({error:'Station pairing required'});
      return res.json({token:await issueRealtimeAccessToken({scope,businessId:station.business_id,stationId:station.station_id}),expiresIn:REALTIME_TOKEN_TTL_SECONDS});
    }
    return res.status(400).json({error:'Unsupported realtime scope'});
  }catch(error){res.status(500).json({error:error.message||'Unable to create realtime token'});}
});

app.get('/api/events', async (req,res)=>{
  try{
    const access=await getRealtimeAccessToken(String(req.query.realtimeToken||'').trim());
    if(!access||!['CUSTOMER_ORDER','MANAGER'].includes(access.scope))return res.status(401).json({error:'Realtime authorization required'});
    const client={res,businessId:String(access.business_id),orderId:access.order_id?String(access.order_id):null,riderId:null};
    res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('Connection','keep-alive');res.flushHeaders?.();
    realtimeClients.add(client);sendRealtime(client,'connected',{ok:true});
    const heartbeat=setInterval(()=>sendRealtime(client,'heartbeat',{at:new Date().toISOString()}),25000);
    req.on('close',()=>{clearInterval(heartbeat);realtimeClients.delete(client);});
  }catch{res.status(500).json({error:'Unable to authorize realtime events'});}
});

async function initiateRefundForOrder(orderId, customerNote = 'Customer cancelled before restaurant acceptance', merchantNote = 'Automatic cancellation refund') {
  const idempotencyKey='AUTO-CANCEL-'+String(orderId);
  const client=await pool.connect();
  let refundIntent=null;
  let order=null;
  try{
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))',[idempotencyKey]);
    const existing=await client.query('select * from refunds where idempotency_key=$1 limit 1 for update',[idempotencyKey]);
    if(existing.rowCount){await client.query('commit');return existing.rows[0];}
    const orderResult=await client.query(
      `select o.id,o.business_id,o.total,o.payment_status,p.id as payment_id,p.provider_reference,p.amount as paid_amount,p.status as payment_state
         from orders o join payments p on p.order_id=o.id and p.provider='PAYSTACK'
        where o.id=$1 for update of o,p`,[orderId]);
    if(!orderResult.rowCount){await client.query('rollback');throw new Error('Paid Paystack order not found');}
    order=orderResult.rows[0];
    if(order.payment_status!=='PAID' || !order.provider_reference || String(order.payment_state).toUpperCase()!=='PAID'){await client.query('commit');return null;}
    const refundedResult=await client.query(`select coalesce(sum(amount),0) as total from refunds where payment_id=$1 and status in ('PENDING','PROCESSING','PROCESSED','NEEDS-ATTENTION')`,[order.payment_id]);
    const remaining=Math.round((Number(order.paid_amount)-Number(refundedResult.rows[0].total))*100)/100;
    if(remaining<=0.0001){await client.query('commit');return null;}
    const inserted=await client.query(`insert into refunds(id,order_id,payment_id,provider,provider_refund_id,transaction_reference,amount,currency,status,customer_note,merchant_note,idempotency_key)
      values(gen_random_uuid(),$1,$2,'PAYSTACK',null,$3,$4,'KES','PENDING',$5,$6,$7) returning *`,
      [order.id,order.payment_id,order.provider_reference,remaining,customerNote,merchantNote,idempotencyKey]);
    refundIntent=inserted.rows[0];
    await client.query('commit');
  }catch(error){
    try{await client.query('rollback')}catch{}
    throw error;
  }finally{client.release();}

  try{
    const refund=await paystackRequest('/refund',{method:'POST',body:JSON.stringify({transaction:order.provider_reference,amount:String(Math.round(Number(refundIntent.amount)*100)),currency:'KES',customer_note:customerNote,merchant_note:merchantNote})});
    const data=refund.data||{};
    const updated=await pool.query(`update refunds set provider_refund_id=coalesce($1,provider_refund_id),status=$2,updated_at=now() where id=$3 returning *`,
      [data.id?String(data.id):null,String(data.status||'pending').toUpperCase(),refundIntent.id]);
    const result=updated.rows[0];
    broadcastRealtime({businessId:order.business_id,orderId:order.id,event:'refund.updated',data:{orderId:order.id,refund:result}});
    return result;
  }catch(error){
    const updated=await pool.query(`update refunds set status='NEEDS-ATTENTION',updated_at=now() where id=$1 and status in ('PENDING','PROCESSING') returning *`,[refundIntent.id]).catch(()=>({rows:[]}));
    const result=updated.rows[0]||refundIntent;
    await recordSystemIncident({businessId:order.business_id,source:'REFUNDS',severity:'CRITICAL',message:'Automatic refund provider outcome could not be confirmed; manual reconciliation is required.',metadata:{orderId:order.id,refundId:refundIntent.id,idempotencyKey,provider:'PAYSTACK'}});
    return result;
  }
}

async function markPaymentSuccessful(reference, paystackData = null, expectedOrderId = null) {
  const client = await pool.connect();
  let cancelledOrderId = null;
  let paidOrder = null;
  try {
    await client.query('begin');
    const paymentResult = await client.query(
      `select p.*, o.total, o.id as order_id, o.business_id, o.status as order_status
         from payments p
         join orders o on o.id=p.order_id
        where p.provider='PAYSTACK'
          and p.provider_reference=$1
          and ($2::uuid is null or o.id=$2::uuid)
        for update`,
      [reference, expectedOrderId || null]
    );
    if (!paymentResult.rowCount) {
      await client.query('rollback');
      return null;
    }
    const payment = paymentResult.rows[0];
    const paymentState=String(payment.status||'').toUpperCase();
    if(paymentState==='REFUNDED'){
      await client.query('rollback');
      throw new Error('Payment has already been refunded');
    }
    if(paymentState==='PAID'){
      await client.query('commit');
      return payment.order_id;
    }
    if(!['PENDING','INITIALIZING'].includes(paymentState)){
      await client.query('rollback');
      throw new Error('Payment is not in a confirmable state');
    }
    const expectedSubunit = Math.round(Number(payment.total) * 100);
    if (paystackData && Number(paystackData.amount) !== expectedSubunit) {
      await client.query('rollback');
      throw new Error('Paystack amount does not match the order total');
    }
    if (paystackData && String(paystackData.reference||'') !== String(reference)) {
      await client.query('rollback');
      throw new Error('Paystack reference mismatch');
    }
    await client.query(
      `update payments
          set status='PAID', confirmed_at=coalesce(confirmed_at,now())
        where id=$1 and status in ('PENDING','INITIALIZING')`,
      [payment.id]
    );
    const updated = await client.query(
      `update orders set payment_status='PAID' where id=$1 returning *`,
      [payment.order_id]
    );
    paidOrder = updated.rows[0];
    await ensureReceipt(client,payment.order_id);
    cancelledOrderId = payment.order_status === 'CANCELLED' ? payment.order_id : null;
    if(paidOrder){
      await client.query(
        `insert into outbox_events(event_type,aggregate_type,aggregate_id,business_id,payload)
         values('payment.confirmed','ORDER',$1,$2,$3)`,
        [paidOrder.id,paidOrder.business_id,{orderId:paidOrder.id,orderNumber:paidOrder.order_number,paymentStatus:'PAID'}]
      );
    }
    await client.query('commit');
    if(paidOrder) broadcastOrder(paidOrder,{reason:'payment.confirmed',notification:'New paid order'});
    if(cancelledOrderId) await initiateRefundForOrder(
      cancelledOrderId,
      'Customer cancelled before payment completed',
      'Automatic refund because the order was cancelled before restaurant acceptance'
    );
    return payment.order_id;
  } catch(error) {
    try { await client.query('rollback'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function updateRefundFromWebhook(data) {
  const transactionReference = String(data?.transaction_reference || data?.transaction?.reference || '');
  const refundProviderId = data?.refund_reference || data?.id || null;
  const status = String(data?.status || '').toUpperCase();
  if (!transactionReference || !status) return;
  const client = await pool.connect();
  try {
    await client.query('begin');
    const refundResult = await client.query(`select r.*, p.id as payment_id, p.amount as payment_amount, o.business_id from refunds r join payments p on p.id=r.payment_id join orders o on o.id=r.order_id where r.transaction_reference=$1 and (r.provider_refund_id=$2 or r.provider_refund_id is null) order by r.created_at desc limit 1 for update`, [transactionReference, refundProviderId]);
    if (!refundResult.rowCount) { await client.query('rollback'); return; }
    const refund = refundResult.rows[0];
    const mappedStatus = ['PENDING','PROCESSING','PROCESSED','FAILED','NEEDS-ATTENTION'].includes(status) ? status : refund.status;
    const updatedRefund = await client.query(`update refunds set status=$1, provider_refund_id=coalesce(provider_refund_id,$2), updated_at=now() where id=$3 returning *`, [mappedStatus, refundProviderId, refund.id]);
    if (mappedStatus === 'PROCESSED') {
      const totalRefunded = await client.query(`select coalesce(sum(amount),0) as total from refunds where payment_id=$1 and status='PROCESSED'`, [refund.payment_id]);
      if (Number(totalRefunded.rows[0].total) >= Number(refund.payment_amount)) {
        await client.query(`update payments set status='REFUNDED' where id=$1`, [refund.payment_id]);
        await client.query(`update orders set payment_status='REFUNDED' where id=$1`, [refund.order_id]);
      }
    }
    await client.query('commit');
    broadcastRealtime({ businessId: refund.business_id, orderId: refund.order_id, event: 'refund.updated', data: { orderId: refund.order_id, refund: updatedRefund.rows[0], paymentStatus: mappedStatus === 'PROCESSED' ? 'REFUNDED' : undefined } });
  } catch (error) { try { await client.query('rollback'); } catch {} throw error; }
  finally { client.release(); }
}

async function completeOrderByConfirmation(orderId, actor, { requireDisconnectedRiderDashboard = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const orderResult = await client.query(
      `select o.*, coalesce(bc.rider_connected,false) as rider_connected,
              rt.id as trip_id, rt.rider_id
         from orders o
         left join business_connections bc on bc.business_id=o.business_id
         left join lateral (
           select id,rider_id from rider_trips where order_id=o.id order by assigned_at desc limit 1
         ) rt on true
        where o.id=$1
        for update of o`,
      [orderId,riderConnected]
    );
    if (!orderResult.rowCount) {
      await client.query('rollback');
      return { error: 'Order not found', status: 404 };
    }
    const order = orderResult.rows[0];
    const riderConnected=await getRiderConnectionState(order.business_id,client);
    if (requireDisconnectedRiderDashboard && riderConnected) {
      await client.query('rollback');
      return { error: 'This restaurant uses the Rider Dashboard. The rider must complete the delivery from the rider portal.', status: 409 };
    }
    if (order.status !== 'OUT_FOR_DELIVERY') {
      await client.query('rollback');
      return { error: 'Only orders that are out for delivery can be marked delivered', status: 409 };
    }

    const updated = await client.query(
      `update orders
          set status='DELIVERED',
              delivered_at=coalesce(delivered_at,now()),
              delivery_status='DELIVERED',
              delivery_fee_status=case when $2 then 'RELEASED' else 'MERCHANT' end,
              delivery_fee_released_at=case when $2 then coalesce(delivery_fee_released_at,now()) else null end
        where id=$1
        returning *`,
      [orderId]
    );

    if (order.trip_id) {
      await client.query(
        `insert into delivery_events(id,trip_id,status,note)
         values(gen_random_uuid(),$1,'DELIVERED',$2)`,
        [order.trip_id, actor === 'customer' ? 'Customer confirmed delivery' : 'Restaurant confirmed delivery after rider confirmation']
      );
      await client.query(
        `update rider_trips set completed_at=coalesce(completed_at,now()),confirmed_by=$2 where id=$1`,
        [order.trip_id, actor]
      );
      await client.query(
        `insert into rider_earnings(id,rider_id,trip_id,amount,status,released_at)
         select gen_random_uuid(),rider_id,$1,delivery_fee,'RELEASED',now()
           from orders where id=$2
         on conflict(trip_id) do update set status='RELEASED',released_at=now()`,
        [order.trip_id, orderId]
      );
    }

    await client.query('commit');

    const finalOrder = (await pool.query('select * from orders where id=$1',[orderId])).rows[0];
    broadcastOrder(finalOrder, {
      reason: actor === 'customer' ? 'customer.delivery_confirmed' : 'restaurant.delivery_confirmed',
      notification: 'Delivery completed'
    });
    if (order.trip_id && order.rider_id) {
      broadcastRider({
        businessId: order.business_id,
        riderId: order.rider_id,
        orderId,
        action: 'DELIVERY_COMPLETED',
        data: { tripId: order.trip_id, status: 'DELIVERED', confirmedBy: actor }
      });
    }

    return { ok: true, order: finalOrder };
  } catch (error) {
    try { await client.query('rollback'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

app.get('/health', async (_req, res) => { try { await pool.query('select 1'); res.json({ ok: true, database: true }); } catch { res.status(503).json({ ok: false, database: false }); } });
app.get('/api/customers', requireManager, async (req,res)=>{
  try{
    const businessId=String(req.query.businessId||''),q=String(req.query.q||'').trim();
    if(!businessId)return res.status(400).json({error:'businessId is required'});
    if(String(req.manager.business_id)!==businessId)return res.status(403).json({error:'You can only access your own restaurant'});
    const result=await pool.query(`select c.id,c.name,c.phone,c.email,c.created_at,count(o.id)::int as order_count,count(o.id) filter(where o.status='DELIVERED')::int as completed_orders,count(o.id) filter(where o.status='CANCELLED')::int as cancelled_orders,coalesce(sum(o.total) filter(where o.payment_status='PAID' and o.status<>'CANCELLED'),0) as lifetime_spend,min(o.created_at) as first_order_at,max(o.created_at) as last_order_at from customers c left join orders o on o.customer_id=c.id where c.business_id=$1 and ($2='' or c.name ilike '%'||$2||'%' or c.phone ilike '%'||$2||'%' or coalesce(c.email,'') ilike '%'||$2||'%') group by c.id order by max(o.created_at) desc nulls last,c.name asc limit 250`,[businessId,q]);
    res.json(result.rows);
  }catch(error){res.status(500).json({error:error.message||'Unable to load customer records'});}
});
app.get('/api/customers/:id/record', requireManager, async (req,res)=>{
  try{
    const customer=await pool.query('select * from customers where id=$1 and business_id=$2',[req.params.id,req.manager.business_id]);
    if(!customer.rowCount)return res.status(404).json({error:'Customer record not found'});
    const [orders,addresses,audit]=await Promise.all([
      pool.query(`select o.*,coalesce((select json_agg(json_build_object('id',oi.id,'productId',oi.product_id,'name',oi.product_name,'quantity',oi.quantity,'unitPrice',oi.unit_price,'options',oi.options) order by oi.id) from order_items oi where oi.order_id=o.id),'[]'::json) items,coalesce((select json_agg(json_build_object('id',p.id,'provider',p.provider,'reference',p.provider_reference,'amount',p.amount,'status',p.status,'confirmedAt',p.confirmed_at,'createdAt',p.created_at) order by p.created_at desc) from payments p where p.order_id=o.id),'[]'::json) payments,coalesce((select json_agg(json_build_object('id',rf.id,'amount',rf.amount,'currency',rf.currency,'status',rf.status,'providerRefundId',rf.provider_refund_id,'transactionReference',rf.transaction_reference,'customerNote',rf.customer_note,'merchantNote',rf.merchant_note,'createdAt',rf.created_at,'updatedAt',rf.updated_at) order by rf.created_at desc) from refunds rf where rf.order_id=o.id),'[]'::json) refunds,coalesce((select json_agg(json_build_object('id',ae.id,'eventType',ae.event_type,'statusFrom',ae.status_from,'statusTo',ae.status_to,'paymentFrom',ae.payment_status_from,'paymentTo',ae.payment_status_to,'actorType',ae.actor_type,'note',ae.note,'metadata',ae.metadata,'createdAt',ae.created_at) order by ae.created_at asc) from order_audit_events ae where ae.order_id=o.id),'[]'::json) audit,coalesce((select json_agg(json_build_object('id',de.id,'status',de.status,'note',de.note,'latitude',de.latitude,'longitude',de.longitude,'createdAt',de.created_at) order by de.created_at asc) from delivery_events de join rider_trips rt on rt.id=de.trip_id where rt.order_id=o.id),'[]'::json) delivery_events,coalesce((select json_build_object('id',r.id,'name',r.name,'phone',r.phone,'vehicleType',r.vehicle_type,'numberPlate',r.number_plate) from riders r join rider_trips rt on rt.rider_id=r.id where rt.order_id=o.id order by rt.assigned_at desc limit 1),'{}'::json) rider,coalesce((select json_build_object('id',rt.id,'assignedAt',rt.assigned_at,'completedAt',rt.completed_at,'confirmedBy',rt.confirmed_by) from rider_trips rt where rt.order_id=o.id order by rt.assigned_at desc limit 1),'{}'::json) trip,coalesce((select json_build_object('id',rc.id,'receiptNumber',rc.receipt_number,'amount',rc.amount,'issuedAt',rc.issued_at) from receipts rc where rc.order_id=o.id),'{}'::json) receipt,coalesce((select json_build_object('id',dq.id,'distanceMeters',dq.distance_meters,'durationSeconds',dq.duration_seconds,'fuelPriceKes',dq.fuel_price_kes,'deliveryFeeKes',dq.delivery_fee_kes,'riderEarningKes',dq.rider_earning_kes,'pricingMode',dq.pricing_mode,'createdAt',dq.created_at) from delivery_quotes dq where dq.order_id=o.id order by dq.created_at desc limit 1),'{}'::json) delivery_quote from orders o where o.customer_id=$1 and o.business_id=$2 order by o.created_at desc`,[req.params.id,req.manager.business_id]),
      pool.query(`select delivery_address,delivery_lat,delivery_lng,count(*)::int order_count,max(created_at) last_used from orders where customer_id=$1 and business_id=$2 and delivery_address is not null and trim(delivery_address)<>'' group by delivery_address,delivery_lat,delivery_lng order by max(created_at) desc`,[req.params.id,req.manager.business_id]),
      pool.query(`select ae.id,ae.order_id,o.order_number,ae.event_type,ae.status_from,ae.status_to,ae.payment_status_from,ae.payment_status_to,ae.actor_type,ae.note,ae.metadata,ae.created_at from order_audit_events ae join orders o on o.id=ae.order_id where ae.business_id=$1 and o.customer_id=$2 order by ae.created_at desc limit 500`,[req.manager.business_id,req.params.id])
    ]);
    const summary={orderCount:orders.rowCount,completedOrders:orders.rows.filter(x=>x.status==='DELIVERED').length,cancelledOrders:orders.rows.filter(x=>x.status==='CANCELLED').length,paidSpend:orders.rows.filter(x=>x.payment_status==='PAID'&&x.status!=='CANCELLED').reduce((s,x)=>s+Number(x.total||0),0),firstOrderAt:orders.rows.at(-1)?.created_at||null,lastOrderAt:orders.rows[0]?.created_at||null};
    res.json({customer:customer.rows[0],summary,orders:orders.rows,addresses:addresses.rows,audit:audit.rows});
  }catch(error){res.status(500).json({error:error.message||'Unable to load customer record'});}
});
app.post('/api/orders/:id/confirm-delivery', requireCustomerOrder, async (req,res)=>{
  try{
    const result=await completeOrderByConfirmation(req.params.id,'customer');
    if(result.error) return res.status(result.status).json({error:result.error});
    res.json(result.order);
  }catch(error){res.status(500).json({error:error.message||'Unable to confirm delivery'});}
});
app.get('/api/orders/:id', requireCustomerOrder, async (req, res) => { try { const result = await pool.query(`select o.*, c.name as customer_name, c.phone, c.email, r.name as rider_name, r.vehicle_type, r.number_plate, r.phone as rider_phone from orders o join customers c on c.id=o.customer_id left join riders r on r.id=(select rider_id from rider_trips t where t.order_id=o.id order by assigned_at desc limit 1) where o.id=$1`, [req.params.id]); if (!result.rowCount) return res.status(404).json({ error: 'Order not found' }); res.json(result.rows[0]); } catch { res.status(500).json({ error: 'Unable to load order' }); } });
app.get('/api/orders/:id/refunds', requireCustomerOrder, async (req, res) => { try { const result = await pool.query(`select id,amount,currency,status,created_at,updated_at,customer_note,merchant_note from refunds where order_id=$1 order by created_at desc`, [req.params.id]); res.json(result.rows); } catch { res.status(500).json({ error: 'Unable to load refunds' }); } });
app.get('/api/orders', requireManager, async (req, res) => { try { const { businessId, q = '' } = req.query; if (!businessId) return res.status(400).json({ error: 'businessId is required' }); const result = await pool.query(`select o.id,o.business_id,o.order_number,o.status,o.payment_status,o.payment_method,o.total,o.created_at,o.delivery_note,o.branch_id,bb.latitude as branch_latitude,bb.longitude as branch_longitude,c.name,c.phone,c.email,coalesce((select r.name from riders r join rider_trips t on t.rider_id=r.id where t.order_id=o.id order by t.assigned_at desc limit 1),'') as rider_name,coalesce((select r.vehicle_type from riders r join rider_trips t on t.rider_id=r.id where t.order_id=o.id order by t.assigned_at desc limit 1),'') as rider_vehicle,coalesce((select r.number_plate from riders r join rider_trips t on t.rider_id=r.id where t.order_id=o.id order by t.assigned_at desc limit 1),'') as rider_plate,
      coalesce((select de.status from delivery_events de join rider_trips rt on rt.id=de.trip_id where rt.order_id=o.id order by de.created_at desc limit 1),'') as rider_delivery_status from orders o join customers c on c.id=o.customer_id left join business_branches bb on bb.id=o.branch_id where o.business_id=$1 and ($2='' or c.name ilike '%'||$2||'%' or c.phone ilike '%'||$2||'%' or coalesce(c.email,'') ilike '%'||$2||'%' or o.order_number ilike '%'||$2||'%') order by o.created_at desc limit 200`, [businessId, String(q).trim()]); res.json(result.rows); } catch { res.status(500).json({ error: 'Unable to load orders' }); } });
app.get('/api/riders/:id/profile', requireManager, async(req,res)=>{
  try{
    const riderId=String(req.params.id);
    const base=await pool.query(`select r.id,r.business_id,r.name,r.phone,r.email,r.vehicle_type,r.number_plate,r.payout_phone,r.profile_image_url,r.active,r.rider_status,r.created_at,coalesce(p.online,false) as online from riders r left join rider_presence p on p.rider_id=r.id where r.id=$1 and r.business_id=$2`,[riderId,req.manager.business_id]);
    if(!base.rowCount)return res.status(404).json({error:'Rider not found'});
    const [summary,trips]=await Promise.all([
      pool.query(`select count(t.id)::int as total_trips,count(t.id) filter (where t.completed_at is not null)::int as completed_trips,count(t.id) filter (where t.completed_at is null)::int as active_trips,coalesce(sum(o.total) filter (where t.completed_at is not null),0)::numeric as delivered_order_value,coalesce(sum(o.route_distance_meters) filter (where t.completed_at is not null),0)::numeric as distance_meters,coalesce(sum(re.amount) filter (where t.completed_at is not null),0)::numeric as total_earnings,coalesce(sum(re.amount) filter (where t.completed_at is not null and t.completed_at>=current_date),0)::numeric as today_earnings,coalesce(sum(re.amount) filter (where t.completed_at is not null and t.completed_at>=current_date-interval '6 days'),0)::numeric as week_earnings,count(distinct o.delivery_address) filter (where t.completed_at is not null)::int as places_delivered,max(t.completed_at) as last_delivery_at from rider_trips t join orders o on o.id=t.order_id left join rider_earnings re on re.trip_id=t.id where t.rider_id=$1`,[riderId]),
      pool.query(`select t.id,t.assigned_at,t.completed_at,o.order_number,o.status,o.total,o.delivery_address,o.route_distance_meters,o.route_duration_seconds,coalesce(re.amount,0)::numeric as earning,c.name as customer_name,c.phone as customer_phone from rider_trips t join orders o on o.id=t.order_id join customers c on c.id=o.customer_id left join rider_earnings re on re.trip_id=t.id where t.rider_id=$1 order by coalesce(t.completed_at,t.assigned_at) desc limit 100`,[riderId])
    ]);
    res.json({rider:base.rows[0],summary:summary.rows[0]||{},trips:trips.rows});
  }catch(error){res.status(500).json({error:error.message||'Unable to load rider profile'});}
});

app.get('/api/riders', requireManager, async (req, res) => { try {
  const { businessId } = req.query;
  if (!businessId) return res.status(400).json({ error: 'businessId is required' });
  if(String(businessId)!==String(req.manager.business_id)) return res.status(403).json({error:'Business access denied'});
  const result = await pool.query(`select r.id,r.name,r.phone,r.email,r.vehicle_type,r.number_plate,r.profile_image_url,r.active,r.rider_status,coalesce(p.online,false) as online,p.latitude,p.longitude,p.accuracy_meters,p.location_updated_at,exists(select 1 from rider_trips t join orders o on o.id=t.order_id where t.rider_id=r.id and t.completed_at is null) as busy,(select count(*) from rider_trips t where t.rider_id=r.id and t.completed_at is not null) as trip_count,(select max(t.completed_at) from rider_trips t where t.rider_id=r.id and t.completed_at is not null) as last_completed_at from riders r left join rider_presence p on p.rider_id=r.id where r.business_id=$1 order by r.name`, [businessId]);
  res.json(result.rows.map(r => {
    const gpsFresh=Boolean(r.location_updated_at && (Date.now()-new Date(r.location_updated_at).getTime()) <= RIDER_GPS_FRESHNESS_SECONDS*1000);
    const gpsUsable=gpsFresh && Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)) && Number(r.accuracy_meters||Infinity)<=RIDER_GPS_MAX_ACCURACY_METERS;
    return {...r,gpsFresh,gpsUsable,available:r.active&&r.online&&!r.busy&&(!RIDER_GPS_REQUIRED_FOR_ASSIGNMENT||gpsUsable)};
  }));
} catch { res.status(500).json({ error: 'Unable to load riders' }); } });
app.post('/api/orders/:id/status', requireManagerOrder, async (req, res) => { try { const nextStatus = String(req.body.status || '').toUpperCase(); if (!['ACCEPTED','DELIVERED'].includes(nextStatus)) return res.status(400).json({ error: 'Invalid status transition' }); const orderResult = await pool.query(`select * from orders where id=$1 for update`, [req.params.id]); if (!orderResult.rowCount) return res.status(404).json({ error: 'Order not found' }); const order = orderResult.rows[0]; if (nextStatus === 'ACCEPTED' && !(order.status === 'NEW' && order.payment_status === 'PAID')) return res.status(409).json({ error: 'Only paid NEW orders can be accepted' }); if (nextStatus === 'DELIVERED') {
      const result = await completeOrderByConfirmation(req.params.id, 'restaurant', { requireDisconnectedRiderDashboard: true });
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.json(result.order);
    }
    const result = await pool.query(`update orders set status='ACCEPTED',accepted_at=coalesce(accepted_at,now()) where id=$1 returning *`, [req.params.id]);
    broadcastOrder(result.rows[0], { reason: 'restaurant.accepted' });
    res.json(result.rows[0]); } catch { res.status(500).json({ error: 'Unable to update order status' }); } });
app.post('/api/orders/:id/cancel', requireCustomerOrder, async (req, res) => { const client = await pool.connect(); try { let order; try { await client.query('begin'); const result = await client.query(`select * from orders where id=$1 for update`, [req.params.id]); if (!result.rowCount) { await client.query('rollback'); return res.status(404).json({ error: 'Order not found' }); } order = result.rows[0]; if (order.status !== 'NEW') { await client.query('rollback'); return res.status(409).json({ error: 'This order can no longer be cancelled because the restaurant has accepted it.' }); } await client.query(`update orders set status='CANCELLED' where id=$1`, [order.id]);
      if (order.coupon_id && order.payment_status !== 'PAID') {
        const released = await client.query(
          `delete from customer_coupon_redemptions
            where order_id=$1 and coupon_id=$2
            returning coupon_id`,
          [order.id, order.coupon_id]
        );
        if (released.rowCount) {
          await client.query(
            `update customer_coupons
                set redeemed_count=greatest(0,redeemed_count-1)
              where id=$1`,
            [order.coupon_id]
          );
        }
      }
      const updated = await client.query(`select * from orders where id=$1`, [order.id]); await client.query('commit'); order = updated.rows[0]; broadcastOrder(order, { reason: 'customer.cancelled' }); } catch (error) { try { await client.query('rollback'); } catch {} throw error; } let refund = null; if (order.payment_status === 'PAID') refund = await initiateRefundForOrder(order.id, 'Customer cancelled before restaurant acceptance', 'Automatic cancellation refund'); const latest = await pool.query(`select * from orders where id=$1`, [order.id]); res.json({ order: latest.rows[0], refund }); } catch (error) { res.status(500).json({ error: error.message || 'Unable to cancel order' }); } finally { client.release(); } });
const deliveryQuoteCache = new Map();
const DELIVERY_QUOTE_CACHE_SECONDS = parsePositiveInt(process.env.DELIVERY_QUOTE_CACHE_SECONDS, 45, 5, 300);
const DELIVERY_QUOTE_MAX_ADDRESS_LENGTH = 500;
function quoteCacheKey(businessId,pickupAddress,deliveryAddress) {
  return [businessId,pickupAddress,deliveryAddress].map(v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ')).join('|');
}
setInterval(()=>{
  const now=Date.now();
  for(const [key,value] of deliveryQuoteCache) if(now>=value.expiresAt) deliveryQuoteCache.delete(key);
},60_000).unref?.();
setInterval(async()=>{try{await pool.query("delete from realtime_access_tokens where expires_at<now()");await pool.query("delete from external_api_usage_buckets where updated_at<now()-interval '400 days'");await pool.query("delete from external_api_usage_alerts where created_at<now()-interval '400 days'")}catch{}} ,60*60_000).unref?.();
app.post('/api/delivery/quote', quoteRateLimit, quoteBusinessRateLimit, async (req,res)=>{
  try{
    const business=String(req.body.businessId||'').trim();
    const pickup=String(req.body.pickupAddress||'').trim();
    const delivery=String(req.body.deliveryAddress||'').trim();
    if(!business||!pickup||!delivery) return res.status(400).json({error:'businessId, pickupAddress and deliveryAddress are required'});
    if(pickup.length>DELIVERY_QUOTE_MAX_ADDRESS_LENGTH||delivery.length>DELIVERY_QUOTE_MAX_ADDRESS_LENGTH) return res.status(400).json({error:'Delivery addresses are too long'});
    const features=await pool.query('select rider_module_enabled from business_features where business_id=$1',[business]);
    if(!features.rowCount||!features.rows[0].rider_module_enabled) return res.status(404).json({error:'Delivery module is not enabled for this business'});
    const key=quoteCacheKey(business,pickup,delivery);
    const cached=deliveryQuoteCache.get(key);
    const q=cached&&cached.expiresAt>Date.now()?cached.quote:await calculateDeliveryQuote({businessId:business,pickupAddress:pickup,deliveryAddress:delivery});
    if(!cached||cached.expiresAt<=Date.now()) deliveryQuoteCache.set(key,{quote:q,expiresAt:Date.now()+DELIVERY_QUOTE_CACHE_SECONDS*1000});
    const saved=await pool.query(`insert into delivery_quotes(id,business_id,pickup_address,delivery_address,distance_meters,duration_seconds,fuel_price_kes,base_fee_kes,distance_fee_kes,time_fee_kes,demand_multiplier,delivery_fee_kes) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,[business,pickup,delivery,q.distanceMeters,q.durationSeconds,q.fuelPriceKes,q.baseFeeKes,q.distanceFeeKes,q.timeFeeKes,q.demandMultiplier,q.deliveryFeeKes]);
    res.json({quoteId:saved.rows[0].id,...q,deliveryFee:saved.rows[0].delivery_fee_kes,currency:'KES'});
  }catch(error){
    if(error.code==='EXTERNAL_API_QUOTA_EXCEEDED'){
      try{
        const fallback=await pool.query(`select * from delivery_quotes where business_id=$1 and pickup_address=$2 and delivery_address=$3 and status='QUOTED' and created_at>now()-interval '30 minutes' order by created_at desc limit 1`,[business,pickup,delivery]);
        if(fallback.rowCount){
          const q=fallback.rows[0];
          return res.json({quoteId:q.id,distanceMeters:Number(q.distance_meters||0),durationSeconds:Number(q.duration_seconds||0),fuelPriceKes:Number(q.fuel_price_kes||0),baseFeeKes:Number(q.base_fee_kes||0),distanceFeeKes:Number(q.distance_fee_kes||0),timeFeeKes:Number(q.time_fee_kes||0),demandMultiplier:Number(q.demand_multiplier||1),deliveryFeeKes:Number(q.delivery_fee_kes||0),deliveryFee:Number(q.delivery_fee_kes||0),currency:'KES',fallback:'CACHED_QUOTE'});
        }
      }catch{}
    }
    res.status(error.status||400).json({error:error.message||'Unable to calculate delivery fee',code:error.code||undefined});
  }
});

app.post('/api/orders',
  sharedRateLimit({windowMs:10*60_000,max:20,keyFn:req=>`orders:${clientIp(req)}:${String(req.body?.businessId||'')}`,message:'Too many order attempts. Please wait before placing another order.'}),
  sharedRateLimit({windowMs:10*60_000,max:12,keyFn:req=>`order-fingerprint:${clientIp(req)}:${String(req.headers['user-agent']||'').slice(0,120)}:${String(req.body?.businessId||'')}`,message:'Too many order attempts from this client. Please wait before trying again.'}),
  async (req, res) => {
  const client=await pool.connect();
  try{
    const {businessId,customer,items,paymentMethod,deliveryNote,quoteId,couponCode,legal}=req.body;
    const normalizedPaymentMethod=paymentMethod==='M-Pesa'?'M-Pesa':paymentMethod==='Card'?'Card':null;
    const idempotencyKey=String(req.headers['idempotency-key']||req.body?.idempotencyKey||'').trim();
    if(!idempotencyKey||idempotencyKey.length<8||idempotencyKey.length>200)return res.status(400).json({error:'Idempotency-Key is required for order creation'});
    if(!businessId||!customer?.name||!customer?.phone||!customer?.email||!Array.isArray(items)||!items.length||!normalizedPaymentMethod) return res.status(400).json({error:'Missing order fields'});
    const termsAccepted=legal?.termsAccepted===true;
    const privacyNoticeAccepted=legal?.privacyNoticeAccepted===true;
    const marketingOptIn=legal?.marketingOptIn===true;
    if(!termsAccepted||!privacyNoticeAccepted)return res.status(400).json({error:'You must accept the Terms and acknowledge the Privacy Notice before placing an order'});
    if(items.length>50) return res.status(400).json({error:'Too many order items'});

    const requestFingerprint=hashOrderRequest({
      businessId,
      customer:{name:String(customer.name).trim(),phone:String(customer.phone).trim(),email:String(customer.email).trim()},
      items:items.map(item=>({productId:String(item.productId||'').trim(),quantity:Number(item.quantity),options:item.options&&typeof item.options==='object'?item.options:{}})),
      paymentMethod:normalizedPaymentMethod,
      deliveryNote:String(deliveryNote||'').trim(),
      quoteId:quoteId?String(quoteId):null,
      couponCode:couponCode?String(couponCode).trim().toUpperCase():null
    });

    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))',[String(businessId)+':ORDER-IDEMP:'+idempotencyKey]);

    const idemInsert=await client.query(
      `insert into order_idempotency_keys(business_id,idempotency_key,request_hash)
       values($1,$2,$3)
       on conflict(business_id,idempotency_key) do nothing
       returning business_id,idempotency_key,request_hash,order_id`,
      [businessId,idempotencyKey,requestFingerprint]
    );
    if(!idemInsert.rowCount){
      const existing=await client.query(
        'select request_hash,order_id from order_idempotency_keys where business_id=$1 and idempotency_key=$2 for update',
        [businessId,idempotencyKey]
      );
      if(!existing.rowCount){
        await client.query('rollback');
        return res.status(409).json({error:'Order idempotency record is unavailable. Please retry with the same key.'});
      }
      if(existing.rows[0].request_hash!==requestFingerprint){
        await client.query('rollback');
        return res.status(409).json({error:'Idempotency-Key was already used for a different order request'});
      }
      if(existing.rows[0].order_id){
        const existingOrder=await client.query('select * from orders where id=$1 and business_id=$2',[existing.rows[0].order_id,businessId]);
        if(!existingOrder.rowCount){
          await client.query('rollback');
          return res.status(409).json({error:'The previous order result is unavailable. Please contact the restaurant.'});
        }
        await client.query('commit');
        const access=createCustomerOrderToken(existingOrder.rows[0].id);
        return res.status(200).json({...existingOrder.rows[0],customerAccessToken:access.token,idempotent:true});
      }
    }

    const pendingSpam=await client.query(`select count(*)::int as count from orders o join customers c on c.id=o.customer_id where o.business_id=$1 and c.phone=$2 and o.status='NEW' and o.payment_status='PENDING' and o.created_at>now()-interval '30 minutes'`,[businessId,String(customer.phone).trim()]);
    if(Number(pendingSpam.rows[0]?.count||0)>=5){
      await client.query('rollback');
      return res.status(429).json({error:'Too many unpaid orders are already pending for this customer. Please complete or wait for an existing order.'});
    }

    let deliveryFee=0,deliveryData=null;
    if(quoteId){
      const quote=await client.query(
        `select * from delivery_quotes
          where id=$1 and business_id=$2 and status='QUOTED' and order_id is null
            and expires_at>now()
          for update`,
        [quoteId,businessId]
      );
      if(!quote.rowCount){
        await client.query('rollback');
        return res.status(400).json({error:'Delivery quote expired, already used, or invalid'});
      }
      deliveryData=quote.rows[0];
      deliveryFee=Number(deliveryData.delivery_fee_kes||0);
      const marked=await client.query(
        `update delivery_quotes set status='USED',updated_at=now()
          where id=$1 and status='QUOTED' and order_id is null
          returning id`,
        [quoteId]
      );
      if(!marked.rowCount){
        await client.query('rollback');
        return res.status(409).json({error:'Delivery quote was already used. Please request a new quote.'});
      }
    }

    let foodSubtotal=0;
    const trustedItems=[];
    for(const item of items){
      const productId=String(item.productId||'').trim();
      const quantity=Number(item.quantity);
      if(!productId||!Number.isInteger(quantity)||quantity<1||quantity>50) throw new Error('Invalid order item');
      const productResult=await client.query(
        'select id,business_id,name,price,options from products where id=$1 and business_id=$2 and active=true',
        [productId,businessId]
      );
      if(!productResult.rowCount) throw new Error('Menu item is unavailable');
      const product=productResult.rows[0];
      const submittedOptions=item.options && typeof item.options==='object' ? item.options : {};
      let unitPrice=Number(product.price);
      const optionGroups=Array.isArray(product.options)?product.options:[];
      for(const group of optionGroups){
        if(!submittedOptions[group.name]) continue;
        const selected=String(submittedOptions[group.name]);
        const choice=Array.isArray(group.choices)?group.choices.find(ch=>String(ch?.[0])===selected):null;
        if(!choice) throw new Error('Invalid menu option');
        unitPrice+=Number(choice[2]||0);
      }
      if(!Number.isFinite(unitPrice)||unitPrice<0) throw new Error('Invalid menu price');
      foodSubtotal+=unitPrice*quantity;
      trustedItems.push({productId,productName:product.name,quantity,unitPrice,options:submittedOptions});
    }
    foodSubtotal=Math.round(foodSubtotal*100)/100;

    if (deliveryData) {
      const zoneRows=await client.query(
        `select * from delivery_zones
          where business_id=$1 and active=true
          order by priority desc`,
        [businessId]
      );
      if(zoneRows.rowCount){
        const lat=Number(deliveryData.customer_lat),lng=Number(deliveryData.customer_lng);
        if(!Number.isFinite(lat)||!Number.isFinite(lng)) throw new Error('Delivery location coordinates are required for this restaurant');
        const matches=zoneRows.rows.filter(z=>
          z.zone_type==='RADIUS'
            ? Number.isFinite(Number(z.center_latitude)) &&
              Number.isFinite(Number(z.center_longitude)) &&
              haversineMeters(Number(z.center_latitude),Number(z.center_longitude),lat,lng)<=Number(z.radius_meters)
            : pointInPolygon(lat,lng,z.polygon)
        );
        if(!matches.length) throw new Error('Delivery location is outside the configured delivery zones');
        const zone=matches[0];
        if(foodSubtotal<Number(zone.minimum_order||0)) throw new Error('Order does not meet the delivery zone minimum order');
        deliveryFee=Number(zone.fee||0);
      }
    }

    let coupon=null;
    let couponDiscount=0;
    const normalizedCouponCode=String(couponCode||'').trim().toUpperCase();
    if(normalizedCouponCode){
      const couponResult=await client.query(
        `select id,code,discount_type,discount_value,min_order_amount,max_redemptions,redeemed_count
           from customer_coupons
          where business_id=$1 and code=$2 and active=true and starts_at<=now()
            and (expires_at is null or expires_at>now())
          for update`,
        [businessId,normalizedCouponCode]
      );
      if(!couponResult.rowCount) throw new Error('Coupon is invalid or expired');
      coupon=couponResult.rows[0];
      if(foodSubtotal<Number(coupon.min_order_amount)) throw new Error('Order does not meet the coupon minimum');
      if(coupon.max_redemptions!==null && Number(coupon.redeemed_count)>=Number(coupon.max_redemptions)) throw new Error('Coupon redemption limit has been reached');
      couponDiscount=coupon.discount_type==='PERCENT'
        ? Math.min(foodSubtotal,Math.round(foodSubtotal*Number(coupon.discount_value)/100*100)/100)
        : Math.min(foodSubtotal,Number(coupon.discount_value));
      couponDiscount=Math.round(couponDiscount*100)/100;
    }

    const numericTotal=Math.round((foodSubtotal-couponDiscount+deliveryFee)*100)/100;
    if(numericTotal<0) throw new Error('Invalid order total');

    const riderConnected=deliveryFee>0 ? await getRiderConnectionState(businessId,client) : false;
    const deliveryFeeStatus=deliveryFee>0 ? (riderConnected?'HELD':'MERCHANT') : 'NONE';
    const riderEarning=riderConnected ? deliveryFee : 0;

    const orderId=crypto.randomUUID();

    const customerResult=await client.query(
      `insert into customers(id,business_id,name,phone,email)
       values(gen_random_uuid(),$1,$2,$3,$4)
       on conflict(business_id,phone)
       do update set name=excluded.name,email=coalesce(excluded.email,customers.email)
       returning id`,
      [businessId,String(customer.name).trim(),String(customer.phone).trim(),String(customer.email).trim()]
    );

    if(coupon){
      const used=await client.query(
        'select id from customer_coupon_redemptions where coupon_id=$1 and customer_id=$2 limit 1 for update',
        [coupon.id,customerResult.rows[0].id]
      );
      if(used.rowCount) throw new Error('Coupon has already been used by this customer');
    }

    const orderNumber='SB-'+Date.now().toString().slice(-8)+'-'+orderId.slice(0,4).toUpperCase();
    const pickupAddress=deliveryData?.pickup_address||null;
    const deliveryAddress=deliveryData?.delivery_address||req.body.deliveryAddress?.trim()||deliveryNote?.trim()||null;
    const customerAccess=createCustomerOrderToken(orderId);

    const orderResult=await client.query(
      `insert into orders(
        id,business_id,customer_id,order_number,status,payment_status,payment_method,delivery_note,
        subtotal,total,delivery_fee,food_subtotal,coupon_id,coupon_discount,delivery_status,pickup_address,
        delivery_address,delivery_lat,delivery_lng,route_distance_meters,route_duration_seconds,
        delivery_fee_status,rider_earning,branch_id,customer_lat,customer_lng,
        selected_branch_distance_meters,selected_branch_duration_seconds,customer_access_token_hash
      ) values(
        $1,$2,$3,$4,'NEW','PENDING',$5,$6,$7,$8,$9,$7,$10,$11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25,$26
      ) returning *`,
      [
        orderId,businessId,customerResult.rows[0].id,orderNumber,normalizedPaymentMethod,
        deliveryNote?.trim()||null,foodSubtotal,numericTotal,deliveryFee,coupon?.id||null,couponDiscount,
        deliveryFeeStatus,pickupAddress,deliveryAddress,
        deliveryData?.customer_lat||null,deliveryData?.customer_lng||null,deliveryData?.distance_meters||null,
        deliveryData?.duration_seconds||null,riderEarning,deliveryData?.branch_id||null,
        deliveryData?.customer_lat||null,deliveryData?.customer_lng||null,deliveryData?.distance_meters||null,
        deliveryData?.duration_seconds||null,customerAccess.hash
      ]
    );
    await client.query(`
      insert into privacy_consents(id,business_id,customer_id,order_id,subject_phone,subject_email,consent_type,version,granted,source,ip_hash,user_agent)
      values(gen_random_uuid(),$1,$2,$3,$4,$5,'TERMS',$6,true,'WEB_CHECKOUT',$7,$8),
            (gen_random_uuid(),$1,$2,$3,$4,$5,'PRIVACY_NOTICE',$9,true,'WEB_CHECKOUT',$7,$8)
    `,[businessId,customerResult.rows[0].id,orderId,String(customer.phone).trim(),String(customer.email).trim(),LEGAL_VERSIONS.terms,crypto.createHash('sha256').update(String(req.ip||req.socket?.remoteAddress||'')).digest('hex'),String(req.headers['user-agent']||'').slice(0,500),LEGAL_VERSIONS.privacy]);
    if(marketingOptIn){
      await client.query(`insert into privacy_consents(id,business_id,customer_id,order_id,subject_phone,subject_email,consent_type,version,granted,source,ip_hash,user_agent) values(gen_random_uuid(),$1,$2,$3,$4,$5,'MARKETING_SMS',$6,true,'WEB_CHECKOUT',$7,$8)`,[businessId,customerResult.rows[0].id,orderId,String(customer.phone).trim(),String(customer.email).trim(),LEGAL_VERSIONS.privacy,crypto.createHash('sha256').update(String(req.ip||req.socket?.remoteAddress||'')).digest('hex'),String(req.headers['user-agent']||'').slice(0,500)]);
    }
    await client.query(`update orders set privacy_notice_version=$1,terms_version=$2,legal_accepted_at=now(),marketing_opt_in=$3 where id=$4`,[LEGAL_VERSIONS.privacy,LEGAL_VERSIONS.terms,marketingOptIn,orderId]);

    for(const item of trustedItems){
      await client.query(
        `insert into order_items(id,order_id,product_id,product_name,quantity,unit_price,options)
         values(gen_random_uuid(),$1,$2,$3,$4,$5,$6)`,
        [orderId,item.productId,item.productName,item.quantity,item.unitPrice,item.options]
      );
    }

    if(coupon){
      await client.query(
        `insert into customer_coupon_redemptions(id,coupon_id,customer_id,order_id)
         values(gen_random_uuid(),$1,$2,$3)`,
        [coupon.id,customerResult.rows[0].id,orderId]
      );
      await client.query(
        'update customer_coupons set redeemed_count=redeemed_count+1 where id=$1',
        [coupon.id]
      );
    }

    if(deliveryData){
      await client.query('update delivery_quotes set order_id=$1,updated_at=now() where id=$2 and status=\'USED\'',[orderId,quoteId]);
    }

    await client.query(
      `insert into payments(id,order_id,provider,amount,status)
       values(gen_random_uuid(),$1,'PAYSTACK',$2,'PENDING')`,
      [orderId,numericTotal]
    );
    await client.query(
      'update order_idempotency_keys set order_id=$1,updated_at=now() where business_id=$2 and idempotency_key=$3',
      [orderId,businessId,idempotencyKey]
    );
    await client.query('commit');
    res.status(201).json({...orderResult.rows[0],customerAccessToken:customerAccess.token});
  }catch(error){
    try{await client.query('rollback')}catch{}
    const status=error.message==='Invalid order item'?400:(
      ['Coupon is invalid or expired','Order does not meet the coupon minimum','Coupon redemption limit has been reached','Coupon has already been used by this customer','Invalid order total','Menu item is unavailable','Delivery location coordinates are required for this restaurant','Delivery location is outside the configured delivery zones','Order does not meet the delivery zone minimum order','Delivery quote expired, already used, or invalid'].includes(error.message)?400:500
    );
    res.status(status).json({error:status===400?error.message:'Unable to create order'});
  }finally{client.release();}
});
app.post('/api/payments/paystack/initialize', requireCustomerOrderBody, async (req,res)=>{
  const idempotencyKey=String(req.headers['idempotency-key']||req.body?.idempotencyKey||'').trim();
  if(!idempotencyKey||idempotencyKey.length>200)return res.status(400).json({error:'Idempotency-Key is required for payment initialization'});
  const {orderId}=req.body;
  if(!orderId)return res.status(400).json({error:'orderId is required'});
  const client=await pool.connect();
  let order;
  try{
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))',[String(orderId)]);
    const result=await client.query(`select o.id,o.order_number,o.total,o.food_subtotal,o.delivery_fee,o.payment_status,o.payment_method,o.status,
      c.email,c.phone,b.paystack_subaccount_code,o.coupon_discount,p.id as payment_id,p.provider_reference,p.status as payment_state,
      p.idempotency_key,p.authorization_url,p.payment_mode
      from orders o join customers c on c.id=o.customer_id join businesses b on b.id=o.business_id
      join payments p on p.order_id=o.id and p.provider='PAYSTACK'
      where o.id=$1 for update`,[orderId]);
    if(!result.rowCount){await client.query('rollback');return res.status(404).json({error:'Order or payment not found'});}
    order=result.rows[0];
    if(order.status==='CANCELLED'){await client.query('rollback');return res.status(409).json({error:'Order is cancelled'});}
    if(order.payment_status==='PAID'){await client.query('commit');return res.json({paid:true,orderId});}
    if(order.idempotency_key&&order.idempotency_key!==idempotencyKey&&order.provider_reference&&['INITIALIZING','PENDING'].includes(String(order.payment_state||'').toUpperCase())){
      await client.query('rollback');
      return res.status(409).json({error:'A payment is already being initialized for this order'});
    }
    if(order.idempotency_key===idempotencyKey&&order.provider_reference){
      await client.query('commit');
      if(order.payment_mode==='mobile_money')return res.json({mode:'mobile_money',orderId,reference:order.provider_reference,status:order.payment_state,displayText:'Check your phone and approve the M-Pesa payment.',idempotent:true});
      return res.json({mode:'redirect',orderId,reference:order.provider_reference,authorizationUrl:order.authorization_url,idempotent:true});
    }
    await client.query(`update payments set idempotency_key=$1,status='INITIALIZING' where id=$2`,[idempotencyKey,order.payment_id]);
    await client.query('commit');
  }catch(error){
    try{await client.query('rollback')}catch{}
    return res.status(500).json({error:error.message||'Unable to reserve payment intent'});
  }finally{client.release();}

  const reference=`SB-${orderId.replace(/-/g,'')}-${crypto.randomBytes(10).toString('hex')}`;
  const riderConnected=await getRiderConnectionState(order.business_id);
  const merchantFood=Math.max(0,Number(order.food_subtotal||0)-Number(order.coupon_discount||0));
  const merchantShareKes=merchantFood+(riderConnected?0:Number(order.delivery_fee||0));
  const split=order.paystack_subaccount_code && merchantShareKes>0
    ? {type:'flat',bearer_type:'account',subaccounts:[{subaccount:order.paystack_subaccount_code,share:Math.min(Math.round(Number(order.total)*100),Math.round(merchantShareKes*100))}]}
    : null;
  try{
    if(order.payment_method==='M-Pesa'){
      const payload={email:order.email,amount:String(Math.round(Number(order.total)*100)),currency:'KES',reference,mobile_money:{phone:normalizeKenyanPhone(order.phone),provider:'mpesa'}};
      if(split)payload.split=split;
      const charge=await paystackRequest('/charge',{method:'POST',body:JSON.stringify(payload)});
      const providerReference=charge.data?.reference||reference;
      await pool.query(`update payments set provider_reference=$1,status='PENDING',payment_mode='mobile_money' where order_id=$2 and provider='PAYSTACK' and idempotency_key=$3`,[providerReference,orderId,idempotencyKey]);
      return res.json({mode:'mobile_money',orderId,reference:providerReference,status:charge.data?.status,displayText:charge.data?.display_text||'Check your phone and approve the M-Pesa payment.'});
    }
    const apiPublicUrl=process.env.API_PUBLIC_URL||'https://restaurant-ordering-api-ow3p.onrender.com';
    const payload={email:order.email,amount:String(Math.round(Number(order.total)*100)),currency:'KES',reference,channels:['card'],callback_url:apiPublicUrl+'/api/payments/paystack/callback',metadata:{order_id:order.id,order_number:order.order_number}};
    if(split)payload.split=split;
    const transaction=await paystackRequest('/transaction/initialize',{method:'POST',body:JSON.stringify(payload)});
    await pool.query(`update payments set provider_reference=$1,status='PENDING',authorization_url=$2,payment_mode='redirect' where order_id=$3 and provider='PAYSTACK' and idempotency_key=$4`,[transaction.data.reference,transaction.data.authorization_url,orderId,idempotencyKey]);
    return res.json({mode:'redirect',orderId,reference:transaction.data.reference,authorizationUrl:transaction.data.authorization_url});
  }catch(error){
    await pool.query(`update payments set status='PENDING' where order_id=$1 and provider='PAYSTACK' and idempotency_key=$2 and status='INITIALIZING'`,[orderId,idempotencyKey]).catch(()=>{});
    res.status(502).json({error:error.message||'Unable to initialize payment'});
  }
});
app.get('/api/payments/paystack/callback', async (req, res) => { const reference = String(req.query.reference || ''); if (!reference) return res.redirect(`${FRONTEND_URL}/order.html?payment=missing`); try { const verified = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' }); const data = verified.data; if (data?.status !== 'success') throw new Error('Payment was not successful'); const orderId = await markPaymentSuccessful(reference, data); if (!orderId) return res.redirect(`${FRONTEND_URL}/order.html?payment=not-found`); const receipt = await pool.query('select receipt_access_token from receipts where order_id=$1',[orderId]); const token = receipt.rows[0]?.receipt_access_token || ''; return res.redirect(`${FRONTEND_URL}/order.html?id=${encodeURIComponent(orderId)}&payment=success${token?'&receipt='+encodeURIComponent(token):''}`); } catch { const payment = await pool.query(`select order_id from payments where provider='PAYSTACK' and provider_reference=$1`, [reference]); const orderId = payment.rows[0]?.order_id; const target = orderId ? `${FRONTEND_URL}/order.html?id=${encodeURIComponent(orderId)}&payment=failed` : `${FRONTEND_URL}/order.html?payment=failed`; return res.redirect(target); } });
app.post('/api/payments/paystack/verify', requireCustomerOrderBody, async (req, res) => { try { const reference = String(req.body.reference || ''); if (!reference) return res.status(400).json({ error: 'reference is required' }); const verified = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' }); if (verified.data?.status === 'success') { if (String(verified.data?.reference || '') !== reference) throw new Error('Paystack reference mismatch'); const orderId = await markPaymentSuccessful(reference, verified.data, req.customerOrder.id); const receipt = orderId ? await pool.query('select receipt_access_token from receipts where order_id=$1',[orderId]) : null; return res.json({ status: 'success', orderId, receiptToken: receipt?.rows[0]?.receipt_access_token || null }); } res.json({ status: verified.data?.status || 'pending' }); } catch (error) { res.status(500).json({ error: error.message || 'Unable to verify payment' }); } });
app.get('/api/payments/paystack/webhook', (_req, res) => { res.status(405).json({ error: 'Webhook endpoint accepts POST requests from Paystack.' }); });
app.post('/api/payments/paystack/webhook', async (req, res) => { const signature = req.headers['x-paystack-signature']; const secret = process.env.PAYSTACK_SECRET_KEY; if (!signature || !secret || !req.rawBody) return res.sendStatus(401); const expected = crypto.createHmac('sha512', secret).update(req.rawBody).digest('hex'); const providedBuffer = Buffer.from(String(signature), 'utf8'); const expectedBuffer = Buffer.from(expected, 'utf8'); if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return res.sendStatus(401); try { const event = req.body;
    const resourceId=String(event?.data?.id||event?.data?.reference||event?.data?.transaction_reference||'');
    if(resourceId){
      const seen=await pool.query(`insert into paystack_webhook_events(event_id,event_type,resource_id,payload)
        values($1,$2,$3,$4) on conflict(event_type,resource_id) do nothing returning id`,
        [String(event?.id||'')||null,String(event?.event||'UNKNOWN'),resourceId,event]);
      if(!seen.rowCount)return res.sendStatus(200);
    }
    if (event.event === 'charge.success' && event.data?.reference && event.data?.status === 'success') await markPaymentSuccessful(event.data.reference, event.data); if (event.event?.startsWith('refund.') && event.data) await updateRefundFromWebhook(event.data); return res.sendStatus(200); } catch (error) { console.error('Paystack webhook processing failed:', error.message); return res.sendStatus(500); } });
app.post('/api/admin/refunds', async (req, res) => {
  if (!requireRefundAdmin(req, res)) return;
  const {orderId,amount,customerNote,merchantNote}=req.body;
  const requestedAmount=Number(amount);
  const idempotencyKey=String(req.headers['idempotency-key']||req.body.idempotencyKey||'').trim();
  if(!idempotencyKey||idempotencyKey.length>200)return res.status(400).json({error:'Idempotency-Key is required for refunds'});
  if(!orderId||!Number.isFinite(requestedAmount)||requestedAmount<=0)return res.status(400).json({error:'orderId and a positive refund amount are required'});
  const client=await pool.connect();
  let refundIntent=null;
  let order=null;
  try{
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))',[idempotencyKey]);
    const existing=await client.query('select * from refunds where idempotency_key=$1 limit 1 for update',[idempotencyKey]);
    if(existing.rowCount){
      await client.query('commit');
      return res.json({refund:existing.rows[0],idempotent:true,reconciliationPending:['PENDING','PROCESSING','NEEDS-ATTENTION'].includes(String(existing.rows[0].status).toUpperCase())});
    }
    const orderResult=await client.query(`select o.id,o.business_id,o.total,o.food_subtotal,o.subtotal,o.payment_status,o.delivery_fee_released_at,p.id as payment_id,p.provider_reference,p.amount as paid_amount
      from orders o join payments p on p.order_id=o.id and p.provider='PAYSTACK'
      where o.id=$1 for update`,[orderId]);
    if(!orderResult.rowCount){await client.query('rollback');return res.status(404).json({error:'Paid Paystack order not found'});}
    order=orderResult.rows[0];
    if(order.payment_status!=='PAID'){await client.query('rollback');return res.status(409).json({error:'Only paid orders can be refunded'});}
    if(order.delivery_fee_released_at&&requestedAmount>Number(order.food_subtotal||order.subtotal)){await client.query('rollback');return res.status(400).json({error:'Delivery fee is not refundable after completed delivery; refund can only cover the food portion.'});}
    if(!order.provider_reference){await client.query('rollback');return res.status(409).json({error:'Paystack transaction reference is missing'});}
    const refundedResult=await client.query(`select coalesce(sum(amount),0) as total from refunds where payment_id=$1 and status in ('PENDING','PROCESSING','PROCESSED','NEEDS-ATTENTION')`,[order.payment_id]);
    const remaining=Number(order.paid_amount)-Number(refundedResult.rows[0].total);
    if(requestedAmount>remaining+0.0001){await client.query('rollback');return res.status(400).json({error:`Refund exceeds the remaining refundable amount (${remaining.toFixed(2)} KES)`});}
    const inserted=await client.query(`insert into refunds (id,order_id,payment_id,provider,provider_refund_id,transaction_reference,amount,currency,status,customer_note,merchant_note,idempotency_key)
      values(gen_random_uuid(),$1,$2,'PAYSTACK',null,$3,$4,'KES','PENDING',$5,$6,$7) returning *`,
      [order.id,order.payment_id,order.provider_reference,requestedAmount,customerNote||null,merchantNote||null,idempotencyKey]);
    refundIntent=inserted.rows[0];
    await client.query('commit');
  }catch(error){
    try{await client.query('rollback')}catch{}
    if(error.code==='23505')return res.status(409).json({error:'A refund with this Idempotency-Key already exists'});
    return res.status(500).json({error:error.message||'Unable to create refund intent'});
  }finally{client.release();}

  try{
    const refund=await paystackRequest('/refund',{method:'POST',body:JSON.stringify({transaction:order.provider_reference,amount:String(Math.round(requestedAmount*100)),currency:'KES',customer_note:customerNote||undefined,merchant_note:merchantNote||undefined})});
    const data=refund.data||{};
    const updated=await pool.query(`update refunds set provider_refund_id=coalesce($1,provider_refund_id),status=$2,updated_at=now() where id=$3 returning *`,
      [data.id?String(data.id):null,String(data.status||'pending').toUpperCase(),refundIntent.id]);
    const result=updated.rows[0];
    broadcastRealtime({businessId:order.business_id,orderId:order.id,event:'refund.updated',data:{orderId:order.id,refund:result}});
    return res.json({refund:result,idempotent:false});
  }catch(error){
    const updated=await pool.query(`update refunds set status='NEEDS-ATTENTION',updated_at=now() where id=$1 and status in ('PENDING','PROCESSING') returning *`,[refundIntent.id]).catch(()=>({rows:[]}));
    const result=updated.rows[0]||refundIntent;
    await recordSystemIncident({businessId:order.business_id,source:'REFUNDS',severity:'CRITICAL',message:'Refund provider outcome could not be confirmed; manual reconciliation is required.',metadata:{orderId:order.id,refundId:refundIntent.id,idempotencyKey,provider:'PAYSTACK'}});
    return res.status(202).json({refund:result,reconciliationPending:true,error:'Refund outcome could not be confirmed. No automatic retry was performed.'});
  }
});

app.get('/api/riders/events', requireRiderModule, async(req,res)=>{
  try{
    const access=await getRealtimeAccessToken(String(req.query.realtimeToken||'').trim());
    if(!access||access.scope!=='RIDER')return res.status(401).json({error:'Realtime authorization required'});
    const client={res,businessId:String(access.business_id),riderId:String(access.rider_id),orderId:null};
    res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('Connection','keep-alive');res.flushHeaders?.();
    realtimeClients.add(client);sendRealtime(client,'connected',{ok:true,riderId:access.rider_id});
    const heartbeat=setInterval(()=>sendRealtime(client,'heartbeat',{at:new Date().toISOString()}),25000);
    req.on('close',()=>{clearInterval(heartbeat);realtimeClients.delete(client);});
  }catch(error){res.status(500).json({error:error.message||'Unable to open rider events'});}
});

app.post('/api/riders/login', authRateLimit, requireRiderModule, async(req,res)=>{
  try{
    const {businessId,phone,password}=req.body;
    if(!businessId||!phone||!password) return res.status(400).json({error:'Business, phone and password are required'});
    const normalized=normalizeKenyanPhone(phone);
    const result=await pool.query(`select r.*,a.password_hash from riders r join rider_auth a on a.rider_id=r.id where r.business_id=$1 and r.phone=$2 and r.active=true and r.rider_status='ACTIVE'`,[businessId,normalized]);
    if(!result.rowCount||!verifyPassword(password,result.rows[0].password_hash)) return res.status(401).json({error:'Invalid rider login'});
    const token=await createAuthSession('rider',result.rows[0].id);
    await pool.query('update rider_auth set last_login_at=now() where rider_id=$1',[result.rows[0].id]);
    await pool.query(`insert into rider_presence(rider_id,online) values($1,true) on conflict(rider_id) do update set online=true,updated_at=now()`,[result.rows[0].id]);
    await pool.query(`insert into business_connections(business_id,rider_connected,updated_at) values($1,true,now()) on conflict(business_id) do update set rider_connected=true,updated_at=now()`,[businessId]);
    const r=result.rows[0];
    res.json({token,rider:{id:r.id,name:r.name,phone:r.phone,email:r.email,vehicle_type:r.vehicle_type,number_plate:r.number_plate,payout_phone:r.payout_phone,profile_image_url:r.profile_image_url,rider_status:r.rider_status}});
  }catch(error){res.status(500).json({error:error.message||'Unable to sign in'});}
});

app.post('/api/rider-invites', requireRiderModule, requireManager,requireManagerRole('OWNER'), async(req,res)=>{
  const client=await pool.connect();
  try{
    const {businessId,name,phone,email,vehicleType='Motorbike',numberPlate=''}=req.body;
    if(!businessId||!name||!phone) return res.status(400).json({error:'Name and phone are required'});
    const normalized=normalizeKenyanPhone(phone);
    await client.query('begin');
    const existing=await client.query(`select id,rider_status from riders where business_id=$1 and phone=$2 for update`,[businessId,normalized]);
    let rider;
    if(existing.rowCount){
      const status=existing.rows[0].rider_status;
      if(status==='ACTIVE') throw new Error('A rider with that phone is already active');
      if(status==='PENDING_APPROVAL') throw new Error('This rider has already completed registration and is awaiting approval');
      const updated=await client.query(`update riders set name=$2,email=$3,vehicle_type=$4,number_plate=$5,rider_status='INVITED',active=false where id=$1 returning id,name,phone,email,vehicle_type,number_plate,rider_status`,[existing.rows[0].id,String(name).trim(),String(email||'').trim()||null,String(vehicleType).trim()||'Motorbike',String(numberPlate||'').trim()]);
      rider=updated.rows[0];
      await client.query('update rider_invites set used_at=coalesce(used_at,now()) where rider_id=$1 and used_at is null',[rider.id]);
    }else{
      const inserted=await client.query(`insert into riders(id,business_id,name,phone,email,vehicle_type,number_plate,active,rider_status) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,false,'INVITED') returning id,name,phone,email,vehicle_type,number_plate,rider_status`,[businessId,String(name).trim(),normalized,String(email||'').trim()||null,String(vehicleType).trim()||'Motorbike',String(numberPlate||'').trim()]);
      rider=inserted.rows[0];
    }
    const raw=crypto.randomBytes(32).toString('hex');
    await client.query(`insert into rider_invites(id,rider_id,business_id,token_hash,expires_at) values(gen_random_uuid(),$1,$2,$3,now()+interval '48 hours')`,[rider.id,businessId,hashSessionToken(raw)]);
    await client.query('commit');
    broadcastRider({businessId,riderId:rider.id,action:'INVITED',data:{rider}});
    const signupUrl=`${FRONTEND_URL.replace(/\/$/,'')}/rider-signup.html?invite=${encodeURIComponent(raw)}`;
    res.status(201).json({ok:true,rider,signupUrl,expiresInHours:48});
  }catch(error){
    try{await client.query('rollback')}catch{}
    res.status(400).json({error:error.code==='23505'?'A rider invitation already exists for that phone':error.message||'Unable to create rider invitation'});
  }finally{client.release();}
});

app.get('/api/rider-invites/:token', requireRiderModule, async(req,res)=>{
  try{
    const token=String(req.params.token||'').trim();
    if(!token) return res.status(400).json({error:'Invitation token is required'});
    const result=await pool.query(`select i.expires_at,i.used_at,r.id,r.name,r.phone,r.email,r.vehicle_type,r.number_plate,r.rider_status,b.name as business_name
      from rider_invites i join riders r on r.id=i.rider_id join businesses b on b.id=i.business_id
      where i.token_hash=$1 and i.expires_at>now() and i.used_at is null and r.rider_status='INVITED'`,[hashSessionToken(token)]);
    if(!result.rowCount) return res.status(410).json({error:'This rider invitation is expired, already used, or no longer available'});
    const r=result.rows[0];
    res.json({rider:{id:r.id,name:r.name,phone:r.phone,email:r.email,vehicle_type:r.vehicle_type,number_plate:r.number_plate},businessName:r.business_name,expiresAt:r.expires_at});
  }catch(error){res.status(500).json({error:error.message||'Unable to verify rider invitation'});}
});

app.post('/api/rider-invites/:token/complete', requireRiderModule, async(req,res)=>{
  const client=await pool.connect();
  try{
    const token=String(req.params.token||'').trim();
    const {name,email,vehicleType,numberPlate,payoutPhone,password,profileImageUrl}=req.body;
    if(!token||!name||!password||!vehicleType||!numberPlate) return res.status(400).json({error:'Name, vehicle type, plate number and password are required'});
    if(String(password).length<8) return res.status(400).json({error:'Password must be at least 8 characters'});
    if(profileImageUrl&&String(profileImageUrl).length>700000) return res.status(400).json({error:'Profile photo is too large. Please choose a smaller photo'});
    await client.query('begin');
    const invite=await client.query(`select i.id,i.rider_id,i.business_id,r.phone,r.rider_status
      from rider_invites i join riders r on r.id=i.rider_id
      where i.token_hash=$1 and i.expires_at>now() and i.used_at is null
      for update`,[hashSessionToken(token)]);
    if(!invite.rowCount||invite.rows[0].rider_status!=='INVITED') throw new Error('This rider invitation is expired, already used, or no longer available');
    const row=invite.rows[0];
    const normalizedPayout=payoutPhone?normalizeKenyanPhone(payoutPhone):row.phone;
    const passwordData=hashPassword(password);
    const updated=await client.query(`update riders set name=$2,email=$3,vehicle_type=$4,number_plate=$5,payout_phone=$6,profile_image_url=$7,active=false,rider_status='PENDING_APPROVAL' where id=$1 returning id,business_id,name,phone,email,vehicle_type,number_plate,payout_phone,profile_image_url,rider_status`,[row.rider_id,String(name).trim(),String(email||'').trim()||null,String(vehicleType).trim(),String(numberPlate).trim(),normalizedPayout,String(profileImageUrl||'').trim()||null]);
    await client.query(`insert into rider_auth(rider_id,password_hash,payout_phone) values($1,$2,$3)
      on conflict(rider_id) do update set password_hash=excluded.password_hash,payout_phone=excluded.payout_phone`,[row.rider_id,passwordData.hash,normalizedPayout]);
    await client.query('update rider_invites set used_at=now() where id=$1',[invite.rows[0].id]);
    await client.query('insert into rider_presence(rider_id,online) values($1,false) on conflict(rider_id) do update set online=false,updated_at=now()',[row.rider_id]);
    await client.query('commit');
    broadcastRider({businessId:row.business_id,riderId:row.rider_id,action:'REGISTRATION_COMPLETED',data:{rider:updated.rows[0]}});
    res.json({ok:true,status:'PENDING_APPROVAL',rider:updated.rows[0]});
  }catch(error){
    try{await client.query('rollback')}catch{}
    res.status(400).json({error:error.message||'Unable to complete rider registration'});
  }finally{client.release();}
});

app.post('/api/riders/:id/invite', requireRiderModule, requireManager,requireManagerRole('OWNER'), async(req,res)=>{
  try{
    const riderResult=await pool.query(`select id,business_id,name,rider_status from riders where id=$1 and business_id=$2`,[req.params.id,req.manager.business_id]);
    if(!riderResult.rowCount){await client.query('rollback');return res.status(404).json({error:'Rider not found'});}
    if(riderResult.rows[0].rider_status!=='INVITED')return res.status(409).json({error:'Only invited riders can receive a new registration link'});
    const raw=crypto.randomBytes(32).toString('hex');
    await pool.query('update rider_invites set used_at=coalesce(used_at,now()) where rider_id=$1 and used_at is null',[req.params.id]);
    await pool.query(`insert into rider_invites(id,rider_id,business_id,token_hash,expires_at) values(gen_random_uuid(),$1,$2,$3,now()+interval '48 hours')`,[req.params.id,req.manager.business_id,hashSessionToken(raw)]);
    const signupUrl=`${FRONTEND_URL.replace(/\/$/,'')}/rider-signup.html?invite=${encodeURIComponent(raw)}`;
    res.json({ok:true,signupUrl,expiresInHours:48});
  }catch(error){res.status(400).json({error:error.message||'Unable to generate rider invitation'});}
});

app.post('/api/riders/:id/approve', requireRiderModule, requireManager,requireManagerRole('OWNER'), async(req,res)=>{
  try{
    const result=await pool.query(`update riders set rider_status='ACTIVE',active=true where id=$1 and business_id=$2 and rider_status='PENDING_APPROVAL' returning id,name,phone,email,vehicle_type,number_plate,payout_phone,profile_image_url,rider_status,active`,[req.params.id,req.manager.business_id]);
    if(!result.rowCount)return res.status(404).json({error:'Rider is not awaiting approval'});
    broadcastRider({businessId:req.manager.business_id,riderId:req.params.id,action:'APPROVED',data:{rider:result.rows[0]}});
    res.json({ok:true,rider:result.rows[0]});
  }catch(error){res.status(500).json({error:error.message||'Unable to approve rider'});}
});

app.post('/api/riders/:id/suspend', requireRiderModule, requireManager,requireManagerRole('OWNER'), async(req,res)=>{
  try{
    const result=await pool.query(`update riders set rider_status='SUSPENDED',active=false where id=$1 and business_id=$2 returning id,name,rider_status,active`,[req.params.id,req.manager.business_id]);
    if(!result.rowCount)return res.status(404).json({error:'Rider not found'});
    await pool.query('delete from rider_sessions where rider_id=$1',[req.params.id]);
    await pool.query(`insert into rider_presence(rider_id,online) values($1,false) on conflict(rider_id) do update set online=false,updated_at=now()`,[req.params.id]);
    broadcastRider({businessId:req.manager.business_id,riderId:req.params.id,action:'SUSPENDED',data:{rider:result.rows[0]}});
    res.json({ok:true,rider:result.rows[0]});
  }catch(error){res.status(500).json({error:error.message||'Unable to suspend rider'});}
});app.post('/api/riders/:id/reactivate', requireRiderModule, requireManager,requireManagerRole('OWNER'), async(req,res)=>{
  try{
    const result=await pool.query(`update riders set rider_status='ACTIVE',active=true where id=$1 and business_id=$2 and rider_status='SUSPENDED' returning id,name,phone,rider_status,active`,[req.params.id,req.manager.business_id]);
    if(!result.rowCount)return res.status(404).json({error:'Suspended rider not found'});
    broadcastRider({businessId:req.manager.business_id,riderId:req.params.id,action:'REACTIVATED',data:{rider:result.rows[0]}});
    res.json({ok:true,rider:result.rows[0]});
  }catch(error){res.status(500).json({error:error.message||'Unable to reactivate rider'});}
});


app.post('/api/riders/logout', requireRiderModule, requireRiderAuth, async(req,res)=>{
  await pool.query('delete from rider_sessions where id=$1',[req.rider.session_id]);
  await pool.query(`insert into rider_presence(rider_id,online) values($1,false) on conflict(rider_id) do update set online=false,updated_at=now()`,[req.rider.id]);
  const remainingSessions=await pool.query(`select count(*)::int as count from rider_sessions rs join riders r on r.id=rs.rider_id where r.business_id=$1 and rs.expires_at>now()`,[req.rider.business_id]);
  if(Number(remainingSessions.rows[0]?.count||0)===0) await pool.query(`update business_connections set rider_connected=false,updated_at=now() where business_id=$1`,[req.rider.business_id]);
  res.json({ok:true});
});
app.get('/api/riders/:id/deliveries/:tripId/route', requireRiderModule, requireRiderAuth, async(req,res)=>{
  try{
    const r=await pool.query(`select t.id,o.order_number,o.pickup_address,o.delivery_address,o.delivery_lat,o.delivery_lng,
      bb.latitude as pickup_latitude,bb.longitude as pickup_longitude
      from rider_trips t
      join orders o on o.id=t.order_id
      left join business_branches bb on bb.id=o.branch_id
      where t.id=$1 and t.rider_id=$2 and t.completed_at is null
      limit 1`,[req.params.tripId,req.rider.id]);
    if(!r.rowCount)return res.status(404).json({error:'Active delivery not found'});
    const row=r.rows[0];
    if(!row.pickup_address||!row.delivery_address)return res.status(400).json({error:'Pickup and delivery addresses are required for the live route'});
    const route=await computeGoogleRoute(row.pickup_address,row.delivery_address,req.rider.business_id);
    res.json({
      orderNumber:row.order_number,
      encodedPolyline:route.encodedPolyline,
      distanceMeters:route.distanceMeters,
      durationSeconds:route.durationSeconds,
      pickup:{address:row.pickup_address,lat:Number(row.pickup_latitude),lng:Number(row.pickup_longitude)},
      destination:{address:row.delivery_address,lat:Number(row.delivery_lat),lng:Number(row.delivery_lng)}
    });
  }catch(error){res.status(400).json({error:error.message||'Unable to build delivery route'});}
});
app.get('/api/riders/:id/demo-route', requireRiderModule, requireRiderAuth, async(req,res)=>{
  try{
    const route=await computeGoogleRoute('Kenyatta International Convention Centre, Nairobi, Kenya','Westgate Shopping Mall, Nairobi, Kenya',req.rider.business_id);
    res.json({
      encodedPolyline:route.encodedPolyline,
      distanceMeters:route.distanceMeters,
      durationSeconds:route.durationSeconds,
      pickup:'Kenyatta International Convention Centre, Nairobi',
      destination:'Westgate Shopping Mall, Nairobi'
    });
  }catch(error){res.status(400).json({error:error.message||'Unable to build demo road route'});}
});
app.get('/api/riders/me', requireRiderModule, requireRiderAuth, async(req,res)=>{
  const r=req.rider; res.json({id:r.id,name:r.name,phone:r.phone,email:r.email,vehicle_type:r.vehicle_type,number_plate:r.number_plate,payout_phone:r.payout_phone,profile_image_url:r.profile_image_url,rider_status:r.rider_status,active:r.active});
});
app.put('/api/riders/:id/profile', requireRiderModule, requireRiderAuth, async(req,res)=>{
  try{
    const {name,email,phone,payout_phone,vehicle_type,number_plate,profile_image_url,current_password,new_password}=req.body||{};
    const cleanName=String(name||'').trim();
    if(!cleanName)return res.status(400).json({error:'Full name is required'});
    const normalizedPhone=normalizeKenyanPhone(phone);
    const normalizedPayout=normalizeKenyanPhone(payout_phone||phone);
    const cleanEmail=String(email||'').trim().toLowerCase()||null;
    const cleanVehicle=String(vehicle_type||'Motorbike').trim()||'Motorbike';
    const cleanPlate=String(number_plate||'').trim()||null;
    const cleanImage=String(profile_image_url||'').trim()||null;
    if(cleanImage && cleanImage.length>1000000)return res.status(400).json({error:'Profile picture is too large'});
    if(new_password){
      if(String(new_password).length<8)return res.status(400).json({error:'New password must be at least 8 characters'});
      const auth=await pool.query('select password_hash from rider_auth where rider_id=$1',[req.rider.id]);
      if(!auth.rowCount || !verifyPassword(String(current_password||''),auth.rows[0].password_hash))return res.status(401).json({error:'Current password is incorrect'});
    }
    const updated=await pool.query(`update riders set name=$1,email=$2,phone=$3,payout_phone=$4,vehicle_type=$5,number_plate=$6,profile_image_url=$7 where id=$8 and business_id=$9 returning id,name,phone,email,vehicle_type,number_plate,payout_phone,profile_image_url,rider_status,active`,[cleanName,cleanEmail,normalizedPhone,normalizedPayout,cleanVehicle,cleanPlate,cleanImage,req.rider.id,req.rider.business_id]);
    if(!updated.rowCount)return res.status(404).json({error:'Rider account not found'});
    if(new_password){const passwordHash=hashPassword(String(new_password)).hash;await pool.query('update rider_auth set password_hash=$1 where rider_id=$2',[passwordHash,req.rider.id]);}
    broadcastRider({businessId:req.rider.business_id,riderId:req.rider.id,action:'PROFILE_UPDATED',data:{rider:updated.rows[0]}});
    res.json({ok:true,rider:updated.rows[0]});
  }catch(error){
    if(error.code==='23505')return res.status(409).json({error:'That phone number is already registered to another rider'});
    res.status(400).json({error:error.message||'Unable to update rider profile'});
  }
});

app.post('/api/riders/:id/presence', requireRiderModule, requireRiderAuth, async(req,res)=>{
  const online=Boolean(req.body.online);
  const lat=Number(req.body.latitude),lng=Number(req.body.longitude),accuracy=Number(req.body.accuracy);
  const hasLocation=Number.isFinite(lat)&&Number.isFinite(lng);
  const previous=hasLocation?await pool.query('select latitude,longitude,location_updated_at as updated_at from rider_presence where rider_id=$1',[req.rider.id]):{rowCount:0,rows:[]};
  if(hasLocation){
    const check=validateGpsSample({lat,lng,accuracy,previous:previous.rows[0]});
    if(!check.ok)return res.status(check.suspicious?422:400).json({error:check.error,suspicious:Boolean(check.suspicious)});
  }
  await pool.query(`
    insert into rider_presence(rider_id,online,latitude,longitude,accuracy_meters,location_updated_at)
    values($1,$2,$3,$4,$5,case when $2 and $3 is not null and $4 is not null then now() else null end)
    on conflict(rider_id) do update set online=$2,latitude=coalesce($3,rider_presence.latitude),longitude=coalesce($4,rider_presence.longitude),
      accuracy_meters=coalesce($5,rider_presence.accuracy_meters),
      location_updated_at=case when $2 and $3 is not null and $4 is not null then now() else rider_presence.location_updated_at end,
      updated_at=now()
  `,[req.rider.id,online,hasLocation?lat:null,hasLocation?lng:null,Number.isFinite(accuracy)?accuracy:null]);
  broadcastRider({businessId:req.rider.business_id,riderId:req.rider.id,action:online?'ONLINE':'OFFLINE',data:{online,locationUpdated:hasLocation}});
  res.json({online,locationUpdated:hasLocation});
});
app.get('/api/riders/:id/dashboard', requireRiderModule, requireRiderAuth, async(req,res)=>{
  const id=req.rider.id;
  const [available,active,completed,earnings,weekly,presence]=await Promise.all([
    pool.query(`select o.id,o.order_number,o.delivery_fee,o.status,o.delivery_address,o.pickup_address,o.route_distance_meters,o.route_duration_seconds,o.created_at,b.name as restaurant_name,c.name as customer_name from orders o join businesses b on b.id=o.business_id join customers c on c.id=o.customer_id where o.business_id=$1 and o.status='ACCEPTED' and not exists(select 1 from rider_trips t where t.order_id=o.id and t.completed_at is null) order by o.created_at asc`,[req.rider.business_id]),
    pool.query(`select o.*,c.name as customer_name,c.phone,c.email,t.id as trip_id,t.assigned_at,r.name as rider_name from rider_trips t join orders o on o.id=t.order_id join customers c on c.id=o.customer_id join riders r on r.id=t.rider_id where t.rider_id=$1 and t.completed_at is null order by t.assigned_at desc limit 1`,[id]),
    pool.query(`select o.order_number,o.delivery_address,o.delivery_fee,o.delivered_at,t.completed_at,t.assigned_at,extract(epoch from (t.completed_at-t.assigned_at))/60 as trip_minutes,coalesce(o.route_distance_meters,0) as distance_meters,coalesce(e.amount,0) as earning,e.status as earning_status from rider_trips t join orders o on o.id=t.order_id left join rider_earnings e on e.trip_id=t.id where t.rider_id=$1 and t.completed_at is not null order by t.completed_at desc limit 100`,[id]),
    pool.query(`select coalesce(sum(amount),0) as total from rider_earnings where rider_id=$1 and created_at::date=current_date and status in ('RELEASED','PAID')`,[id]),
    pool.query(`select coalesce(sum(amount),0) as total from rider_earnings where rider_id=$1 and created_at>=current_date-interval '6 days' and status in ('HELD','RELEASED','PAID')`,[id]),
    pool.query('select online from rider_presence where rider_id=$1',[id])
  ]);
  res.json({
    available:available.rows,
    active:active.rows[0]||null,
    completed:completed.rows,
    todayEarnings:Number(earnings.rows[0].total),
    weekEarnings:Number(weekly.rows[0].total),
    online:Boolean(presence.rows[0]?.online)
  });
});
app.post('/api/riders/:id/deliveries/:tripId/accept', requireRiderModule, requireRiderAuth, async(req,res)=>{
  const result=await pool.query(`select t.*,o.status as order_status,o.business_id,o.id as order_id from rider_trips t join orders o on o.id=t.order_id where t.id=$1 and t.rider_id=$2 for update`,[req.params.tripId,req.rider.id]);
  if(!result.rowCount) return res.status(404).json({error:'Delivery not found'});
  const trip=result.rows[0];
  if(trip.completed_at) return res.status(409).json({error:'Delivery already completed'});
  if(!['ACCEPTED','OUT_FOR_DELIVERY'].includes(String(trip.order_status||''))) return res.status(409).json({error:'This order is no longer awaiting rider acceptance'});
  const latest=await pool.query(`select status from delivery_events where trip_id=$1 order by created_at desc limit 1`,[trip.id]);
  const current=latest.rows[0]?.status||'ASSIGNED';
  if(current==='ACCEPTED'){
    const synced=await pool.query(`update orders set status=case when status='ACCEPTED' then 'OUT_FOR_DELIVERY' else status end,out_for_delivery_at=coalesce(out_for_delivery_at,now()),delivery_status='ACCEPTED' where id=$1 returning *`,[trip.order_id]);
    if(!synced.rowCount)return res.status(409).json({error:'Delivery is no longer active'});
    broadcastOrder(synced.rows[0],{reason:'rider.accepted.sync',notification:'Rider accepted the delivery'});
    return res.json({ok:true,status:'ACCEPTED',alreadyAccepted:true});
}
  if(current!=='ASSIGNED') return res.status(409).json({error:'Delivery has already been accepted or moved forward'});
  const updated=await pool.query(`update orders set status=case when status='ACCEPTED' then 'OUT_FOR_DELIVERY' else status end,out_for_delivery_at=coalesce(out_for_delivery_at,now()),delivery_status='ACCEPTED' where id=$1 and status in ('ACCEPTED','OUT_FOR_DELIVERY') returning *`,[trip.order_id]);
  if(!updated.rowCount) return res.status(409).json({error:'This order is no longer awaiting rider acceptance'});
  await pool.query(`insert into delivery_events(id,trip_id,status) values(gen_random_uuid(),$1,'ACCEPTED')`,[req.params.tripId]);
  broadcastOrder(updated.rows[0],{reason:'rider.accepted',notification:'Rider accepted the delivery'});
  broadcastRider({businessId:trip.business_id,riderId:req.rider.id,orderId:trip.order_id,action:'DELIVERY_ACCEPTED',data:{tripId:req.params.tripId,status:'ACCEPTED'}});
  broadcastRealtime({businessId:trip.business_id,orderId:trip.order_id,event:'delivery.updated',data:{orderId:trip.order_id,status:'ACCEPTED',riderId:req.rider.id}});
  res.json({ok:true,status:'ACCEPTED'});
});
async function createRiderRecipientAndPayout(rider, amount, tripId) {
  if (String(process.env.RIDER_AUTO_PAYOUT || 'false').toLowerCase() !== 'true') return {status:'HELD',reason:'RIDER_AUTO_PAYOUT is disabled'};
  const phone=normalizeKenyanPhone(rider.payout_phone||rider.phone);
  let recipientCode=rider.payout_recipient_code;
  if(!recipientCode){
    const recipient=await paystackRequest('/transferrecipient',{method:'POST',body:JSON.stringify({type:'mobile_money',name:rider.name,account_number:phone.replace('+254','0'),bank_code:'MPESA',currency:'KES'})});
    recipientCode=recipient.data?.recipient_code;
    if(!recipientCode) throw new Error('Paystack did not return an M-Pesa recipient code');
    await pool.query('update rider_auth set payout_recipient_code=$1 where rider_id=$2',[recipientCode,rider.id]);
  }
  const reference=`rider_${String(tripId).replace(/-/g,'').slice(0,40)}`;
  const transfer=await paystackRequest('/transfer',{method:'POST',body:JSON.stringify({source:'balance',amount:String(Math.round(Number(amount)*100)),currency:'KES',recipient:recipientCode,reference,reason:`Delivery earnings for trip ${tripId}`})});
  const data=transfer.data||{};
  await pool.query('update rider_earnings set payout_status=$1,payout_recipient_code=$2,payout_reference=$3,payout_transfer_code=$4,paid_at=case when $1=\'PAID\' then now() else null end,status=case when $1=\'PAID\' then \'PAID\' else status end where trip_id=$5',[String(data.status||'PENDING').toUpperCase()==='SUCCESS'?'PAID':'PENDING',recipientCode,reference,data.transfer_code||null,tripId]);
  return data;
}
async function updateDeliveryStatus(req,res,nextStatus){
  try{
    const result=await pool.query(`select t.*,o.status as order_status,o.id as order_id,o.business_id from rider_trips t join orders o on o.id=t.order_id where t.id=$1 and t.rider_id=$2 for update`,[req.params.tripId,req.rider.id]);
    if(!result.rowCount) return res.status(404).json({error:'Delivery not found'});
    const trip=result.rows[0];
    const allowed={ACCEPTED:['ARRIVED_AT_RESTAURANT'],ARRIVED_AT_RESTAURANT:['PICKED_UP'],PICKED_UP:['ON_THE_WAY'],ON_THE_WAY:['DELIVERED']} ;
    const last=await pool.query(`select status from delivery_events where trip_id=$1 order by created_at desc limit 1`,[trip.id]);
    const current=last.rows[0]?.status||'ASSIGNED';
    if(!allowed[current]?.includes(nextStatus)) return res.status(409).json({error:`Cannot move delivery from ${current} to ${nextStatus}`});
    await pool.query('insert into delivery_events(id,trip_id,status,note) values(gen_random_uuid(),$1,$2,$3)',[trip.id,nextStatus,req.body.note||null]);
    if(nextStatus==='DELIVERED'){
      const riderConnected=await getRiderConnectionState(trip.business_id);
      if(!riderConnected) return res.status(409).json({error:'Rider Dashboard is no longer connected for this restaurant'});
      await pool.query(`update orders set status='DELIVERED',delivered_at=coalesce(delivered_at,now()),delivery_status='DELIVERED',delivery_fee_status='RELEASED',delivery_fee_released_at=now() where id=$1`,[trip.order_id]);
      await pool.query(`update rider_trips set completed_at=now(),confirmed_by='rider' where id=$1`,[trip.id]);
      const earning=await pool.query(`insert into rider_earnings(id,rider_id,trip_id,amount,status,released_at) select gen_random_uuid(),rider_id,$1,delivery_fee,'RELEASED',now() from orders where id=$2 on conflict(trip_id) do update set status='RELEASED',released_at=now() returning *`,[trip.id,trip.order_id]);
      try {
        const rider=await pool.query('select r.*,a.payout_recipient_code from riders r left join rider_auth a on a.rider_id=r.id where r.id=$1',[req.rider.id]);
        await createRiderRecipientAndPayout(rider.rows[0],earning.rows[0].amount,trip.id);
      } catch (payoutError) {
        console.error('Rider payout queued/failed:',payoutError.message);
      }
      broadcastOrder((await pool.query('select * from orders where id=$1',[trip.order_id])).rows[0],{reason:'delivery.completed',notification:'Delivery completed'});
      broadcastRider({businessId:trip.business_id,riderId:req.rider.id,orderId:trip.order_id,action:'DELIVERY_COMPLETED',data:{tripId:trip.id,status:nextStatus,earning:earning.rows[0]}});
      return res.json({ok:true,status:nextStatus,earning:earning.rows[0]});
    }
    await pool.query('update orders set delivery_status=$1 where id=$2',[nextStatus,trip.order_id]);
    broadcastRider({businessId:trip.business_id,riderId:req.rider.id,orderId:trip.order_id,action:'DELIVERY_STATUS',data:{tripId:trip.id,status:nextStatus}});
    broadcastRealtime({businessId:trip.business_id,orderId:trip.order_id,event:'delivery.updated',data:{orderId:trip.order_id,status:nextStatus,riderId:req.rider.id}});
    res.json({ok:true,status:nextStatus});
  }catch(error){res.status(500).json({error:error.message||'Unable to update delivery'});}
}
for(const [route,status] of [['arrived','ARRIVED_AT_RESTAURANT'],['picked-up','PICKED_UP'],['on-the-way','ON_THE_WAY'],['delivered','DELIVERED']]){
  app.post(`/api/riders/:id/deliveries/:tripId/${route}`,requireRiderModule,requireRiderAuth,(req,res)=>updateDeliveryStatus(req,res,status));
}
app.get('/api/riders/:id/earnings',requireRiderModule,requireRiderAuth,async(req,res)=>{
  const result=await pool.query(`select e.*,o.order_number,o.delivery_address,o.delivered_at,o.route_distance_meters from rider_earnings e join rider_trips t on t.id=e.trip_id join orders o on o.id=t.order_id where e.rider_id=$1 order by e.created_at desc limit 200`,[req.rider.id]);
  res.json(result.rows);
});
app.get('/api/admin/riders',requireRiderModule,requireManager,async(req,res)=>{
  const businessId=String(req.query.businessId||''); if(!businessId) return res.status(400).json({error:'businessId is required'});
  const result=await pool.query(`select r.id,r.name,r.phone,r.email,r.vehicle_type,r.number_plate,r.profile_image_url,r.active,coalesce(p.online,false) as online,exists(select 1 from rider_trips t join orders o on o.id=t.order_id where t.rider_id=r.id and t.completed_at is null) as busy,count(t.id) filter(where t.completed_at is not null) as trip_count,(select max(t2.completed_at) from rider_trips t2 where t2.rider_id=r.id and t2.completed_at is not null) as last_completed_at,coalesce(sum(o.route_distance_meters),0) as distance_meters,coalesce(sum(e.amount),0) as earnings from riders r left join rider_presence p on p.rider_id=r.id left join rider_trips t on t.rider_id=r.id left join orders o on o.id=t.order_id left join rider_earnings e on e.trip_id=t.id where r.business_id=$1 group by r.id,p.online order by r.name`,[businessId]);
  res.json(result.rows.map(r=>({...r,available:r.active&&r.online&&!r.busy,distance_km:Number(r.distance_meters)/1000})));
});
app.get('/api/admin/riders/:id/trips',requireRiderModule,requireManager,async(req,res)=>{
  const result=await pool.query(`select t.id,t.assigned_at,t.completed_at,o.order_number,o.status,o.delivery_address,o.route_distance_meters,o.route_duration_seconds,o.delivery_fee,e.amount as rider_earning,e.status as earning_status
    from rider_trips t join riders r on r.id=t.rider_id join orders o on o.id=t.order_id
    left join rider_earnings e on e.trip_id=t.id
    where t.rider_id=$1 and r.business_id=$2 and o.business_id=$2
    order by t.assigned_at desc limit 200`,[req.params.id,req.manager.business_id]);
  res.json(result.rows);
});
async function getRiderConnectionState(businessId, client=pool){
  const result=await client.query(`
    select (
      coalesce(bc.rider_connected,false)
      and coalesce((p.features->>'riderModule')::boolean,false)
    ) as rider_connected
    from businesses b
    left join platform_packages p on p.key=b.plan_key
    left join business_connections bc on bc.business_id=b.id
    where b.id=$1
    limit 1
  `,[businessId]);
  return Boolean(result.rows[0]?.rider_connected);
}

async function createRiderTripAssignment(client,{businessId,orderId,riderId,riderConnected}){
  const riderResult=await client.query(`select r.*,coalesce(p.online,false) as online,
      exists(select 1 from rider_trips t join orders o on o.id=t.order_id where t.rider_id=r.id and t.completed_at is null) as busy
      from riders r left join rider_presence p on p.rider_id=r.id
      where r.id=$1 and r.business_id=$2 and r.active=true
        and (not $3::boolean or (coalesce(p.online,false)=true and p.location_updated_at >= now() - make_interval(secs => $4) and p.latitude between -90 and 90 and p.longitude between -180 and 180 and coalesce(p.accuracy_meters,999999) <= $5))
      for update of r`,[riderId,businessId,RIDER_GPS_REQUIRED_FOR_ASSIGNMENT,RIDER_GPS_FRESHNESS_SECONDS,RIDER_GPS_MAX_ACCURACY_METERS]);
  if(!riderResult.rowCount) throw Object.assign(new Error('Rider not found'),{status:404});
  const rider=riderResult.rows[0];
  if(!rider.online||rider.busy) throw Object.assign(new Error('Rider must be online and available'),{status:409});
  if(RIDER_GPS_REQUIRED_FOR_ASSIGNMENT && (!rider.latitude || !rider.longitude || !rider.location_updated_at)) throw Object.assign(new Error('Rider must have a recent GPS location before assignment'),{status:409});
  const existingTrip=await client.query(`select 1 from rider_trips where order_id=$1 and completed_at is null limit 1`,[orderId]);
  if(existingTrip.rowCount) throw Object.assign(new Error('A rider is already assigned to this order and is awaiting acceptance'),{status:409});
  const trip=await client.query('insert into rider_trips(id,rider_id,order_id) values(gen_random_uuid(),$1,$2) returning id',[riderId,orderId]);
  await client.query("insert into delivery_events(id,trip_id,status) values(gen_random_uuid(),$1,'ASSIGNED')",[trip.rows[0].id]);
  await client.query(`update orders
    set status=case when $2 then 'ACCEPTED' else 'OUT_FOR_DELIVERY' end,
        out_for_delivery_at=case when $2 then out_for_delivery_at else coalesce(out_for_delivery_at,now()) end,
        delivery_status='ASSIGNED',
        delivery_fee_status='HELD',
        rider_earning=delivery_fee
    where id=$1`,[orderId,riderConnected]);
  return {tripId:trip.rows[0].id,rider};
}

app.post('/api/orders/:id/assign-rider',requireRiderModule,requireManagerOrder,async(req,res)=>{
  const client=await pool.connect();
  try{
    const {riderId}=req.body;
    if(!riderId)return res.status(400).json({error:'riderId is required'});
    await client.query('begin');
    const orderResult=await client.query('select * from orders where id=$1 for update',[req.params.id]);
    if(!orderResult.rowCount){await client.query('rollback');return res.status(404).json({error:'Order not found'});}
    const order=orderResult.rows[0];
    if(order.status!=='ACCEPTED'){await client.query('rollback');return res.status(409).json({error:'Only accepted orders can be sent for delivery'});}
    const riderConnected=await getRiderConnectionState(order.business_id,client);
    if(!riderConnected){await client.query('rollback');return res.status(409).json({error:'Rider Dashboard must be connected before assigning a rider'});}
    const assignment=await createRiderTripAssignment(client,{businessId:order.business_id,orderId:order.id,riderId,riderConnected});
    await client.query('commit');
    const updatedOrder=(await pool.query('select * from orders where id=$1',[order.id])).rows[0];
    const notification=riderConnected?'Rider assigned — awaiting rider acceptance':'Rider assigned — delivery is now in progress';
    broadcastOrder(updatedOrder,{reason:'restaurant.rider_assigned',notification,riderConnected});
    broadcastRider({businessId:order.business_id,riderId,orderId:order.id,action:'DELIVERY_ASSIGNED',data:{tripId:assignment.tripId,status:'ASSIGNED',riderConnected}});
    sendRiderAssignmentSms({businessId:order.business_id,riderId,orderId:order.id}).catch(error=>console.error('Rider assignment SMS failed:',error.message));
    res.json({ok:true,tripId:assignment.tripId,riderConnected,trackingStatus:updatedOrder.status});
  }catch(error){
    try{await client.query('rollback')}catch{}
    res.status(error.status||500).json({error:error.message||'Unable to assign rider'});
  }finally{client.release();}
});

app.post('/api/orders/:id/cancel-rider-assignment',requireRiderModule,requireManagerOrder,async(req,res)=>{
  const client=await pool.connect();
  try{
    await client.query('begin');
    const orderResult=await client.query('select * from orders where id=$1 for update',[req.params.id]);
    if(!orderResult.rowCount){await client.query('rollback');return res.status(404).json({error:'Order not found'});}
    const order=orderResult.rows[0];
    const tripResult=await client.query(`select t.*,r.name as rider_name
      from rider_trips t join riders r on r.id=t.rider_id
      where t.order_id=$1 and t.completed_at is null
      order by t.assigned_at desc limit 1
      for update of t`,[order.id]);
    if(!tripResult.rowCount){await client.query('rollback');return res.status(404).json({error:'No active rider assignment'});}
    const trip=tripResult.rows[0];
    const latest=await client.query('select status from delivery_events where trip_id=$1 order by created_at desc limit 1',[trip.id]);
    const current=String(latest.rows[0]?.status||'ASSIGNED');
    if(!['ASSIGNED','ACCEPTED','ARRIVED_AT_RESTAURANT'].includes(current)){
      await client.query('rollback');
      return res.status(409).json({error:'This delivery can only be reassigned before the rider picks it up'});
    }
    await client.query("insert into delivery_events(id,trip_id,status,note) values(gen_random_uuid(),$1,'CANCELLED',$2)",[trip.id,'Assignment cancelled by restaurant manager']);
    await client.query("update rider_trips set completed_at=now(),confirmed_by='manager' where id=$1",[trip.id]);
    await client.query("update orders set status='ACCEPTED',delivery_status='REASSIGN_REQUIRED' where id=$1",[order.id]);
    await client.query('commit');
    const updated=(await pool.query('select * from orders where id=$1',[order.id])).rows[0];
    broadcastOrder(updated,{reason:'restaurant.rider_assignment_cancelled',notification:'Rider assignment cancelled — reassignment required'});
    broadcastRider({businessId:order.business_id,riderId:trip.rider_id,orderId:order.id,action:'DELIVERY_ASSIGNMENT_CANCELLED',data:{tripId:trip.id,status:'CANCELLED'}});
    res.json({ok:true,order:updated,previousRiderId:trip.rider_id});
  }catch(error){
    try{await client.query('rollback')}catch{}
    res.status(error.status||500).json({error:error.message||'Unable to cancel rider assignment'});
  }finally{client.release();}
});

app.post('/api/orders/:id/reassign-rider',requireRiderModule,requireManagerOrder,async(req,res)=>{
  const client=await pool.connect();
  try{
    const {riderId}=req.body;
    if(!riderId)return res.status(400).json({error:'riderId is required'});
    await client.query('begin');
    const orderResult=await client.query('select * from orders where id=$1 for update',[req.params.id]);
    if(!orderResult.rowCount){await client.query('rollback');return res.status(404).json({error:'Order not found'});}
    const order=orderResult.rows[0];
    const tripResult=await client.query(`select t.*,r.name as rider_name
      from rider_trips t join riders r on r.id=t.rider_id
      where t.order_id=$1 and t.completed_at is null
      order by t.assigned_at desc limit 1
      for update of t`,[order.id]);
    if(!tripResult.rowCount){await client.query('rollback');return res.status(409).json({error:'No active rider assignment to reassign'});}
    const oldTrip=tripResult.rows[0];
    if(String(oldTrip.rider_id)===String(riderId)){await client.query('rollback');return res.status(409).json({error:'Choose a different rider'});}
    const latest=await client.query('select status from delivery_events where trip_id=$1 order by created_at desc limit 1',[oldTrip.id]);
    const current=String(latest.rows[0]?.status||'ASSIGNED');
    if(!['ASSIGNED','ACCEPTED','ARRIVED_AT_RESTAURANT'].includes(current)){
      await client.query('rollback');
      return res.status(409).json({error:'This delivery can only be reassigned before the rider picks it up'});
    }
    const riderConnected=await getRiderConnectionState(order.business_id,client);
    await client.query("insert into delivery_events(id,trip_id,status,note) values(gen_random_uuid(),$1,'CANCELLED',$2)",[oldTrip.id,'Previous rider assignment replaced by manager']);
    await client.query("update rider_trips set completed_at=now(),confirmed_by='manager' where id=$1",[oldTrip.id]);
    const assignment=await createRiderTripAssignment(client,{businessId:order.business_id,orderId:order.id,riderId,riderConnected});
    await client.query('commit');
    const updated=(await pool.query('select * from orders where id=$1',[order.id])).rows[0];
    const notification=riderConnected?'Rider reassigned — awaiting new rider acceptance':'Rider reassigned — delivery remains in progress';
    broadcastOrder(updated,{reason:'restaurant.rider_reassigned',notification,riderConnected});
    broadcastRider({businessId:order.business_id,riderId:oldTrip.rider_id,orderId:order.id,action:'DELIVERY_REASSIGNED',data:{tripId:oldTrip.id,status:'CANCELLED'}});
    broadcastRider({businessId:order.business_id,riderId,orderId:order.id,action:'DELIVERY_ASSIGNED',data:{tripId:assignment.tripId,status:'ASSIGNED',riderConnected,reassigned:true}});
    sendRiderAssignmentSms({businessId:order.business_id,riderId,orderId:order.id}).catch(error=>console.error('Rider reassignment SMS failed:',error.message));
    res.json({ok:true,tripId:assignment.tripId,previousRiderId:oldTrip.rider_id,riderConnected,trackingStatus:updated.status});
  }catch(error){
    try{await client.query('rollback')}catch{}
    res.status(error.status||500).json({error:error.message||'Unable to reassign rider'});
  }finally{client.release();}
});

app.post('/api/riders/:id/deliveries/:tripId/decline',requireRiderModule,requireRiderAuth,async(req,res)=>{
  const client=await pool.connect();
  try{
    await client.query('begin');
    const result=await client.query(`select t.*,o.status as order_status,o.business_id,o.id as order_id
      from rider_trips t join orders o on o.id=t.order_id
      where t.id=$1 and t.rider_id=$2 and t.completed_at is null
      for update`,[req.params.tripId,req.rider.id]);
    if(!result.rowCount){await client.query('rollback');return res.status(404).json({error:'Delivery not found'});}
    const trip=result.rows[0];
    const latest=await client.query('select status from delivery_events where trip_id=$1 order by created_at desc limit 1',[trip.id]);
    const current=String(latest.rows[0]?.status||'ASSIGNED');
    if(current!=='ASSIGNED'){await client.query('rollback');return res.status(409).json({error:'You can only decline a delivery before accepting it'});}
    await client.query("insert into delivery_events(id,trip_id,status,note) values(gen_random_uuid(),$1,'DECLINED',$2)",[trip.id,String(req.body.note||'Rider declined the delivery')]);
    await client.query("update rider_trips set completed_at=now(),confirmed_by='rider' where id=$1",[trip.id]);
    await client.query("update orders set status='ACCEPTED',delivery_status='REASSIGN_REQUIRED' where id=$1",[trip.order_id]);
    await client.query('commit');
    const updated=(await pool.query('select * from orders where id=$1',[trip.order_id])).rows[0];
    broadcastOrder(updated,{reason:'rider.declined',notification:'Rider declined the delivery — reassignment required'});
    broadcastRider({businessId:trip.business_id,riderId:trip.rider_id,orderId:trip.order_id,action:'DELIVERY_DECLINED',data:{tripId:trip.id,status:'DECLINED'}});
    res.json({ok:true,status:'DECLINED'});
  }catch(error){
    try{await client.query('rollback')}catch{}
    res.status(error.status||500).json({error:error.message||'Unable to decline delivery'});
  }finally{client.release();}
});

app.get('/api/stations',requireManager,async(req,res)=>{
  try{
    const r=await pool.query('select id,business_id,name,device_type,mode,active,last_seen_at,created_at,updated_at from restaurant_order_stations where business_id=$1 order by active desc,last_seen_at desc',[req.manager.business_id]);
    res.json(r.rows);
  }catch(e){res.status(500).json({error:e.message||'Unable to load stations'});}
});
app.post('/api/stations',requireManager,requireManagerRole('OWNER'),async(req,res)=>{
  try{
    const {name,deviceType,mode}=req.body;
    if(!name||!['PHONE','TABLET','PC','LAPTOP','TV','BOARD'].includes(deviceType)||!['OPERATIONS','KITCHEN','COUNTER','DISPLAY'].includes(mode)) return res.status(400).json({error:'Invalid station configuration'});
    const r=await pool.query('insert into restaurant_order_stations(id,business_id,name,device_type,mode,active,last_seen_at,updated_at) values(gen_random_uuid(),$1,$2,$3,$4,true,now(),now()) returning *',[req.manager.business_id,String(name).trim(),deviceType,mode]);
    res.status(201).json(r.rows[0]);
  }catch(e){res.status(400).json({error:e.message||'Unable to create station'});}
});
app.post('/api/stations/:id/pairing-token',requireManagerStation,requireManagerRole('OWNER'),async(req,res)=>{
  try{
    const raw=crypto.randomBytes(32).toString('hex');
    await pool.query('update station_pairing_tokens set used_at=coalesce(used_at,now()) where station_id=$1 and used_at is null',[req.params.id]);
    await pool.query('insert into station_pairing_tokens(id,station_id,token_hash,expires_at) values(gen_random_uuid(),$1,$2,now()+interval \'5 minutes\')',[req.params.id,hashSessionToken(raw)]);
    const connectUrl=`${FRONTEND_URL.replace(/\/$/,'')}/connect-device.html?token=${encodeURIComponent(raw)}`;
    const qrDataUrl=await QRCode.toDataURL(connectUrl,{width:320,margin:2,errorCorrectionLevel:'M'});
    res.json({token:raw,connectUrl,qrDataUrl,expiresInSeconds:300});
  }catch(e){res.status(500).json({error:e.message||'Unable to create pairing code'});}
});
app.post('/api/stations/:id/revoke',requireManagerStation,requireManagerRole('OWNER'),async(req,res)=>{
  try{
    await pool.query('update restaurant_order_stations set active=false,updated_at=now() where id=$1',[req.params.id]);
    await pool.query('delete from station_sessions where station_id=$1',[req.params.id]);
    await pool.query('update station_pairing_tokens set used_at=coalesce(used_at,now()) where station_id=$1 and used_at is null',[req.params.id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message||'Unable to revoke station'});}
});
app.post('/api/stations/:id/reactivate',requireManagerStation,requireManagerRole('OWNER'),async(req,res)=>{
  try{await pool.query('update restaurant_order_stations set active=true,updated_at=now() where id=$1',[req.params.id]);res.json({ok:true});}
  catch(e){res.status(500).json({error:e.message||'Unable to reactivate station'});}
});
app.post('/api/station/pair',stationPairRateLimit,async(req,res)=>{
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma','no-cache');
  const client=await pool.connect();
  try{
    const token=String(req.body.token||'').trim();
    if(!token) return res.status(400).json({error:'Pairing token is required'});
    await client.query('begin');
    const r=await client.query(`select p.id,p.station_id,s.business_id,s.name,s.device_type,s.mode
      from station_pairing_tokens p join restaurant_order_stations s on s.id=p.station_id
      where p.token_hash=$1 and p.expires_at>now() and p.used_at is null and s.active=true for update`,[hashSessionToken(token)]);
    if(!r.rowCount){await client.query('rollback');return res.status(410).json({error:'This pairing code is expired, already used, or revoked'});}
    const row=r.rows[0];
    await client.query('update station_pairing_tokens set used_at=now() where id=$1',[row.id]);
    const sessionToken=crypto.randomBytes(32).toString('hex');
    await client.query('insert into station_sessions(id,station_id,token_hash,expires_at,last_seen_at) values(gen_random_uuid(),$1,$2,now()+make_interval(hours => $3),now())',[row.station_id,hashSessionToken(sessionToken),SESSION_TTLS.stationHours]);
    await client.query('update restaurant_order_stations set last_seen_at=now(),updated_at=now() where id=$1',[row.station_id]);
    await client.query('commit');
    res.json({token:sessionToken,expiresInSeconds:30*24*60*60,station:{id:row.station_id,businessId:row.business_id,name:row.name,deviceType:row.device_type,mode:row.mode}});
  }catch(e){try{await client.query('rollback')}catch{}res.status(500).json({error:e.message||'Unable to pair station'});}
  finally{client.release();}
});
app.get('/api/station/me',requireStation,(req,res)=>res.json({id:req.station.station_id,businessId:req.station.business_id,name:req.station.name,deviceType:req.station.device_type,mode:req.station.mode,active:req.station.active}));
app.post('/api/station/heartbeat',requireStation,async(req,res)=>{
  try{await pool.query('update station_sessions set last_seen_at=now() where id=$1',[req.station.id]);await pool.query('update restaurant_order_stations set last_seen_at=now() where id=$1',[req.station.station_id]);res.json({ok:true});}
  catch(e){res.status(500).json({error:e.message||'Unable to update station heartbeat'});}
});
app.post('/api/station/logout',requireStation,async(req,res)=>{
  try{await pool.query('delete from station_sessions where id=$1',[req.station.id]);res.json({ok:true});}
  catch(e){res.status(500).json({error:e.message||'Unable to disconnect station'});}
});
app.get('/api/station/orders',requireStation,async(req,res)=>{
  try{
    const result=await pool.query(`select o.id,o.business_id,o.order_number,o.status,o.payment_status,o.payment_method,o.total,o.created_at,o.delivery_note,c.name,c.phone,c.email,
      coalesce((select r.name from riders r join rider_trips t on t.rider_id=r.id where t.order_id=o.id order by t.assigned_at desc limit 1),'') as rider_name,
      coalesce((select r.vehicle_type from riders r join rider_trips t on t.rider_id=r.id where t.order_id=o.id order by t.assigned_at desc limit 1),'') as rider_vehicle,
      coalesce((select r.number_plate from riders r join rider_trips t on t.rider_id=r.id where t.order_id=o.id order by t.assigned_at desc limit 1),'') as rider_plate
      from orders o join customers c on c.id=o.customer_id where o.business_id=$1 order by o.created_at desc limit 200`,[req.station.business_id]);
    res.json(result.rows);
  }catch(e){res.status(500).json({error:e.message||'Unable to load station orders'});}
});
app.get('/api/station/riders',requireStation,async(req,res)=>{
  try{
    const result=await pool.query(`select r.id,r.name,r.phone,r.vehicle_type,r.number_plate,r.profile_image_url,r.active,
      coalesce(p.online,false) as online,
      exists(select 1 from rider_trips t where t.rider_id=r.id and t.completed_at is null) as busy,
      (select max(t.completed_at) from rider_trips t where t.rider_id=r.id and t.completed_at is not null) as last_completed_at,
      (select count(*) from rider_trips t where t.rider_id=r.id and t.completed_at is not null) as trip_count
      from riders r left join rider_presence p on p.rider_id=r.id where r.business_id=$1 order by r.name`,[req.station.business_id]);
    res.json(result.rows.map(r=>({...r,available:r.active&&r.online&&!r.busy})));
  }catch(e){res.status(500).json({error:e.message||'Unable to load station riders'});}
});
app.post('/api/station/orders/:id/status',requireStation,async(req,res)=>{
  try{
    if(!['OPERATIONS','COUNTER'].includes(req.station.mode)) return res.status(403).json({error:'This station mode cannot change order status'});
    const nextStatus=String(req.body.status||'').toUpperCase();
    if(nextStatus!=='ACCEPTED') return res.status(400).json({error:'Station can only accept a paid NEW order'});
    const orderResult=await pool.query('select * from orders where id=$1 and business_id=$2 for update',[req.params.id,req.station.business_id]);
    if(!orderResult.rowCount)return res.status(404).json({error:'Order not found'});
    const order=orderResult.rows[0];
    if(order.status!=='NEW'||order.payment_status!=='PAID')return res.status(409).json({error:'Only paid NEW orders can be accepted'});
    const updated=await pool.query(`update orders set status='ACCEPTED',accepted_at=coalesce(accepted_at,now()) where id=$1 returning *`,[order.id]);
    broadcastOrder(updated.rows[0],{reason:'station.accepted'});
    res.json(updated.rows[0]);
  }catch(e){res.status(500).json({error:e.message||'Unable to accept order'});}
});
app.post('/api/station/orders/:id/assign-rider',requireStation,async(req,res)=>{
  const client=await pool.connect();
  try{
    if(!['OPERATIONS','COUNTER'].includes(req.station.mode)) return res.status(403).json({error:'This station mode cannot dispatch riders'});
    const {riderId}=req.body;if(!riderId)return res.status(400).json({error:'riderId is required'});
    await client.query('begin');
    const orderResult=await client.query('select * from orders where id=$1 and business_id=$2 for update',[req.params.id,req.station.business_id]);
    if(!orderResult.rowCount){await client.query('rollback');return res.status(404).json({error:'Order not found'});}
    const order=orderResult.rows[0];if(order.status!=='ACCEPTED'){await client.query('rollback');return res.status(409).json({error:'Only accepted orders can be dispatched'});}
    const riderResult=await client.query(`select r.*,coalesce(p.online,false) as online,exists(select 1 from rider_trips t where t.rider_id=r.id and t.completed_at is null) as busy from riders r left join rider_presence p on p.rider_id=r.id where r.id=$1 and r.business_id=$2 and r.active=true for update of r`,[riderId,req.station.business_id]);
    if(!riderResult.rowCount){await client.query('rollback');return res.status(404).json({error:'Rider not found'});}
    const connectionResult=await client.query('select coalesce(rider_connected,false) as rider_connected from business_connections where business_id=$1',[req.station.business_id]);
    const riderConnected=Boolean(connectionResult.rows[0]?.rider_connected);
    if(riderConnected && (!riderResult.rows[0].online||riderResult.rows[0].busy)){
      await client.query('rollback');return res.status(409).json({error:'Rider must be online and available'});
    }
    const existingTrip=await client.query(`select 1 from rider_trips where order_id=$1 and completed_at is null limit 1`,[order.id]);
    if(existingTrip.rowCount){await client.query('rollback');return res.status(409).json({error:'A rider is already assigned to this order and is awaiting acceptance'});}
    const trip=await client.query('insert into rider_trips(id,rider_id,order_id) values(gen_random_uuid(),$1,$2) returning id',[riderId,order.id]);
    await client.query('insert into delivery_events(id,trip_id,status) values(gen_random_uuid(),$1,\'ASSIGNED\')',[trip.rows[0].id]);
    await client.query(`update orders set delivery_status='ASSIGNED',delivery_fee_status='HELD',rider_earning=delivery_fee where id=$1`,[order.id]);
    if(!riderConnected){
      await client.query(`update orders set status='OUT_FOR_DELIVERY',out_for_delivery_at=coalesce(out_for_delivery_at,now()),delivery_status='ASSIGNED' where id=$1`,[order.id]);
      await client.query(`insert into delivery_events(id,trip_id,status,note) values(gen_random_uuid(),$1,'ACCEPTED','External rider confirmed assignment')`,[trip.rows[0].id]);
    }
    await client.query('commit');
    const dispatchedOrder=(await pool.query('select * from orders where id=$1',[order.id])).rows[0];
    broadcastOrder(dispatchedOrder,riderConnected
      ? {reason:'station.rider_assigned',notification:'Rider assigned — awaiting rider acceptance'}
      : {reason:'station.external_rider_assigned',notification:'Delivery is on its way'});
    if(riderConnected){
      broadcastRider({businessId:order.business_id,riderId:riderId,orderId:order.id,action:'DELIVERY_ASSIGNED',data:{tripId:trip.rows[0].id,status:'ASSIGNED'}});
    }
    sendRiderAssignmentSms({businessId:order.business_id,riderId,orderId:order.id}).catch(error=>console.error('Rider assignment SMS failed:',error.message));
    res.json({ok:true,tripId:trip.rows[0].id,riderConnected});
  }catch(e){try{await client.query('rollback')}catch{}res.status(500).json({error:e.message||'Unable to dispatch rider'});}
  finally{client.release();}
});
app.post('/api/station/orders/:id/confirm-delivery',requireStation,async(req,res)=>{
  try{
    if(!['OPERATIONS','COUNTER'].includes(req.station.mode)) return res.status(403).json({error:'This station mode cannot confirm delivery'});
    const result=await completeOrderByConfirmation(req.params.id,'restaurant',{requireDisconnectedRiderDashboard:true});
    if(result.error) return res.status(result.status).json({error:result.error});
    res.json(result.order);
  }catch(error){res.status(500).json({error:error.message||'Unable to confirm delivery'});}
});
app.get('/api/station/events',async(req,res)=>{
  try{
    const access=await getRealtimeAccessToken(String(req.query.realtimeToken||'').trim());
    if(!access||access.scope!=='STATION')return res.status(401).json({error:'Realtime authorization required'});
    const client={res,businessId:String(access.business_id),stationId:String(access.station_id)};
    res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('Connection','keep-alive');res.flushHeaders?.();
    stationRealtimeClients.add(client);sendRealtime(client,'connected',{ok:true});
    const heartbeat=setInterval(()=>sendRealtime(client,'heartbeat',{at:new Date().toISOString()}),25000);
    req.on('close',()=>{clearInterval(heartbeat);stationRealtimeClients.delete(client);});
  }catch(error){res.status(500).json({error:'Unable to authorize station events'});}
});


function platformAdminFromToken(req) {
  const raw=String(req.headers.authorization||'');
  return raw.startsWith('Bearer ')?raw.slice(7).trim():'';
}
async function getPlatformAdmin(req) {
  const token=platformAdminFromToken(req);
  if(!token)return null;
  const r=await pool.query(`select a.*,s.id as session_id from platform_admin_sessions s join platform_admin_users a on a.id=s.admin_id where s.token_hash=$1 and s.expires_at>now() and a.active=true`,[hashSessionToken(token)]);
  return r.rows[0]||null;
}

async function issuePlatformAdminSession(adminId) {
  return createAuthSession('platform',adminId);
}
async function authenticatePlatformAdmin(email,password) {
  const normalizedEmail=String(email||'').trim().toLowerCase();
  const suppliedPassword=String(password||'');
  const configuredEmail=String(process.env.PLATFORM_ADMIN_EMAIL||'').trim().toLowerCase();
  const configuredPassword=String(process.env.PLATFORM_ADMIN_PASSWORD||'');
  if(!normalizedEmail||!suppliedPassword) return {error:'Email and password are required',status:400};
  if(!configuredEmail||!configuredPassword) return {error:'Platform owner credentials are not configured on the API',status:503};

  let result=await pool.query('select * from platform_admin_users where lower(email)=lower($1) and active=true',[normalizedEmail]);
  if(!result.rowCount){
    if(normalizedEmail!==configuredEmail||suppliedPassword!==configuredPassword) return {error:'Invalid platform owner login',status:401};
    const hash=hashManagerPassword(suppliedPassword);
    await pool.query(
      "insert into platform_admin_users(id,name,email,password_hash,role,active) values(gen_random_uuid(),$1,$2,$3,'PLATFORM_OWNER',true) on conflict(email) do nothing",
      [String(process.env.PLATFORM_ADMIN_NAME||'Platform Owner'),normalizedEmail,hash]
    );
    result=await pool.query('select * from platform_admin_users where lower(email)=lower($1) and active=true',[normalizedEmail]);
  }
  const admin=result.rows[0];
  if(!admin) return {error:'Invalid platform owner login',status:401};
  const envCredentialsMatch=Boolean(configuredEmail&&configuredPassword&&normalizedEmail===configuredEmail&&suppliedPassword===configuredPassword);
  if(!verifyManagerPassword(suppliedPassword,admin.password_hash)){
    if(!envCredentialsMatch) return {error:'Invalid platform owner login',status:401};
    await pool.query('update platform_admin_users set password_hash=$1 where id=$2',[hashManagerPassword(suppliedPassword),admin.id]);
  }
  return {admin};
}

async function requirePlatformAdmin(req,res,next){
  try{
    const admin=await getPlatformAdmin(req);
    if(!admin)return res.status(401).json({error:'Platform owner login required'});
    if(!['PLATFORM_OWNER','SUPPORT'].includes(String(admin.role||'').toUpperCase())) return res.status(403).json({error:'Platform admin role is not permitted'});
    req.platformAdmin=admin;next();
  }catch(e){res.status(500).json({error:'Unable to verify platform owner session'});}
}

function requirePlatformRole(...allowedRoles) {
  const roles = new Set(allowedRoles.map(role => String(role).toUpperCase()));
  return (req,res,next) => {
    const role=String(req.platformAdmin?.role||'').toUpperCase();
    if(!roles.has(role)) return res.status(403).json({error:'This platform role is not permitted to perform this action'});
    next();
  };
}

function requireControlRole(...allowedRoles) {
  const roles = new Set(allowedRoles.map(role => String(role).toUpperCase()));
  return (req,res,next) => {
    const role=String(req.controlAdmin?.role||'').toUpperCase();
    if(!roles.has(role)) return res.status(403).json({error:'This control-centre role is not permitted to perform this action'});
    next();
  };
}
async function recordPlatformAudit(adminId,businessId,action,note='',metadata={}){
  try{
    await pool.query('insert into platform_audit_events(id,admin_id,business_id,action,note,metadata) values(gen_random_uuid(),$1,$2,$3,$4,$5)',[adminId||null,businessId||null,String(action||'UNKNOWN'),String(note||''),metadata||{}]);
  }catch{}
}
async function ensurePlatformObservabilitySchema(){
  await pool.query(`
    create table if not exists platform_incidents (
      id uuid primary key default gen_random_uuid(),
      business_id uuid references businesses(id) on delete set null,
      source text not null default 'API',
      dashboard text,
      severity text not null default 'ERROR',
      status text not null default 'OPEN',
      fingerprint text not null,
      message text not null,
      stack text,
      url text,
      metadata jsonb not null default '{}'::jsonb,
      occurrences integer not null default 1,
      first_seen_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      resolved_at timestamptz,
      created_at timestamptz not null default now()
    );
    create unique index if not exists platform_incidents_fingerprint_idx on platform_incidents(fingerprint);
    create index if not exists platform_incidents_business_idx on platform_incidents(business_id,last_seen_at desc);
    create index if not exists platform_incidents_status_idx on platform_incidents(status,last_seen_at desc);
    create table if not exists telemetry_access_tokens (
      token_hash text primary key,
      scope text not null check (scope in ('MANAGER','RIDER','STATION','PLATFORM')),
      business_id uuid references businesses(id) on delete cascade,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    );
    create index if not exists telemetry_access_tokens_expiry_idx on telemetry_access_tokens(expires_at);
  `);
}


function platformSlug(value){
  return String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);
}
app.post('/api/platform/login', authRateLimit,async(req,res)=>{
  try{
    const auth=await authenticatePlatformAdmin(req.body.email,req.body.password);
    if(auth.error)return res.status(auth.status).json({error:auth.error});
    const token=await issuePlatformAdminSession(auth.admin.id);
    await pool.query('update platform_admin_users set last_login_at=now() where id=$1',[auth.admin.id]);
    await recordPlatformAudit(auth.admin.id,null,'PLATFORM_LOGIN','Platform owner signed in',{});
    res.json({token,admin:{id:auth.admin.id,name:auth.admin.name,email:auth.admin.email,role:auth.admin.role}});
  }catch(e){res.status(500).json({error:e.message||'Unable to sign in platform owner'});}
});
app.get('/api/platform/google/config',(req,res)=>res.json({clientId:String(process.env.GOOGLE_CLIENT_ID||'')}));

app.post('/api/platform/google',googleRateLimit,async(req,res)=>{
  try{
    const credential=String(req.body.credential||'').trim();
    const clientId=String(process.env.GOOGLE_CLIENT_ID||'').trim();
    const allowedEmail=String(process.env.PLATFORM_ADMIN_EMAIL||'').trim().toLowerCase();
    if(!clientId)return res.status(503).json({error:'Google sign-in is not configured on the server'});
    if(!allowedEmail)return res.status(503).json({error:'Platform owner email is not configured on the server'});
    if(!credential)return res.status(400).json({error:'Google credential is required'});
    const verify=await fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(credential));
    const profile=await verify.json().catch(()=>({}));
    if(!verify.ok||profile.aud!==clientId||profile.iss!=='https://accounts.google.com'||profile.email_verified!=='true')return res.status(401).json({error:'Google account could not be verified'});
    const email=String(profile.email||'').trim().toLowerCase();
    if(email!==allowedEmail)return res.status(403).json({error:'This Google account is not authorized for the platform owner account'});
    let result=await pool.query('select * from platform_admin_users where lower(email)=lower($1) and active=true',[email]);
    if(!result.rowCount){
      const name=String(profile.name||process.env.PLATFORM_ADMIN_NAME||'Platform Owner').trim()||'Platform Owner';
      const hash=hashManagerPassword(crypto.randomBytes(32).toString('hex'));
      await pool.query('insert into platform_admin_users(id,name,email,password_hash,active) values(gen_random_uuid(),$1,$2,$3,true) on conflict(email) do nothing',[name,email,hash]);
      result=await pool.query('select * from platform_admin_users where lower(email)=lower($1) and active=true',[email]);
    }
    const admin=result.rows[0];
    if(!admin)return res.status(403).json({error:'Platform owner account is not configured'});
    const token=await issuePlatformAdminSession(admin.id);
    await pool.query('update platform_admin_users set last_login_at=now() where id=$1',[admin.id]);
    res.json({token,admin:{id:admin.id,name:admin.name,email:admin.email}});
  }catch(e){res.status(500).json({error:e.message||'Unable to sign in with Google'});}
});
app.get('/api/platform/me',requirePlatformAdmin,(req,res)=>res.json({id:req.platformAdmin.id,name:req.platformAdmin.name,email:req.platformAdmin.email}));
app.post('/api/platform/logout',requirePlatformAdmin,async(req,res)=>{
  try{await pool.query('delete from platform_admin_sessions where id=$1',[req.platformAdmin.session_id]);res.json({ok:true});}
  catch(e){res.status(500).json({error:'Unable to sign out'});}
});
app.get('/api/platform/external-api-usage',requirePlatformAdmin,async(req,res)=>{
  try{
    const businessId=String(req.query.businessId||'').trim();
    const limit=Math.min(Math.max(Number(req.query.limit||100),1),500);
    const usage=await pool.query(`select u.business_id,b.name as business_name,u.provider,u.operation,u.period_type,u.period_key,u.request_count,u.updated_at
      from external_api_usage_buckets u join businesses b on b.id=u.business_id
      ${businessId?'where u.business_id=$1':''}
      order by u.updated_at desc limit ${businessId?'$2':'$1'}`,businessId?[businessId,limit]:[limit]);
    const alerts=await pool.query(`select a.*,b.name as business_name from external_api_usage_alerts a join businesses b on b.id=a.business_id
      ${businessId?'where a.business_id=$1':''}
      order by a.created_at desc limit ${businessId?'$2':'$1'}`,businessId?[businessId,limit]:[limit]);
    res.json({usage:usage.rows,alerts:alerts.rows,quotas:{
      googleRoutes:{daily:EXTERNAL_API_DAILY_ROUTE_QUOTA,monthly:EXTERNAL_API_MONTHLY_ROUTE_QUOTA},
      sms:{daily:EXTERNAL_API_DAILY_SMS_QUOTA,monthly:EXTERNAL_API_MONTHLY_SMS_QUOTA},
      alertPercent:EXTERNAL_API_ALERT_PERCENT
    }});
  }catch(e){res.status(500).json({error:e.message||'Unable to load external API usage'});}
});

app.get('/api/platform/packages',requirePlatformAdmin,async(req,res)=>{
  try{const r=await pool.query('select key,name,description,monthly_price_kes,active,features from platform_packages where active=true order by monthly_price_kes,key');res.json(r.rows);}
  catch(e){res.status(500).json({error:e.message||'Unable to load packages'});}
});

// Phase 6: platform-wide operations, observability and independent dashboard monitoring.
app.get('/api/platform/command-center',requirePlatformAdmin,async(req,res)=>{
  try{
    const [tenants,integrations,openIncidents]=await Promise.all([
      pool.query("select count(*)::int total,count(*) filter(where status='ACTIVE')::int active,count(*) filter(where status='SUSPENDED')::int suspended from businesses"),
      pool.query("select count(*)::int total,count(*) filter(where status='ACTIVE')::int active from business_integrations"),
      pool.query("select count(*)::int total,count(*) filter(where severity='CRITICAL')::int critical from platform_incidents where status='OPEN'")
    ]);
    res.json({
      checkedAt:new Date().toISOString(),
      tenants:tenants.rows[0],
      metrics:{
        activeIntegrations:integrations.rows[0].active,
        totalIntegrations:integrations.rows[0].total
      },
      incidents:openIncidents.rows[0],
      recentOrders:[],
      openIssues:[]
    });
  }catch(e){res.status(500).json({error:e.message||'Unable to load platform command centre'});}
});


app.get('/api/platform/system',requirePlatformAdmin,async(req,res)=>{
  try{
    const [audit,counts]=await Promise.all([
      pool.query("select action,note,created_at from platform_audit_events order by created_at desc limit 20"),
      pool.query("select (select count(*)::int from businesses) as restaurants, (select count(*)::int from platform_incidents where status='OPEN') as open_incidents, (select count(*)::int from business_integrations where status='ACTIVE') as active_integrations")
    ]);
    res.json({
      version:String(process.env.PLATFORM_VERSION||'2026.09.28-phase6'),
      apiEnvironment:String(process.env.NODE_ENV||'production'),
      node:String(process.version),
      counts:counts.rows[0],
      capabilities:{
        database:true,
        googleMaps:Boolean(String(process.env.GOOGLE_MAPS_API_KEY||'').trim()),
        sms:Boolean(String(process.env.AFRICASTALKING_USERNAME||'').trim()&&String(process.env.AFRICASTALKING_API_KEY||'').trim()),
        payments:Boolean(String(process.env.PAYSTACK_SECRET_KEY||'').trim())
      },
      recentActivity:audit.rows
    });
  }catch(e){res.status(500).json({error:e.message||'Unable to load system information'});}
});


app.get('/api/platform/businesses/:id/inspect',requirePlatformAdmin,async(req,res)=>{
  try{
    const id=req.params.id;
    const [b,health]=await Promise.all([
      pool.query("select b.id,b.name,b.slug,b.status,b.plan_key,b.website_url,b.domain,b.primary_color,b.created_at,coalesce(p.name,b.plan_key) as plan_name from businesses b left join platform_packages p on p.key=b.plan_key where b.id=$1",[id]),
      pool.query(`select b.status,
        exists(select 1 from business_branches where business_id=b.id and active=true) as branch,
        exists(select 1 from delivery_pricing_rules where business_id=b.id) as pricing,
        exists(select 1 from manager_users where business_id=b.id and active=true) as manager,
        exists(select 1 from business_connections where business_id=b.id) as connection,
        exists(select 1 from business_integrations where business_id=b.id and status='ACTIVE') as integration
        from businesses b where b.id=$1`,[id])
    ]);
    if(!b.rowCount)return res.status(404).json({error:'Restaurant not found'});
    const h=health.rows[0]||{},issues=[];
    for(const [key,label] of [['branch','MISSING_BRANCH'],['pricing','MISSING_PRICING'],['manager','MISSING_MANAGER'],['connection','MISSING_CONNECTION'],['integration','NO_ACTIVE_INTEGRATION']])if(!h[key])issues.push(label);
    res.json({restaurant:b.rows[0],health:{ok:issues.length===0,issues}});
  }catch(e){res.status(500).json({error:e.message||'Unable to inspect restaurant configuration'});}
});


app.get('/api/platform/orders',requirePlatformAdmin,async(req,res)=>{
  res.status(410).json({error:'Platform-wide order browsing has been removed. Use a documented dispute case with controlled evidence access.'});
});


app.get('/api/platform/riders',requirePlatformAdmin,async(req,res)=>{
  res.status(410).json({error:'Platform-wide rider browsing has been removed. Use a documented dispute case with controlled evidence access.'});
});


app.get('/api/platform/incidents',requirePlatformAdmin,async(req,res)=>{
  try{
    const limit=Math.min(Math.max(Number(req.query.limit||100),1),300);
    const status=String(req.query.status||'OPEN').toUpperCase();
    const params=[status,limit];
    const r=await pool.query(`select i.*,b.name as business_name
      from platform_incidents i left join businesses b on b.id=i.business_id
      where i.status=$1 order by case i.severity when 'CRITICAL' then 1 when 'ERROR' then 2 else 3 end,i.last_seen_at desc limit $2`,params);
    res.json(r.rows);
  }catch(e){res.status(500).json({error:e.message||'Unable to load platform incidents'});}
});

app.post('/api/platform/incidents/:id/resolve',requirePlatformAdmin,requirePlatformRole('PLATFORM_OWNER'),async(req,res)=>{
  try{
    const r=await pool.query("update platform_incidents set status='RESOLVED',resolved_at=now() where id=$1 returning *",[req.params.id]);
    if(!r.rowCount)return res.status(404).json({error:'Incident not found'});
    await recordPlatformAudit(req.platformAdmin.id,r.rows[0].business_id,'INCIDENT_RESOLVED','Platform owner resolved an incident',{incidentId:req.params.id});
    res.json(r.rows[0]);
  }catch(e){res.status(500).json({error:e.message||'Unable to resolve incident'});}
});

app.post('/api/telemetry-token',async(req,res)=>{
  try{
    const bearer=String(req.headers.authorization||'').startsWith('Bearer ')?String(req.headers.authorization).slice(7).trim():'';
    if(!bearer)return res.status(401).json({error:'Authentication required'});
    const scope=String(req.body?.scope||'').toUpperCase();
    if(scope==='MANAGER'){
      const manager=await getManagerFromSession({headers:{authorization:'Bearer '+bearer}});
      if(!manager)return res.status(401).json({error:'Manager login required'});
      return res.json({token:await issueTelemetryAccessToken({scope,businessId:manager.business_id}),expiresIn:600});
    }
    if(scope==='RIDER'){
      const rider=await getRiderFromSession({headers:{authorization:'Bearer '+bearer}});
      if(!rider)return res.status(401).json({error:'Rider login required'});
      return res.json({token:await issueTelemetryAccessToken({scope,businessId:rider.business_id}),expiresIn:600});
    }
    if(scope==='STATION'){
      const station=await getStationFromSession({headers:{authorization:'Bearer '+bearer}});
      if(!station)return res.status(401).json({error:'Station login required'});
      return res.json({token:await issueTelemetryAccessToken({scope,businessId:station.business_id}),expiresIn:600});
    }
    const platform=await getPlatformAdmin({headers:{authorization:'Bearer '+bearer}});
    if(!platform)return res.status(401).json({error:'Platform login required'});
    return res.json({token:await issueTelemetryAccessToken({scope:'PLATFORM'}),expiresIn:600});
  }catch(error){res.status(500).json({error:error.message||'Unable to create telemetry token'});}
});

app.post('/api/platform/telemetry',telemetryRateLimit,async(req,res)=>{
  try{
    const telemetryToken=String(req.headers.authorization||'').startsWith('Bearer ')?String(req.headers.authorization).slice(7).trim():'';
    const telemetryAccess=await getTelemetryAccessToken(telemetryToken);
    if(!telemetryAccess)return res.status(401).json({error:'Telemetry authorization required'});
    const message=String(req.body.message||'').trim().slice(0,1000);
    if(!message)return res.status(400).json({error:'Error message is required'});
    const requestedBusinessId=String(req.body.businessId||'').trim()||null;
    const businessId=telemetryAccess.scope==='PLATFORM' ? requestedBusinessId : (telemetryAccess.business_id ? String(telemetryAccess.business_id) : null);
    const source=String(req.body.source||'WEB').trim().slice(0,40)||'WEB';
    const dashboard=String(req.body.dashboard||'UNKNOWN').trim().slice(0,80)||'UNKNOWN';
    const severity=['INFO','WARN','ERROR','CRITICAL'].includes(String(req.body.severity||'ERROR').toUpperCase())?String(req.body.severity).toUpperCase():'ERROR';
    const rawUrl=String(req.body.url||'').trim().slice(0,500);
    let url='';
    if(rawUrl){
      try{ const parsed=new URL(rawUrl); if(!['http:','https:'].includes(parsed.protocol)) return res.status(400).json({error:'Invalid telemetry URL'}); url=parsed.toString(); }
      catch{return res.status(400).json({error:'Invalid telemetry URL'});}
    }
    const stack=String(req.body.stack||'').slice(0,5000);
    const raw=JSON.stringify({businessId,dashboard,source,message,url});
    const fingerprint=crypto.createHash('sha256').update(raw).digest('hex');
    const metadata={userAgent:String(req.headers['user-agent']||'').slice(0,500),reportedAt:new Date().toISOString()};
    const r=await pool.query(`insert into platform_incidents(business_id,source,dashboard,severity,status,fingerprint,message,stack,url,metadata)
      values($1,$2,$3,$4,'OPEN',$5,$6,$7,$8,$9)
      on conflict(fingerprint) do update set occurrences=platform_incidents.occurrences+1,last_seen_at=now(),severity=excluded.severity,stack=coalesce(excluded.stack,platform_incidents.stack),url=coalesce(excluded.url,platform_incidents.url),metadata=excluded.metadata,status='OPEN',resolved_at=null
      returning id`,[businessId,source,dashboard,severity,fingerprint,message,stack||null,url||null,metadata]);
    res.status(202).json({ok:true,incidentId:r.rows[0].id});
  }catch(e){res.status(202).json({ok:false});}
});

app.get('/api/platform/health',requirePlatformAdmin,async(req,res)=>{
  try{
    const started=Date.now();
    await pool.query('select 1');
    const [tenants,counts]=await Promise.all([
      pool.query(`select b.id,b.name,b.slug,b.status,b.plan_key,
        exists(select 1 from business_branches bb where bb.business_id=b.id and bb.active=true) as has_branch,
        exists(select 1 from delivery_pricing_rules dp where dp.business_id=b.id) as has_pricing,
        exists(select 1 from manager_users mu where mu.business_id=b.id and mu.active=true) as has_manager,
        exists(select 1 from business_connections bc where bc.business_id=b.id) as has_connection,
        exists(select 1 from business_integrations bi where bi.business_id=b.id and bi.status='ACTIVE') as has_integration,
        exists(select 1 from business_privacy_settings ps where ps.business_id=b.id and nullif(trim(ps.privacy_contact_email),'') is not null) as has_privacy_contact,
        coalesce((select ps.odpc_controller_status from business_privacy_settings ps where ps.business_id=b.id limit 1),'NOT_REVIEWED') as odpc_controller_status,
        coalesce((select ps.odpc_processor_status from business_privacy_settings ps where ps.business_id=b.id limit 1),'NOT_REVIEWED') as odpc_processor_status,
        coalesce((p.features->>'riderModule')::boolean,false) as package_rider,
        coalesce(bf.rider_module_enabled,false) as feature_rider
        from businesses b left join platform_packages p on p.key=b.plan_key left join business_features bf on bf.business_id=b.id order by b.created_at desc`),
      pool.query(`select
        (select count(*)::int from businesses) as restaurants,
        (select count(*)::int from businesses where status='ACTIVE') as active,
        (select count(*)::int from businesses b where not exists(select 1 from business_branches bb where bb.business_id=b.id and bb.active=true)) as missing_branches,
        (select count(*)::int from businesses b where not exists(select 1 from delivery_pricing_rules dp where dp.business_id=b.id)) as missing_pricing,
        (select count(*)::int from businesses b where not exists(select 1 from manager_users mu where mu.business_id=b.id and mu.active=true)) as missing_managers`)
    ]);
    const environment={database:true,googleMaps:Boolean(String(process.env.GOOGLE_MAPS_API_KEY||'').trim()),smsProvider:Boolean(String(process.env.AFRICASTALKING_USERNAME||'').trim() && String(process.env.AFRICASTALKING_API_KEY||'').trim()),payments:Boolean(String(process.env.PAYSTACK_SECRET_KEY||'').trim())};
    const tenantHealth=tenants.rows.map(t=>{
      const issues=[];
      if(!t.has_branch)issues.push('MISSING_BRANCH');
      if(!t.has_pricing)issues.push('MISSING_PRICING');
      if(!t.has_manager)issues.push('MISSING_MANAGER');
      if(!t.has_connection)issues.push('MISSING_CONNECTION');
      if(!t.has_integration)issues.push('NO_ACTIVE_INTEGRATION');
      if(!t.has_privacy_contact)issues.push('MISSING_PRIVACY_CONTACT');
      if(!['REGISTERED','NOT_REQUIRED'].includes(String(t.odpc_controller_status||'').toUpperCase()))issues.push('ODPC_CONTROLLER_NOT_CONFIRMED');
      if(!['REGISTERED','NOT_REQUIRED'].includes(String(t.odpc_processor_status||'').toUpperCase()))issues.push('ODPC_PROCESSOR_NOT_CONFIRMED');
      if(t.package_rider&&!t.feature_rider)issues.push('RIDER_FEATURE_MISMATCH');
      if(t.status!=='ACTIVE')issues.push('TENANT_SUSPENDED');
      return {id:t.id,name:t.name,slug:t.slug,status:t.status,planKey:t.plan_key,issues,ok:issues.length===0};
    });
    const critical=tenantHealth.filter(t=>t.status==='ACTIVE'&&!t.ok).map(t=>t.id);
    if(!environment.googleMaps)critical.push('GOOGLE_MAPS_NOT_CONFIGURED');
    if(!environment.smsProvider)critical.push('SMS_PROVIDER_NOT_CONFIGURED');
    res.json({ok:critical.length===0,checkedAt:new Date().toISOString(),responseMs:Date.now()-started,environment,counts:counts.rows[0],tenants:tenantHealth});
  }catch(e){
    res.status(503).json({ok:false,error:e.message||'Platform health check failed',environment:{database:false,googleMaps:Boolean(String(process.env.GOOGLE_MAPS_API_KEY||'').trim()),smsProvider:Boolean(String(process.env.AFRICASTALKING_USERNAME||'').trim() && String(process.env.AFRICASTALKING_API_KEY||'').trim()),payments:Boolean(String(process.env.PAYSTACK_SECRET_KEY||'').trim())}});
  }
});

app.get('/api/platform/businesses/:id/health',requirePlatformAdmin,async(req,res)=>{
  try{
    const r=await pool.query(`select b.id,b.name,b.slug,b.status,b.plan_key,
      exists(select 1 from business_branches bb where bb.business_id=b.id and bb.active=true) as has_branch,
      exists(select 1 from delivery_pricing_rules dp where dp.business_id=b.id) as has_pricing,
      exists(select 1 from manager_users mu where mu.business_id=b.id and mu.active=true) as has_manager,
      exists(select 1 from business_connections bc where bc.business_id=b.id) as has_connection,
      exists(select 1 from business_integrations bi where bi.business_id=b.id and bi.status='ACTIVE') as has_integration,
      exists(select 1 from business_privacy_settings ps where ps.business_id=b.id and nullif(trim(ps.privacy_contact_email),'') is not null) as has_privacy_contact,
      coalesce((select ps.odpc_controller_status from business_privacy_settings ps where ps.business_id=b.id limit 1),'NOT_REVIEWED') as odpc_controller_status,
      coalesce((select ps.odpc_processor_status from business_privacy_settings ps where ps.business_id=b.id limit 1),'NOT_REVIEWED') as odpc_processor_status,
      coalesce((p.features->>'riderModule')::boolean,false) as package_rider,
      coalesce(bf.rider_module_enabled,false) as feature_rider
      from businesses b left join platform_packages p on p.key=b.plan_key left join business_features bf on bf.business_id=b.id where b.id=$1 limit 1`,[req.params.id]);
    if(!r.rowCount)return res.status(404).json({error:'Restaurant not found'});
    const t=r.rows[0],issues=[];
    if(!t.has_branch)issues.push('MISSING_BRANCH');
    if(!t.has_pricing)issues.push('MISSING_PRICING');
    if(!t.has_manager)issues.push('MISSING_MANAGER');
    if(!t.has_connection)issues.push('MISSING_CONNECTION');
    if(!t.has_integration)issues.push('NO_ACTIVE_INTEGRATION');
    if(!t.has_privacy_contact)issues.push('MISSING_PRIVACY_CONTACT');
    if(!['REGISTERED','NOT_REQUIRED'].includes(String(t.odpc_controller_status||'').toUpperCase()))issues.push('ODPC_CONTROLLER_NOT_CONFIRMED');
    if(!['REGISTERED','NOT_REQUIRED'].includes(String(t.odpc_processor_status||'').toUpperCase()))issues.push('ODPC_PROCESSOR_NOT_CONFIRMED');
    if(t.package_rider&&!t.feature_rider)issues.push('RIDER_FEATURE_MISMATCH');
    res.json({ok:issues.length===0,restaurant:{id:t.id,name:t.name,slug:t.slug,status:t.status,planKey:t.plan_key},issues,checkedAt:new Date().toISOString()});
  }catch(e){res.status(500).json({error:e.message||'Tenant health check failed'});}
});

app.get('/api/platform/audit',requirePlatformAdmin,async(req,res)=>{
  try{
    const limit=Math.min(Math.max(Number(req.query.limit||50),1),200);
    const r=await pool.query(`select ae.id,ae.action,ae.note,ae.metadata,ae.created_at,a.name as admin_name,b.name as business_name
      from platform_audit_events ae left join platform_admin_users a on a.id=ae.admin_id left join businesses b on b.id=ae.business_id
      order by ae.created_at desc limit $1`,[limit]);
    res.json(r.rows);
  }catch(e){res.status(500).json({error:e.message||'Unable to load platform audit'});}
});

app.get('/api/platform/overview',requirePlatformAdmin,async(req,res)=>{
  try{
    const b=await pool.query("select count(*)::int as restaurants,count(*) filter(where status='ACTIVE')::int as active from businesses");
    res.json({restaurants:b.rows[0].restaurants,active:b.rows[0].active});
  }catch(e){res.status(500).json({error:e.message||'Unable to load platform overview'});}
});


app.get('/api/platform/businesses',requirePlatformAdmin,async(req,res)=>{
  try{
    const r=await pool.query(`select b.id,b.name,b.slug,b.status,b.plan_key,b.domain,b.website_url,b.logo_url,b.primary_color,b.created_at,
      coalesce(p.name,b.plan_key,'STARTER') as plan_name,
      exists(select 1 from business_integrations bi where bi.business_id=b.id and bi.status='ACTIVE') as integration_active
      from businesses b left join platform_packages p on p.key=b.plan_key
      order by b.created_at desc`);
    res.json(r.rows);
  }catch(e){res.status(500).json({error:e.message||'Unable to load tenant registry'});}
});


app.post('/api/platform/businesses',requirePlatformAdmin,requirePlatformRole('PLATFORM_OWNER'),async(req,res)=>{
  const client=await pool.connect();
  try{
    const name=String(req.body.name||'').trim();
    const slug=platformSlug(req.body.slug||name);
    const address=String(req.body.address||'').trim();
    const planKey=String(req.body.planKey||'STARTER').trim().toUpperCase();
    const domain=String(req.body.domain||'').trim()||null;
    const primaryColor=String(req.body.primaryColor||'').trim()||null;
    const websiteUrl=String(req.body.websiteUrl||'').trim()||null;
    if(!name||!slug||!address)return res.status(400).json({error:'Restaurant name, slug and pickup address are required'});
    const pkg=await client.query('select key,features from platform_packages where key=$1 and active=true',[planKey]);
    if(!pkg.rowCount)return res.status(400).json({error:'Unknown or inactive package'});
    await client.query('begin');
    const business=await client.query(`insert into businesses(id,name,slug,status,plan_key,domain,primary_color,pickup_address,updated_at)
      values(gen_random_uuid(),$1,$2,'ACTIVE',$3,$4,$5,$6,$7,now()) returning *`,[name,slug,planKey,domain,websiteUrl,primaryColor,address]);
    const b=business.rows[0];
    await client.query('insert into business_features(business_id,rider_module_enabled) values($1,$2)',[b.id,Boolean(pkg.rows[0].features?.riderModule)]);
    await client.query('insert into delivery_pricing_rules(business_id) values($1) on conflict(business_id) do nothing',[b.id]);
    await client.query('insert into business_branches(id,business_id,name,address,latitude,longitude,active,accepting_orders) values(gen_random_uuid(),$1,$2,$3,-1.286389,36.817223,true,true)',[b.id,'Main Branch',address]);
    for(const [category,sort] of [['Mains',10],['Sides',20],['Drinks',30],['Desserts',40]]) await client.query('insert into menu_categories(id,business_id,name,sort_order) values(gen_random_uuid(),$1,$2,$3)',[b.id,category,sort]);
    await client.query('commit');
    await recordPlatformAudit(req.platformAdmin.id,b.id,'TENANT_CREATED','Restaurant tenant provisioned',{planKey,websiteUrl,domain});
    res.status(201).json({id:b.id,name:b.name,slug:b.slug,status:b.status,planKey});
  }catch(e){try{await client.query('rollback')}catch{}res.status(400).json({error:e.message||'Unable to provision restaurant'});}
  finally{client.release();}
});
app.patch('/api/platform/businesses/:id',requirePlatformAdmin,requirePlatformRole('PLATFORM_OWNER'),async(req,res)=>{
  try{
    const current=await pool.query('select * from businesses where id=$1',[req.params.id]);
    if(!current.rowCount)return res.status(404).json({error:'Restaurant not found'});
    const sets=[],vals=[];
    const add=(col,val)=>{sets.push(col+'=$'+(vals.length+1));vals.push(val)};
    if(req.body.name!==undefined){const v=String(req.body.name||'').trim();if(v)add('name',v);}
    if(req.body.domain!==undefined){
      await requireFeature('customDomain',req.params.id);
      add('domain',String(req.body.domain||'').trim()||null);
    }
    if(req.body.websiteUrl!==undefined)add('website_url',String(req.body.websiteUrl||'').trim()||null);
    if(req.body.logoUrl!==undefined)add('logo_url',String(req.body.logoUrl||'').trim()||null);
    if(req.body.primaryColor!==undefined)add('primary_color',String(req.body.primaryColor||'').trim()||null);
    if(req.body.status!==undefined){const v=String(req.body.status).toUpperCase();if(!['ACTIVE','SUSPENDED'].includes(v))return res.status(400).json({error:'Invalid tenant status'});add('status',v);}
    let plan=null;
    if(req.body.planKey!==undefined){
      const key=String(req.body.planKey||'').toUpperCase();
      const p=await pool.query('select key,features from platform_packages where key=$1 and active=true',[key]);
      if(!p.rowCount)return res.status(400).json({error:'Unknown or inactive package'});
      add('plan_key',key);plan=p.rows[0];
    }
    if(!sets.length)return res.status(400).json({error:'No changes supplied'});
    vals.push(req.params.id);
    const updated=await pool.query(`update businesses set ${sets.join(',')},updated_at=now() where id=${vals.length} returning *`,vals);
    if(plan)await pool.query('insert into business_features(business_id,rider_module_enabled) values($1,$2) on conflict(business_id) do update set rider_module_enabled=excluded.rider_module_enabled,updated_at=now()',[req.params.id,Boolean(plan.features?.riderModule)]);
    res.json(updated.rows[0]);
  }catch(e){res.status(400).json({error:e.message||'Unable to update restaurant'});}
});


app.post('/api/control/login',authRateLimit,async(req,res)=>{
  try{
    const auth=await authenticatePlatformAdmin(req.body.email,req.body.password);
    if(auth.error)return res.status(auth.status).json({error:auth.error});
    const token=await issuePlatformAdminSession(auth.admin.id);
    await pool.query('update platform_admin_users set last_login_at=now() where id=$1',[auth.admin.id]);
    await recordPlatformAudit(auth.admin.id,null,'PLATFORM_LOGIN','Platform control centre signed in',{});
    res.json({token,admin:{id:auth.admin.id,name:auth.admin.name,email:auth.admin.email,role:auth.admin.role}});
  }catch(e){res.status(500).json({error:e.message||'Unable to sign in to control centre'});}
});
app.get('/api/control/me',requireControl,(req,res)=>res.json({id:req.controlAdmin.id,name:req.controlAdmin.name,email:req.controlAdmin.email}));
app.post('/api/control/logout',requireControl,async(req,res)=>{
  const raw=String(req.headers.authorization||'');const token=raw.startsWith('Bearer ')?raw.slice(7).trim():'';
  if(token)await pool.query('delete from platform_admin_sessions where token_hash=$1',[hashSessionToken(token)]);
  res.json({ok:true});
});
app.get('/api/control/businesses',requireControl,async(req,res)=>{
  try{
    const r=await pool.query(`select b.id,b.name,b.slug,b.plan_key,b.mpesa_phone,b.paystack_subaccount_code,b.created_at,
      coalesce(c.customer_connected,false) as customer_connected,coalesce(c.rider_connected,false) as rider_connected,
      c.website_url,c.customer_dashboard_url,c.manager_dashboard_url,c.rider_dashboard_url,
      rb.logo_url,rb.primary_color,rb.secondary_color,rb.accent_color,rb.font_family,rb.imported_at,
      coalesce(f.rider_module_enabled,false) as rider_module_enabled,
      (select count(*) from orders o where o.business_id=b.id)::int as order_count
      from businesses b left join business_connections c on c.business_id=b.id left join business_features f on f.business_id=b.id left join restaurant_branding rb on rb.business_id=b.id
      order by b.created_at desc`);
    res.json({businesses:r.rows});
  }catch(e){res.status(500).json({error:e.message||'Unable to load businesses'});}
});
function cleanControlUrl(value){
  const v=String(value||'').trim();
  if(!v)return null;
  try{const u=new URL(v);if(!['http:','https:'].includes(u.protocol))throw new Error();return u.toString();}catch{throw new Error('Website URL must be a valid http or https URL');}
}
async function saveBusinessConnection(businessId,{websiteUrl,customerConnected,riderConnected}){
  const web=cleanControlUrl(websiteUrl);
  const customer=Boolean(customerConnected),rider=Boolean(riderConnected);
  const customerUrl=`${FRONTEND_URL.replace(/\/$/,'')}/menu.html?businessId=${encodeURIComponent(businessId)}`;
  const managerUrl=`${FRONTEND_URL.replace(/\/$/,'')}/manager.html?businessId=${encodeURIComponent(businessId)}`;
  const riderUrl=`${FRONTEND_URL.replace(/\/$/,'')}/rider.html?businessId=${encodeURIComponent(businessId)}`;
  await pool.query(`insert into business_connections(business_id,website_url,customer_dashboard_url,manager_dashboard_url,rider_dashboard_url,customer_connected,rider_connected,updated_at)
    values($1,$2,$3,$4,$5,$6,$7,now())
    on conflict(business_id) do update set website_url=excluded.website_url,customer_dashboard_url=excluded.customer_dashboard_url,manager_dashboard_url=excluded.manager_dashboard_url,rider_dashboard_url=excluded.rider_dashboard_url,customer_connected=excluded.customer_connected,rider_connected=excluded.rider_connected,updated_at=now()`,
    [businessId,web,customerUrl,managerUrl,riderUrl,customer,rider]);
  const entitlement=await pool.query(`select coalesce((p.features->>'riderModule')::boolean,false) as rider_module_enabled
      from businesses b left join platform_packages p on p.key=b.plan_key where b.id=$1 limit 1`,[businessId]);
  const riderEntitled=Boolean(entitlement.rowCount && entitlement.rows[0].rider_module_enabled);
  await pool.query(`insert into business_features(business_id,rider_module_enabled) values($1,$2) on conflict(business_id) do update set rider_module_enabled=$2,updated_at=now()`,[businessId,riderEntitled]);
  return {websiteUrl:web,customerDashboardUrl:customerUrl,managerDashboardUrl:managerUrl,riderDashboardUrl:riderUrl,customerConnected:customer,riderConnected:rider};
}
app.post('/api/control/businesses',requireControl,requireControlRole('PLATFORM_OWNER'),async(req,res)=>{
  const client=await pool.connect();
  try{
    const name=String(req.body.name||'').trim(),slug=String(req.body.slug||'').trim().toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');
    const planKey=String(req.body.planKey||req.body.packageType||'STARTER').toUpperCase();
    if(!name||!slug)return res.status(400).json({error:'Restaurant name and slug are required'});
    const pkg=await client.query('select key,features from platform_packages where key=$1 and active=true',[planKey]);
    if(!pkg.rowCount)return res.status(400).json({error:'Unknown or inactive package'});
    await client.query('begin');
    const r=await client.query('insert into businesses(id,name,slug,plan_key,mpesa_phone,paystack_subaccount_code) values(gen_random_uuid(),$1,$2,$3,$4,$5) returning *',[name,slug,planKey,String(req.body.mpesaPhone||'').trim()||null,String(req.body.paystackSubaccountCode||'').trim()||null]);
    const business=r.rows[0];
    await client.query('insert into delivery_pricing_rules(business_id) values($1) on conflict(business_id) do nothing',[business.id]);
    await client.query('insert into business_features(business_id,rider_module_enabled) values($1,$2) on conflict(business_id) do update set rider_module_enabled=$2,updated_at=now()',[business.id,Boolean(req.body.riderConnected)]);
    await client.query('insert into business_connections(business_id) values($1) on conflict(business_id) do nothing',[business.id]);
    await client.query('commit');
    const connection=await saveBusinessConnection(business.id,req.body);
    res.status(201).json({business:{...business,...connection},connection});
  }catch(e){try{await client.query('rollback')}catch{}res.status(400).json({error:e.code==='23505'?'That restaurant slug already exists':e.message||'Unable to create restaurant'});}finally{client.release();}
});
app.patch('/api/control/businesses/:id',requireControl,requireControlRole('PLATFORM_OWNER'),async(req,res)=>{
  try{
    const id=String(req.params.id),name=String(req.body.name||'').trim(),slug=String(req.body.slug||'').trim().toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');
    const planKey=String(req.body.planKey||req.body.packageType||'STARTER').toUpperCase();
    if(!name||!slug)return res.status(400).json({error:'Invalid restaurant configuration'});
    const pkg=await pool.query('select key,features from platform_packages where key=$1 and active=true',[planKey]);
    if(!pkg.rowCount)return res.status(400).json({error:'Unknown or inactive package'});
    const r=await pool.query('update businesses set name=$1,slug=$2,plan_key=$3,mpesa_phone=$4,paystack_subaccount_code=$5,updated_at=now() where id=$6 returning *',[name,slug,planKey,String(req.body.mpesaPhone||'').trim()||null,String(req.body.paystackSubaccountCode||'').trim()||null,id]);
    if(!r.rowCount)return res.status(404).json({error:'Restaurant not found'});
    const connection=await saveBusinessConnection(id,req.body);
    res.json({business:{...r.rows[0],...connection},connection});
  }catch(e){res.status(400).json({error:e.code==='23505'?'That restaurant slug already exists':e.message||'Unable to update restaurant'});}
});
app.get('/api/control/businesses/:id/status',requireControl,async(req,res)=>{
  try{
    const id=String(req.params.id);
    const [b,f,branches,connections,manager,riders]=await Promise.all([
      pool.query('select id,name,slug,plan_key,mpesa_phone,paystack_subaccount_code from businesses where id=$1',[id]),
      pool.query('select rider_module_enabled from business_features where business_id=$1',[id]),
      pool.query('select count(*)::int as count from business_branches where business_id=$1 and active=true',[id]),
      pool.query('select * from business_connections where business_id=$1',[id]),
      pool.query('select count(*)::int as count from manager_users where business_id=$1 and active=true',[id]),
      pool.query('select count(*)::int as count from riders where business_id=$1',[id])
    ]);
    if(!b.rowCount)return res.status(404).json({error:'Restaurant not found'});
    res.json({business:b.rows[0],riderModule:Boolean(f.rows[0]?.rider_module_enabled),branches:branches.rows[0].count,connections:connections.rows[0]||null,managerUsers:manager.rows[0].count,riders:riders.rows[0].count});
  }catch(e){res.status(500).json({error:e.message||'Unable to load restaurant status'});}
});
registerBrandingEngine(app,pool,{requireControl,requireManager,broadcastRealtime});
registerReceiptEngine(app,pool,{requireManager});
registerDeliveryEngine(app,pool,requireManager,quoteRateLimit,quoteBusinessRateLimit);
registerMenuEngine(app,pool,requireManager,broadcastRealtime);
registerPosEngine(app,pool,{requireManager,broadcastRealtime});
registerCustomerGrowth(app,pool);
registerAdvancedOperations(app,pool);
registerIntelligence(app,pool);
registerProductionObservability(app,pool,{requirePlatformAdmin,requirePlatformRole,recordSystemIncident});
registerComplianceRoutes(app,pool,{FRONTEND_URL,requireManager,requireManagerRole,requirePlatformAdmin,requirePlatformRole,recordPlatformAudit,recordSystemIncident});
registerControlDataIsolation(app,pool,{requireControl,requireControlRole,recordPlatformAudit});


function integrationTypeLabel(type){
  return ({
    ORDER_BUTTON:'Order button',
    EMBEDDED_MENU:'Embedded menu',
    FULL_ORDERING_PAGE:'Full ordering page',
    FULL_ORDERING_SUBDOMAIN:'Full ordering subdomain'
  })[type]||type;
}
function integrationCustomerUrl(businessId){
  return `${FRONTEND_URL.replace(/\/$/,'')}/menu.html?businessId=${encodeURIComponent(businessId)}`;
}

app.post('/api/platform/businesses/:id/integration',requirePlatformAdmin,requirePlatformRole('PLATFORM_OWNER'),async(req,res)=>{
  try{
    const business=await pool.query('select id,name,slug,domain,website_url,primary_color,status from businesses where id=$1',[req.params.id]);
    if(!business.rowCount)return res.status(404).json({error:'Restaurant not found'});
    const type=String(req.body.type||'').toUpperCase();
    const allowed=['ORDER_BUTTON','EMBEDDED_MENU','FULL_ORDERING_PAGE','FULL_ORDERING_SUBDOMAIN'];
    if(!allowed.includes(type))return res.status(400).json({error:'Invalid integration type'});
    if(business.rows[0].status!=='ACTIVE')return res.status(400).json({error:'Activate the restaurant before generating an integration'});
    await ensureIntegrationSchema();
  await ensureSharedSecuritySchema();
    const token=crypto.randomBytes(24).toString('hex');
    const tokenHash=hashSessionToken(token);
    await pool.query(`insert into business_integrations(id,business_id,integration_type,status,public_token_hash,generated_at,revoked_at,updated_at)
      values(gen_random_uuid(),$1,$2,'ACTIVE',$3,now(),null,now())
      on conflict(business_id) do update set integration_type=excluded.integration_type,status='ACTIVE',public_token_hash=excluded.public_token_hash,generated_at=now(),revoked_at=null,updated_at=now()`,
      [req.params.id,type,tokenHash]);
    const b=business.rows[0];
    const customerUrl=integrationCustomerUrl(b.id);
    const apiOrigin=`${req.protocol}://${req.get('host')}`;
    const connectorUrl=`${apiOrigin}/api/public/integrations/${token}.js`;
    const domain=String(b.domain||'').trim();
    const subdomainUrl=domain?(`https://${domain}`):null;
    const dnsTarget=process.env.ORDERING_CUSTOM_DOMAIN_TARGET||'restaurant-ordering-platform.onrender.com';
    const response={
      type,
      typeLabel:integrationTypeLabel(type),
      status:'ACTIVE',
      token,
      connectorUrl,
      customerUrl,
      subdomainUrl,
      websiteUrl:b.website_url||null,
      domain:domain||null,
      instructions: type==='ORDER_BUTTON'
        ? ['Keep your existing website button/link. Add data-restaurant-order to that element.','Paste the generated connector script before the closing </body> tag.','The connector will route that button to this restaurant’s ordering page.']
        : type==='EMBEDDED_MENU'
        ? ['Add the generated iframe where the restaurant wants its ordering menu.','The menu, cart and checkout remain powered by this tenant.','No restaurant menu data is copied into the website code.']
        : type==='FULL_ORDERING_PAGE'
        ? ['Use the generated customer ordering URL as the restaurant’s Order Online destination.','The existing website can keep all of its other pages unchanged.']
        : ['Use the requested restaurant subdomain for the ordering experience.','Add the subdomain to the ordering frontend hosting service and configure DNS.','After DNS verification, the ordering page will be available on that subdomain.'],
      code: type==='ORDER_BUTTON'
        ? `<script src="${connectorUrl}" defer></script>`
        : type==='EMBEDDED_MENU'
        ? `<iframe src="${customerUrl}" title="${b.name} ordering" style="width:100%;min-height:900px;border:0" loading="lazy"></iframe>`
        : customerUrl,
      dns: type==='FULL_ORDERING_SUBDOMAIN' && domain ? {host:domain,target:dnsTarget,note:'The DNS target is deployment-specific. Add/verify the custom domain on the ordering frontend before switching customer traffic.'} : null
    };
    res.json(response);
  }catch(e){res.status(500).json({error:e.message||'Unable to generate website integration'});}
});
app.get('/api/platform/businesses/:id/integration',requirePlatformAdmin,async(req,res)=>{
  try{
    await ensureIntegrationSchema();
    const r=await pool.query('select integration_type,status,generated_at,revoked_at from business_integrations where business_id=$1',[req.params.id]);
    if(!r.rowCount)return res.json({configured:false});
    res.json({configured:true,...r.rows[0]});
  }catch(e){res.status(500).json({error:e.message||'Unable to load integration'});}
});
app.delete('/api/platform/businesses/:id/integration',requirePlatformAdmin,requirePlatformRole('PLATFORM_OWNER'),async(req,res)=>{
  try{
    await ensureIntegrationSchema();
    await pool.query(`update business_integrations set status='REVOKED',revoked_at=now(),updated_at=now() where business_id=$1`,[req.params.id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message||'Unable to revoke integration'});}
});

app.get('/api/public/integrations/:token.js',(req,res)=>{
  (async()=>{
    try{
      await ensureIntegrationSchema();
      const token=String(req.params.token||'').trim();
      const r=await pool.query(`select bi.integration_type,b.id,b.name,b.status,b.primary_color
        from business_integrations bi join businesses b on b.id=bi.business_id
        where bi.public_token_hash=$1 and bi.status='ACTIVE' and b.status='ACTIVE'`,[hashSessionToken(token)]);
      if(!r.rowCount)return res.status(404).type('application/javascript').send('/* Integration not found or revoked. */');
      const b=r.rows[0];
      await requireFeature('apiIntegrations',b.id);
      const menuUrl=integrationCustomerUrl(b.id);
      const jsCode=`(function(){
  var menuUrl=${JSON.stringify(menuUrl)};
  function wire(){
    document.querySelectorAll('[data-restaurant-order],[data-restaurant-menu]').forEach(function(el){
      if(el.dataset.restaurantOrderingBound==='true')return;
      el.dataset.restaurantOrderingBound='true';
      if(el.tagName==='A')el.setAttribute('href',menuUrl);
      el.addEventListener('click',function(event){
        if(el.tagName!=='A')event.preventDefault();
        window.location.href=menuUrl;
      });
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
  window.addEventListener('load',wire);
})();`;
      res.type('application/javascript').set('Cache-Control','no-store').send(jsCode);
    }catch(e){res.status(500).type('application/javascript').send(`/* Integration error: ${String(e.message||'unknown').replace(/\*\//g,'')} */`);}
  })();
});

async function recordSystemIncident({businessId=null,source='SYSTEM',dashboard='CONTROL_CENTRE',severity='ERROR',message,metadata={}}){
  const cleanMessage=String(message||'').slice(0,1000);
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({businessId,source,dashboard,message:cleanMessage})).digest('hex');
  try{
    await pool.query(`insert into platform_incidents(business_id,source,dashboard,severity,status,fingerprint,message,metadata)
      values($1,$2,$3,$4,'OPEN',$5,$6,$7)
      on conflict(fingerprint) do update set occurrences=platform_incidents.occurrences+1,last_seen_at=now(),severity=excluded.severity,metadata=excluded.metadata,status='OPEN',resolved_at=null`,
      [businessId,source,dashboard,severity,fingerprint,cleanMessage,metadata]);
  }catch(error){ console.error('Incident recording warning:',error.message); }
}

async function runIncidentSweep(){
  try{ await pool.query('select 1'); }
  catch{
    await recordSystemIncident({source:'SYSTEM',severity:'CRITICAL',message:'Database is unavailable.',metadata:{database:false}});
    return {database:false};
  }

  try{
    const [pending,stuck,failedOutboxRows,refunds]=await Promise.all([
      pool.query("select count(*)::int as count from orders where payment_status='PENDING' and status<>'CANCELLED' and created_at < now()-interval '30 minutes'"),
      pool.query("select count(*)::int as count from orders where status in ('ACCEPTED','OUT_FOR_DELIVERY') and created_at < now()-interval '6 hours'"),
      pool.query("select count(*)::int as count from outbox_events where status='FAILED' and attempts >= 3"),
      pool.query("select count(*)::int as count from refunds where status='NEEDS-ATTENTION'")
    ]);
    const oldPayments=Number(pending.rows[0]?.count||0);
    const stuckOrders=Number(stuck.rows[0]?.count||0);
    const failedOutbox=Number(failedOutboxRows.rows[0]?.count||0);
    const needsAttentionRefunds=Number(refunds.rows[0]?.count||0);

    if(oldPayments>0) await recordSystemIncident({source:'PAYMENTS',severity:'ERROR',message:String(oldPayments)+' order payment(s) have remained pending for more than 30 minutes. No payment is marked successful by the incident system.',metadata:{count:oldPayments}});
    if(stuckOrders>0) await recordSystemIncident({source:'ORDERS',severity:'ERROR',message:String(stuckOrders)+' order(s) have remained in an active delivery state for more than 6 hours. No order status is changed automatically.',metadata:{count:stuckOrders}});
    if(failedOutbox>0) await recordSystemIncident({source:'OUTBOX',severity:'ERROR',message:String(failedOutbox)+' outbox event(s) exhausted their bounded retry limit.',metadata:{count:failedOutbox,maxAttempts:3}});
    if(needsAttentionRefunds>0) await recordSystemIncident({source:'REFUNDS',severity:'CRITICAL',message:String(needsAttentionRefunds)+' refund(s) require manual reconciliation.',metadata:{count:needsAttentionRefunds}});
  }catch(error){
    await recordSystemIncident({source:'SYSTEM',severity:'CRITICAL',message:'Incident sweep could not complete its database checks.',metadata:{error:String(error.message||'unknown').slice(0,500)}});
  }

  const dependencies={
    payments:Boolean(String(process.env.PAYSTACK_SECRET_KEY||'').trim()),
    googleMaps:Boolean(String(process.env.GOOGLE_MAPS_API_KEY||'').trim()),
    sms:Boolean(String(process.env.AFRICASTALKING_USERNAME||'').trim()&&String(process.env.AFRICASTALKING_API_KEY||'').trim())
  };
  if(!dependencies.payments) await recordSystemIncident({source:'PAYMENTS',severity:'CRITICAL',message:'Payment provider configuration is missing.',metadata:{configured:false}});
  if(!dependencies.googleMaps) await recordSystemIncident({source:'MAPS',severity:'ERROR',message:'Google Maps configuration is missing; delivery route features may be unavailable.',metadata:{configured:false}});
  if(!dependencies.sms) await recordSystemIncident({source:'SMS',severity:'ERROR',message:'SMS provider configuration is missing; SMS delivery is unavailable.',metadata:{configured:false}});
  return {database:true,dependencies};
}

async function cleanupSecurityArtifacts(){
  try{
    await pool.query("update delivery_quotes set status='EXPIRED' where status='QUOTED' and expires_at<=now()");
    await pool.query("delete from telemetry_access_tokens where expires_at<=now()");
    await pool.query("delete from realtime_access_tokens where expires_at<=now()");
    await pool.query("delete from outbox_events where status='PUBLISHED' and processed_at < now()-interval '7 days'"); }
  catch(error){ console.error('Security cleanup warning:',error.message); }
}
async function startServer(){
  await ensurePhaseASchema();
  await ensurePackageArchitectureSchema();
  await ensurePhaseBSchema();
  await ensurePhaseFSchema();
  await ensurePhaseGSchema();
  await ensurePhaseHSchema();
  await ensurePhaseISchema();
  await ensurePhaseJSchema();
  await ensurePhaseKSchema();
  await ensureIntegrationSchema();
  await ensurePhase1SecuritySchema();
  await ensurePhase3SecuritySchema();
  await ensureComplianceSchema(pool);
  await runComplianceRetentionSweep(pool);
  await cleanupSecurityArtifacts();
  await runSelfHealingSweep(pool);
  await runIncidentSweep();
  await runIntelligenceSweep(pool);
  setInterval(() => runIntelligenceSweep(pool), 6 * 60 * 60_000).unref?.();
  setInterval(cleanupSecurityArtifacts,30*60_000).unref?.();
  setInterval(() => runComplianceRetentionSweep(pool).catch(error => console.error('Compliance retention warning:',error.message)),60*60_000).unref?.();
  // Phase M recovery is deliberately infrequent and bounded. It only reconciles
  // existing infrastructure state; it never changes payment/order outcomes.
  setInterval(() => runSelfHealingSweep(pool).catch(() => {}), 5*60_000).unref?.();
  setInterval(() => runIncidentSweep().catch(() => {}), 5*60_000).unref?.();
  await ensureSmsSchema();
  await ensurePlatformObservabilitySchema();
  await ensureControlDataIsolationSchema(pool);
  await startRealtimeBus();
  app.listen(port, () => console.log(`Ordering API listening on ${port}`));
}
startServer().catch(error => { console.error('Unable to start ordering API', error); process.exit(1); });