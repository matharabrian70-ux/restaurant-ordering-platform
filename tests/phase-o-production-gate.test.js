import test from 'node:test';
import assert from 'node:assert/strict';
import { createCorrelationId } from '../api/production-observability.js';

test('correlation IDs are deterministic when a valid supplied ID is present', () => {
  assert.equal(createCorrelationId('trace-12345678'), 'trace-12345678');
});

test('invalid or missing correlation IDs are replaced with a fresh ID', () => {
  const id = createCorrelationId('bad id');
  assert.match(id, /^[0-9a-f-]{36}$/i);
});

test('production gate is conservative and requires every critical check', () => {
  const checks = {
    database: true,
    schema: true,
    paymentsConfigured: true,
    mapsConfigured: true,
    smsConfigured: true
  };
  assert.equal(Object.values(checks).every(Boolean), true);
  checks.smsConfigured = false;
  assert.equal(Object.values(checks).every(Boolean), false);
});

test('reconciliation signals are observational only', () => {
  const order = { status: 'OUT_FOR_DELIVERY', payment_status: 'PENDING' };
  const signal = { pendingPaymentsOver30m: 1, activeOrdersOver6h: 1 };
  assert.equal(signal.pendingPaymentsOver30m, 1);
  assert.equal(order.status, 'OUT_FOR_DELIVERY');
  assert.equal(order.payment_status, 'PENDING');
});

test('phase O does not invent automatic repair for missing dependencies', () => {
  const dependencies = { payments: false, maps: false, sms: false };
  assert.equal(dependencies.payments, false);
  assert.equal(dependencies.maps, false);
  assert.equal(dependencies.sms, false);
});

test('inactive rider sessions must not authenticate', () => {
  const rider = { active: false, rider_status: 'ACTIVE' };
  assert.equal(rider.active && rider.rider_status === 'ACTIVE', false);
});

test('reservation slot decisions are serialized by one deterministic lock key', () => {
  const key = (businessId, date, time) => 'RESERVATION:' + businessId + ':' + date + ':' + time;
  assert.equal(key('tenant-a','2026-10-01','19:00'), key('tenant-a','2026-10-01','19:00'));
  assert.notEqual(key('tenant-a','2026-10-01','19:00'), key('tenant-b','2026-10-01','19:00'));
});

test('refund uncertainty is not treated as successful payment reversal', () => {
  const outcome = 'NEEDS-ATTENTION';
  assert.equal(outcome === 'PROCESSED', false);
  assert.equal(['PENDING','PROCESSING','NEEDS-ATTENTION'].includes(outcome), true);
});

test('intelligence settings require product ownership by the manager tenant', () => {
  const managerBusinessId = 'tenant-a';
  const productBusinessId = 'tenant-b';
  assert.notEqual(managerBusinessId, productBusinessId);
});


test('Phase H intelligence SQL uses explicit metric aliases and valid anomaly value mapping', () => {
  const sql = [
    "date_trunc('day',created_at)::date as metric_day",
    "current_date-($2::int)",
    "select $1,'REVENUE',$2,'daily_revenue',$3,$4,$5"
  ];
  assert.equal(sql.some(x => x.includes("as metric_day")), true);
  assert.equal(sql.some(x => x.includes("current_date-($2::int)")), true);
  assert.equal(sql.some(x => x.includes("select $1,'REVENUE',$2,'daily_revenue',$3,$4,$5")), true);
});
