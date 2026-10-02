import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

test('professional checkout assets are present and syntactically valid',()=>{
  const html=fs.readFileSync('checkout.html','utf8');
  const css=fs.readFileSync('checkout.css','utf8');
  const js=fs.readFileSync('checkout-ui.js','utf8');
  assert.match(html,/checkout\.css/);
  assert.match(html,/checkout-ui\.js\?v=checkout-pro-1/);
  assert.match(css,/checkout-columns/);
  assert.match(css,/checkout-payment/);
  assert.match(css,/checkout-check/);
  assert.match(js,/terms-accepted/);
  assert.match(js,/PayPal/);
  assert.match(js,/not enabled for this restaurant yet/);
  const r=spawnSync(process.execPath,['--check','checkout-ui.js'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr||r.stdout);
});
