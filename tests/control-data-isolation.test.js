import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const server=fs.readFileSync('api/server.js','utf8');
const isolation=fs.readFileSync('api/control-data-isolation.js','utf8');
const migration=fs.readFileSync('api/migrations/011_phase_s_control_centre_data_isolation.sql','utf8');
const control=fs.readFileSync('platform-control.js','utf8');

test('control centre data isolation files are syntactically valid',()=>{
  for(const file of ['api/server.js','api/control-data-isolation.js','platform-control.js']){
    const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
    assert.equal(r.status,0,file+' failed syntax check: '+(r.stderr||r.stdout));
  }
});

test('normal platform endpoints no longer expose order or rider browsing',()=>{
  assert.match(server,/app\.get\('\/api\/platform\/orders',[\s\S]*?status\(410\)/);
  assert.match(server,/app\.get\('\/api\/platform\/riders',[\s\S]*?status\(410\)/);
  assert.doesNotMatch(server,/select o\.id,o\.order_number,o\.status,o\.payment_status,o\.delivery_status,o\.total,o\.created_at[\s\S]*?app\.get\('\/api\/platform\/orders/);
});

test('safe tenant registry excludes order counts and revenue',()=>{
  const registry=server.slice(server.indexOf("app.get('/api/platform/businesses',requirePlatformAdmin"),server.indexOf("app.post('/api/platform/businesses',requirePlatformAdmin"));
  assert.doesNotMatch(registry,/order_count/);
  assert.doesNotMatch(registry,/sum\(o\.total\)/);
  assert.doesNotMatch(registry,/pickup_address/);
  assert.match(registry,/integration_active/);
});

test('controlled evidence requires a case and time-limited grant',()=>{
  assert.match(isolation,/\/api\/control\/disputes/);
  assert.match(isolation,/Active evidence access is required for this scope/);
  assert.match(isolation,/expires_at>now\(\)/);
  assert.match(isolation,/MAX_ACCESS_MINUTES=30/);
});

test('restricted location and customer contact require platform-owner authorization',()=>{
  assert.match(isolation,/OWNER_ONLY=new Set\(\['LOCATION_DETAIL','CUSTOMER_CONTACT'\]\)/);
  assert.match(isolation,/PLATFORM_OWNER/);
});

test('audit trail is append-only',()=>{
  assert.match(migration,/control_access_audit/);
  assert.match(migration,/prevent_control_access_audit_mutation/);
  assert.match(migration,/before update or delete/);
});

test('control centre frontend does not request normal order or rider feeds',()=>{
  assert.doesNotMatch(control,/\/api\/platform\/orders\?limit=/);
  assert.doesNotMatch(control,/\/api\/platform\/riders\?limit=/);
  assert.match(control,/\/api\/control\/disputes\?status=ALL/);
  assert.match(control,/ORDER_TIMELINE/);
  assert.match(control,/CUSTOMER_CONTACT/);
});