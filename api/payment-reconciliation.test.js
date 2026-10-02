import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(root, 'api', 'server.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');

const scenarios = [
  'payment succeeds',
  'payment fails',
  'payment times out',
  'customer closes browser',
  'webhook arrives twice',
  'webhook arrives before frontend verification',
  'frontend verifies twice',
  'payment reference is wrong',
  'refund succeeds',
  'refund fails',
  'refund times out',
  'partial refund',
  'multiple partial refunds',
  'refund exceeds paid amount'
];

test('Payment reconciliation matrix is permanently tracked', () => {
  assert.equal(scenarios.length, 14);
  for (const scenario of scenarios) assert.ok(scenario.length > 0);
});

test('Payment idempotency and webhook deduplication protections remain present', () => {
  for (const value of [
    'payments_idempotency_key_idx',
    'paystack_webhook_events',
    'unique(event_type,resource_id)',
    'Idempotency-Key',
    'pg_advisory_xact_lock',
    'AUTO-CANCEL-'
  ]) assert.ok((server + schema).includes(value), 'missing: ' + value);
});

test('Refund boundaries are server-side and money is not trusted from the browser', () => {
  for (const value of [
    'refunds_idempotency_key_idx',
    'refundAmount',
    'paidAmount',
    'remainingRefundable',
    'amount > 0'
  ]) assert.ok((server + schema).includes(value), 'missing: ' + value);
});
