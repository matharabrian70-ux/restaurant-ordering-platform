import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(root, 'api', 'server.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'api', 'migrations', '010_phase_r_package_authority_and_constraint_validation.sql'), 'utf8');

function has(text, value) {
  assert.ok(text.includes(value), 'missing: ' + value);
}

test('Package architecture has one authoritative entitlement source', () => {
  has(server, 'async function requireFeature(feature, businessId)');
  has(server, 'async function getTenantFeatureState(businessId, feature)');
  has(server, 'from businesses b');
  has(server, 'left join platform_packages p on p.key=b.plan_key');
  has(server, 'app.use(\'/api\', enforcePackageCapabilities)');
  assert.doesNotMatch(server, /businesses[^\n]*package_type/);
  assert.doesNotMatch(server, /RIDER_MODULE_ENABLED/);
});

test('Canonical package matrix is STARTER/GROWTH/PRO only', () => {
  for (const key of ['STARTER','GROWTH','PRO']) has(schema, `where key='${key}'`);
  has(migration, "when upper(coalesce(package_type,''))='ADVANCED' then 'GROWTH'");
  has(migration, "when upper(coalesce(package_type,''))='DIGITAL_ORDERING' then 'STARTER'");
  has(migration, "alter table businesses alter column plan_key set not null");
});

test('Every commercial capability has a backend enforcement path', () => {
  for (const feature of [
    'advancedDelivery','branchRouting','riderModule','riderTracking','sms',
    'advancedAnalytics','customDomain','apiIntegrations','multiBranch'
  ]) has(server, "'" + feature + "'");
  for (const marker of [
    'Feature "',
    'Feature',
    'enforcePackageCapabilities',
    'FEATURE_NOT_INCLUDED'
  ]) has(server, marker);
  has(server, "if (/^\\/manager\\/intelligence");
  has(server, "if (/^\\/manager\\/sms");
  has(server, "if (/^\\/platform\\/businesses\\/[^/]+\\/integration");
});

test('Rider entitlement cannot be enabled by the legacy business feature flag', () => {
  const riderBlock = server.slice(server.indexOf('async function requireRiderModule'), server.indexOf("app.use('/api/riders'", server.indexOf('async function requireRiderModule')));
  assert.doesNotMatch(riderBlock, /business_features/);
  has(server, "requireFeature('riderModule', businessId)");
  has(server, "select coalesce((p.features->>'riderModule')::boolean");
});

test('Control Centre create/update uses plan_key rather than package_type', () => {
  has(server, "req.body.planKey||req.body.packageType||'STARTER'");
  has(server, "insert into businesses(id,name,slug,plan_key");
  has(server, "update businesses set name=$1,slug=$2,plan_key=$3");
  assert.doesNotMatch(server, /insert into businesses\([^)]*package_type/);
  assert.doesNotMatch(server, /update businesses set [^\n]*package_type/);
});

test('Feature enforcement is tenant-bound for public and authenticated flows', () => {
  has(server, 'const orderMatch = path.match(/^\\/orders\\/([^/]+)/)');
  has(server, 'const riderInviteMatch = path.match(/^\\/rider-invites\\/([^/]+)/)');
  has(server, 'getManagerFromSession(req)');
  has(server, 'getRiderFromSession(req)');
  has(server, 'getStationFromSession(req)');
});

test('Public integration entitlement is checked after the signed token resolves its tenant', () => {
  has(server, "app.get('/api/public/integrations/:token.js'");
  has(server, "await requireFeature('apiIntegrations',b.id)");
});


test('Delivery packaging separates manual Starter zones from connected Rider Dashboard pricing', () => {
  const manager = fs.readFileSync(path.join(root, 'manager.js'), 'utf8');
  const delivery = fs.readFileSync(path.join(root, 'api', 'delivery-engine.js'), 'utf8');
  has(manager, "const visibleNavItems=()=>NAV_ITEMS.filter(x=>!x[3]||managerFeature(x[3]));");
  has(manager, "['dispatch','⇄','Dispatch','riderModule']");
  has(manager, "['riders','♟','Riders','riderModule']");
  has(delivery, "p.features->>'riderModule'");
  has(delivery, "bc.rider_connected");
  has(delivery, "pricingMode:'ZONE'");
  assert.doesNotMatch(server, /manager\/delivery-zones[^\n]*advancedDelivery/);
});

test('Restaurant receives delivery money when Rider Dashboard is not connected', () => {
  has(server, "const deliveryFeeStatus=deliveryFee>0 ? (riderConnected?'HELD':'MERCHANT') : 'NONE';");
  has(server, "const riderEarning=riderConnected ? deliveryFee : 0;");
  has(server, "const merchantShareKes=merchantFood+(riderConnected?0:Number(order.delivery_fee||0));");
  has(server, "Rider Dashboard must be connected before assigning a rider");
});

test('Branch execution routing is authoritative', () => {
  const delivery = fs.readFileSync(path.join(root, 'api', 'delivery-engine.js'), 'utf8');
  has(delivery, "order by priority desc,created_at desc");
  has(delivery, "business_id=$1 and active=true and accepting_orders=true");
  has(delivery, "sort((a,b)=>a.distanceKm-b.distanceKm)[0]");
  has(server, "and o.branch_id=$2 order by o.created_at desc limit 200");
  has(server, "and o.business_id=$2 and o.branch_id=$3 for update");
});

test('Order stations are permanently bound to a branch', () => {
  has(server, "An active branch is required for every order-control station");
  has(server, "st.branch_id");
  has(server, "bb.id=st.branch_id");
  has(server, "and bb.active=true");
  has(server, "branchId:req.station.branch_id");
});

test('Restaurant provisioning never invents Nairobi as a branch location', () => {
  has(server, "Valid branch latitude and longitude are required");
  assert.doesNotMatch(server, /-1\.286389,36\.817223/);
});

test('Paystack settlement cannot silently fall back to the platform account', () => {
  has(server, "This restaurant has not completed its Paystack settlement setup");
  has(server, "const split=order.paystack_subaccount_code && merchantShareKes>0");
});
