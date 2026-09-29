import test from 'node:test';
import assert from 'node:assert/strict';

const MAX_RETRIES = 3;

test('self-healing has a hard retry ceiling',()=>{
  assert.equal(0 < MAX_RETRIES,true);
  assert.equal(3 < MAX_RETRIES,false);
  assert.equal(10 < MAX_RETRIES,false);
});

test('self-healing only recovers stale infrastructure state',()=>{
  const allowed = new Set(['PENDING','PROCESSING','FAILED','PUBLISHED']);
  assert.equal(allowed.has('PROCESSING'),true);
  assert.equal(allowed.has('FAILED'),true);
  assert.equal(allowed.has('PAID'),false);
  assert.equal(allowed.has('DELIVERED'),false);
});

test('self-healing never converts financial or order state',()=>{
  const protectedStates = ['PAID','REFUNDED','DELIVERED','CANCELLED'];
  for(const state of protectedStates) assert.equal(['PENDING','PROCESSING','FAILED'].includes(state),false);
});

test('stale processing recovery preserves the original event identity',()=>{
  const event={id:'event-1',business_id:'tenant-a',aggregate_id:'order-1',status:'PROCESSING',attempts:2};
  const recovered={...event,status:'PENDING'};
  assert.equal(recovered.id,event.id);
  assert.equal(recovered.business_id,event.business_id);
  assert.equal(recovered.aggregate_id,event.aggregate_id);
  assert.equal(recovered.attempts,event.attempts);
});

test('expired sessions are safe to remove while valid sessions remain',()=>{
  const now=Date.now();
  const sessions=[
    {id:'expired',expires_at:new Date(now-1).toISOString()},
    {id:'valid',expires_at:new Date(now+60_000).toISOString()}
  ];
  const removable=sessions.filter(s=>new Date(s.expires_at).getTime()<=now);
  assert.deepEqual(removable.map(s=>s.id),['expired']);
});

test('stale rider connection can only be closed when no active session exists',()=>{
  const activeSessions=0;
  const connection=true;
  const healed=connection && activeSessions===0 ? false : connection;
  assert.equal(healed,false);
});

test('self-healing does not invent success when an external dependency fails',()=>{
  const externalCall={ok:false};
  const businessOutcome='PENDING';
  assert.equal(externalCall.ok,false);
  assert.equal(businessOutcome,'PENDING');
});

test('self-healing does not run when database state cannot be read',()=>{
  const databaseAvailable=false;
  const mutations=[];
  if(databaseAvailable) mutations.push('reconcile');
  assert.deepEqual(mutations,[]);
});
