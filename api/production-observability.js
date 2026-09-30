import crypto from 'node:crypto';

const REQUIRED_TABLES = [
  'businesses',
  'orders',
  'paystack_webhook_events',
  'outbox_events',
  'order_idempotency_keys',
  'delivery_quotes',
  'manager_sessions',
  'rider_sessions',
  'restaurant_order_stations',
  'platform_incidents'
];

function status(ok, details = {}) {
  return { ok: Boolean(ok), ...details };
}

function dependencyConfig() {
  return {
    payments: Boolean(String(process.env.PAYSTACK_SECRET_KEY || '').trim()),
    maps: Boolean(String(process.env.GOOGLE_MAPS_API_KEY || '').trim()),
    sms: Boolean(
      String(process.env.AFRICASTALKING_USERNAME || '').trim() &&
      String(process.env.AFRICASTALKING_API_KEY || '').trim()
    ),
    database: Boolean(String(process.env.DATABASE_URL || '').trim())
  };
}

export function createCorrelationId(input = '') {
  const supplied = String(input || '').trim();
  if (/^[A-Za-z0-9._:-]{8,128}$/.test(supplied)) return supplied;
  return crypto.randomUUID();
}

export function registerProductionObservability(app, pool, {
  requirePlatformAdmin,
  requirePlatformRole,
  recordSystemIncident
}) {
  app.use((req, res, next) => {
    const correlationId = createCorrelationId(req.get('X-Correlation-ID'));
    const started = process.hrtime.bigint();
    res.setHeader('X-Correlation-ID', correlationId);
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      if (durationMs >= 2000 || res.statusCode >= 500) {
        console.warn(JSON.stringify({
          type: 'request_observation',
          correlationId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(durationMs)
        }));
      }
    });
    req.correlationId = correlationId;
    next();
  });

  app.get('/api/platform/production/health', requirePlatformAdmin, async (req, res) => {
    const checkedAt = new Date().toISOString();
    const dependencies = dependencyConfig();
    const checks = {};
    try {
      await pool.query('select 1');
      checks.database = status(true, { latencyMs: null });
    } catch (error) {
      checks.database = status(false, { error: String(error.message || 'database unavailable').slice(0, 300) });
    }

    if (checks.database.ok) {
      try {
        const result = await pool.query(
          'select table_name from information_schema.tables where table_schema=\'public\' and table_name = any($1::text[])',
          [REQUIRED_TABLES]
        );
        const found = new Set(result.rows.map(row => row.table_name));
        const missing = REQUIRED_TABLES.filter(name => !found.has(name));
        checks.schema = status(missing.length === 0, { required: REQUIRED_TABLES, missing });
      } catch (error) {
        checks.schema = status(false, { error: String(error.message || 'schema check failed').slice(0, 300) });
      }
    } else {
      checks.schema = status(false, { skipped: true, reason: 'database unavailable' });
    }

    checks.payments = status(dependencies.payments);
    checks.maps = status(dependencies.maps);
    checks.sms = status(dependencies.sms);

    const overall = Object.values(checks).every(check => check.ok);
    res.status(overall ? 200 : 503).json({
      ok: overall,
      phase: 'O',
      correlationId: req.correlationId,
      checkedAt,
      checks,
      note: 'Health reporting is read-only. It does not repair configuration or change business, payment, refund, or order state.'
    });
  });

  app.get('/api/platform/production/reconciliation', requirePlatformAdmin, async (req, res) => {
    try {
      const [payments, webhooks, outbox, refunds, orders] = await Promise.all([
        pool.query("select count(*)::int as count from orders where payment_status='PENDING' and status<>'CANCELLED' and created_at < now()-interval '30 minutes'"),
        pool.query("select count(*)::int as count from paystack_webhook_events where processed_at is null"),
        pool.query("select count(*)::int as count from outbox_events where status='FAILED'"),
        pool.query("select count(*)::int as count from refunds where status='NEEDS-ATTENTION'"),
        pool.query("select count(*)::int as count from orders where status in ('ACCEPTED','OUT_FOR_DELIVERY') and created_at < now()-interval '6 hours'")
      ]);
      res.json({
        ok: true,
        phase: 'O',
        correlationId: req.correlationId,
        checkedAt: new Date().toISOString(),
        reconciliation: {
          pendingPaymentsOver30m: Number(payments.rows[0]?.count || 0),
          unprocessedWebhookEvents: Number(webhooks.rows[0]?.count || 0),
          failedOutboxEvents: Number(outbox.rows[0]?.count || 0),
          refundsNeedingAttention: Number(refunds.rows[0]?.count || 0),
          activeOrdersOver6h: Number(orders.rows[0]?.count || 0)
        },
        note: 'These are reconciliation signals only. No financial or order state is changed by this endpoint.'
      });
    } catch (error) {
      await recordSystemIncident({
        source: 'OBSERVABILITY',
        severity: 'ERROR',
        message: 'Production reconciliation check failed.',
        metadata: { correlationId: req.correlationId, error: String(error.message || 'unknown').slice(0, 500) }
      });
      res.status(503).json({
        ok: false,
        phase: 'O',
        correlationId: req.correlationId,
        error: 'Production reconciliation is unavailable'
      });
    }
  });

  app.get('/api/platform/production/gate', requirePlatformAdmin, requirePlatformRole('PLATFORM_OWNER'), async (req, res) => {
    const checks = {};
    const dependencies = dependencyConfig();

    try {
      await pool.query('select 1');
      checks.database = true;
    } catch {
      checks.database = false;
    }

    if (checks.database) {
      try {
        const result = await pool.query(
          'select table_name from information_schema.tables where table_schema=\'public\' and table_name = any($1::text[])',
          [REQUIRED_TABLES]
        );
        const found = new Set(result.rows.map(row => row.table_name));
        checks.schema = REQUIRED_TABLES.every(name => found.has(name));
      } catch {
        checks.schema = false;
      }
    } else {
      checks.schema = false;
    }

    checks.paymentsConfigured = dependencies.payments;
    checks.mapsConfigured = dependencies.maps;
    checks.smsConfigured = dependencies.sms;

    if (checks.database) {
      try {
        const [criticalIncidents, refunds, pendingPayments, stuckOrders] = await Promise.all([
          pool.query("select count(*)::int as count from platform_incidents where status='OPEN' and severity='CRITICAL'"),
          pool.query("select count(*)::int as count from refunds where status='NEEDS-ATTENTION'"),
          pool.query("select count(*)::int as count from orders where payment_status='PENDING' and status<>'CANCELLED' and created_at < now()-interval '30 minutes'"),
          pool.query("select count(*)::int as count from orders where status in ('ACCEPTED','OUT_FOR_DELIVERY') and created_at < now()-interval '6 hours'")
        ]);
        checks.noCriticalIncidents = Number(criticalIncidents.rows[0]?.count || 0) === 0;
        checks.noRefundReconciliationBlockers = Number(refunds.rows[0]?.count || 0) === 0;
        checks.noStalePayments = Number(pendingPayments.rows[0]?.count || 0) === 0;
        checks.noStuckActiveOrders = Number(stuckOrders.rows[0]?.count || 0) === 0;
      } catch {
        checks.reconciliationChecks = false;
      }
    } else {
      checks.reconciliationChecks = false;
    }

    const gatePassed = Object.values(checks).every(Boolean);
    res.status(gatePassed ? 200 : 503).json({
      gatePassed,
      phase: 'O',
      correlationId: req.correlationId,
      checkedAt: new Date().toISOString(),
      checks,
      releaseDecision: gatePassed
        ? 'READY_FOR_FINAL_SMOKE_TESTS'
        : 'BLOCKED_PENDING_REMEDIATION',
      note: 'This gate is conservative: unresolved production checks block the gate and no automatic remediation is performed.'
    });
  });
}
