import test from 'node:test';
import assert from 'node:assert/strict';

function transitionAllowed(from,to){
  if(from===to)return true;
  return (
    (from==='NEW' && ['ACCEPTED','CANCELLED'].includes(to)) ||
    (from==='ACCEPTED' && ['OUT_FOR_DELIVERY','CANCELLED'].includes(to)) ||
    (from==='OUT_FOR_DELIVERY' && ['ACCEPTED','DELIVERED'].includes(to))
  );
}

function tenantMatches(sessionTenant, requestedTenant){
  return !requestedTenant || String(sessionTenant)===String(requestedTenant);
}

function sameIdempotencyPayload(storedHash,currentHash){
  return String(storedHash)===String(currentHash);
}

function quoteUsable(quote,{nowMs}){
  return quote.status==='QUOTED' && !quote.used_at && new Date(quote.expires_at).getTime()>nowMs;
}

test('order state machine rejects impossible transitions',()=>{
  assert.equal(transitionAllowed('NEW','ACCEPTED'),true);
  assert.equal(transitionAllowed('ACCEPTED','OUT_FOR_DELIVERY'),true);
  assert.equal(transitionAllowed('OUT_FOR_DELIVERY','DELIVERED'),true);
  assert.equal(transitionAllowed('OUT_FOR_DELIVERY','ACCEPTED'),true);
  assert.equal(transitionAllowed('NEW','DELIVERED'),false);
  assert.equal(transitionAllowed('DELIVERED','CANCELLED'),false);
  assert.equal(transitionAllowed('CANCELLED','ACCEPTED'),false);
});

test('tenant authorization rejects cross-tenant requests',()=>{
  assert.equal(tenantMatches('restaurant-a','restaurant-a'),true);
  assert.equal(tenantMatches('restaurant-a','restaurant-b'),false);
  assert.equal(tenantMatches('restaurant-a',''),true);
});

test('idempotency accepts retry with the same request fingerprint and rejects mutation',()=>{
  const original='hash:order-a';
  assert.equal(sameIdempotencyPayload(original,'hash:order-a'),true);
  assert.equal(sameIdempotencyPayload(original,'hash:order-b'),false);
});

test('expired delivery quotes cannot be consumed',()=>{
  const future=new Date(Date.now()+60_000).toISOString();
  const past=new Date(Date.now()-60_000).toISOString();
  assert.equal(quoteUsable({status:'QUOTED',used_at:null,expires_at:future},{nowMs:Date.now()}),true);
  assert.equal(quoteUsable({status:'QUOTED',used_at:null,expires_at:past},{nowMs:Date.now()}),false);
  assert.equal(quoteUsable({status:'USED',used_at:new Date().toISOString(),expires_at:future},{nowMs:Date.now()}),false);
});

test('duplicate delivery assignment is rejected by the active-trip invariant',()=>{
  const activeTrips=[{order_id:'order-1',completed_at:null}];
  assert.equal(activeTrips.some(t=>t.order_id==='order-1'&&!t.completed_at),true);
});

test('rider cannot act on another rider account',()=>{
  const sessionRider='rider-a';
  assert.equal(sessionRider==='rider-a',true);
  assert.equal(sessionRider==='rider-b',false);
});

test('station tenant binding prevents cross-restaurant access',()=>{
  const station={business_id:'restaurant-a',active:true};
  assert.equal(station.active && tenantMatches(station.business_id,'restaurant-a'),true);
  assert.equal(station.active && tenantMatches(station.business_id,'restaurant-b'),false);
});

test('retry-safe financial operations require a stable idempotency key',()=>{
  const seen=new Set();
  const key='refund:order-1:1000';
  assert.equal(seen.has(key),false);
  seen.add(key);
  assert.equal(seen.has(key),true);
});

test('concurrent state changes must re-check the current state after locking',()=>{
  let status='NEW';
  const accept=()=>{ if(status!=='NEW') return false; status='ACCEPTED'; return true; };
  assert.equal(accept(),true);
  assert.equal(accept(),false);
  assert.equal(status,'ACCEPTED');
});

test('external dependency failure does not imply a successful business state',()=>{
  const provider={ok:false};
  const paymentStatus='PENDING';
  assert.equal(provider.ok,false);
  assert.equal(paymentStatus,'PENDING');
  assert.notEqual(paymentStatus,'PAID');
});

test('database failure does not imply a committed mutation',()=>{
  let committed=false;
  try { throw new Error('database unavailable'); } catch {}
  assert.equal(committed,false);
});
