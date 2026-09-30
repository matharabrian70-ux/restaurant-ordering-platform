// Phase M: bounded, deterministic self-healing.
// This module may only reconcile infrastructure/job state that already exists.
// It never creates schema, changes authorization, marks financial/order outcomes
// as successful, or modifies application code/configuration.
const MAX_RETRIES = 3;
const STALE_PROCESSING_MINUTES = 10;
const RETRY_DELAY_MINUTES = 2;

async function safeQuery(pool, sql, params = []) {
  try {
    return await pool.query(sql, params);
  } catch {
    return null;
  }
}

export async function runSelfHealingSweep(pool) {
  const result = {
    ok: true,
    outboxRecovered: 0,
    expiredSessionsRemoved: 0,
    expiredTokensRemoved: 0,
    staleConnectionsClosed: 0
  };

  // Only return an outbox event to the queue when it was already being
  // processed and has become stale. No event is published here.
  const processing = await safeQuery(pool, `
    update outbox_events
       set status='PENDING',
           available_at=now(),
           last_error=coalesce(last_error,'Recovered stale processing event')
     where status='PROCESSING'
       and attempts < $1
       and created_at <= now() - make_interval(mins => $2)
     returning id
  `, [MAX_RETRIES, STALE_PROCESSING_MINUTES]);
  result.outboxRecovered += processing?.rowCount || 0;

  // Failed outbox events are only made eligible for another bounded attempt.
  // The event's original payload/tenant/aggregate remains unchanged.
  const failed = await safeQuery(pool, `
    update outbox_events
       set status='PENDING',
           available_at=now() + make_interval(mins => $1),
           last_error=coalesce(last_error,'Retry scheduled by self-healing')
     where status='FAILED'
       and attempts < $2
       and available_at <= now()
     returning id
  `, [RETRY_DELAY_MINUTES, MAX_RETRIES]);
  result.outboxRecovered += failed?.rowCount || 0;

  // Expired authentication artifacts are safe to remove because they are
  // already unusable. This does not revoke a currently valid session.
  const sessions = await safeQuery(pool, `
    delete from manager_sessions where expires_at <= now();
    delete from rider_sessions where expires_at <= now();
    delete from station_sessions where expires_at <= now();
    delete from platform_admin_sessions where expires_at <= now();
  `);
  if (sessions) result.expiredSessionsRemoved = true;

  const tokens = await safeQuery(pool, `
    delete from customer_sessions where expires_at <= now();
    delete from rider_invites where expires_at <= now() and used_at is null;
    delete from station_pairing_tokens where expires_at <= now() and used_at is null;
    delete from telemetry_access_tokens where expires_at <= now();
    delete from realtime_access_tokens where expires_at <= now();
  `);
  if (tokens) result.expiredTokensRemoved = true;

  // A business may only be marked disconnected when it has no active rider
  // sessions. This reconciles stale connection state without touching orders.
  const connections = await safeQuery(pool, `
    update business_connections bc
       set rider_connected=false, updated_at=now()
     where bc.rider_connected=true
       and not exists (
         select 1
           from rider_sessions rs
           join riders r on r.id=rs.rider_id
          where r.business_id=bc.business_id
            and rs.expires_at>now()
       )
     returning bc.business_id
  `);
  result.staleConnectionsClosed = connections?.rowCount || 0;

  return result;
}

export const PHASE_M_LIMITS = {
  maxRetries: MAX_RETRIES,
  staleProcessingMinutes: STALE_PROCESSING_MINUTES,
  retryDelayMinutes: RETRY_DELAY_MINUTES
};
