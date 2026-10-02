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
  for (const key of ['DIGITAL_ORDERING','ADVANCED']) {
    assert.ok(schema.includes(key), 'legacy values remain in schema for migration compatibility');
  }
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
