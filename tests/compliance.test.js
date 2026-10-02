import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url).pathname;
const server = fs.readFileSync(root + 'api/server.js','utf8');
const compliance = fs.readFileSync(root + 'api/compliance.js','utf8');

test('commercial compliance routes and storage are wired', () => {
  for (const value of [
    'ensureComplianceSchema',
    'registerComplianceRoutes',
    'runComplianceRetentionSweep',
    '/api/privacy/config',
    '/api/privacy/consent',
    '/api/privacy/requests',
    '/api/manager/privacy',
    '/api/platform/compliance/processors',
    '/api/platform/compliance/incidents'
  ]) assert.ok(server.includes(value) || compliance.includes(value), 'missing '+value);
});

test('checkout requires legal acceptance and separates marketing consent', () => {
  const checkout = fs.readFileSync(root + 'checkout-ui.js','utf8');
  const client = fs.readFileSync(root + 'api-client.js','utf8');
  assert.ok(checkout.includes('terms-accepted'));
  assert.ok(checkout.includes('privacyNoticeAccepted'));
  assert.ok(checkout.includes('marketingOptIn'));
  assert.ok(client.includes('legal: legal || {}'));
});

test('launch legal documents are present', () => {
  for (const file of [
    'privacy.html','terms.html','cookie-policy.html','refund-policy.html',
    'delivery-terms.html','data-rights.html','merchant-agreement.md',
    'data-processing-agreement.md','COMMERCIAL_LAUNCH_COMPLIANCE.md'
  ]) assert.ok(fs.existsSync(root + file), 'missing '+file);
});
