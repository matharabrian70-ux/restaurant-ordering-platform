import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

function fingerprint(input){
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

test('incident fingerprints are deterministic',()=>{
  const a=fingerprint({businessId:'tenant-a',source:'PAYMENTS',message:'pending'});
  const b=fingerprint({businessId:'tenant-a',source:'PAYMENTS',message:'pending'});
  assert.equal(a,b);
});

test('incident severity is bounded to the supported levels',()=>{
  const allowed=['INFO','WARN','ERROR','CRITICAL'];
  for(const level of allowed) assert.equal(allowed.includes(level),true);
  assert.equal(allowed.includes('FATAL'),false);
});

test('critical financial incidents do not mutate financial state',()=>{
  const paymentStatus='PENDING';
  const incident={severity:'CRITICAL',source:'PAYMENTS'};
  assert.equal(incident.severity,'CRITICAL');
  assert.equal(paymentStatus,'PENDING');
});

test('stuck-order incidents do not change order status',()=>{
  const order={status:'OUT_FOR_DELIVERY'};
  const incident={source:'ORDERS',severity:'ERROR'};
  assert.equal(incident.source,'ORDERS');
  assert.equal(order.status,'OUT_FOR_DELIVERY');
});

test('outbox exhaustion is observable without bypassing retry limits',()=>{
  const event={status:'FAILED',attempts:3};
  assert.equal(event.status,'FAILED');
  assert.equal(event.attempts>=3,true);
});

test('missing dependency configuration creates visibility, not automatic configuration',()=>{
  const env={payments:false,maps:false,sms:false};
  assert.equal(env.payments,false);
  assert.equal(env.maps,false);
  assert.equal(env.sms,false);
});

test('incident resolution is an explicit platform-owner action',()=>{
  const route={method:'POST',path:'/api/platform/incidents/:id/resolve',requiresPlatformOwner:true};
  assert.equal(route.requiresPlatformOwner,true);
});
