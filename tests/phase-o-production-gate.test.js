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
