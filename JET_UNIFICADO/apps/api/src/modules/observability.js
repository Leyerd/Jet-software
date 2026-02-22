const { sendJson } = require('../lib/http');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient } = require('../lib/postgresRepo');
const { readStore } = require('../lib/store');

const runtime = {
  requests: 0,
  errors: 0,
  validationRejects: 0,
  latencies: [],
  appLogs: []
};

function pushBounded(arr, item, max = 200) {
  arr.push(item);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

function logStructured(level, event, payload = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...payload
  };
  pushBounded(runtime.appLogs, entry, 500);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

function recordRequest({ requestId, method, path, statusCode, durationMs }) {
  runtime.requests += 1;
  if (statusCode >= 500) runtime.errors += 1;
  if (statusCode >= 400 && statusCode < 500) runtime.validationRejects += 1;
  pushBounded(runtime.latencies, Number(durationMs || 0), 1000);
  logStructured('info', 'http.request', { requestId, method, path, statusCode, durationMs: Math.round(durationMs || 0) });
}

function summarizeLatency(latencies) {
  if (!latencies.length) return { avgMs: 0, p95Ms: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return { avgMs: Math.round(avg), p95Ms: Math.round(p95) };
}

async function buildAlerts() {
  if (isPostgresMode()) {
    return withPgClient(async (client) => {
      const [dlq, observed, closeAttempts, backupFails] = await Promise.all([
        client.query('SELECT COUNT(*)::int AS c FROM integration_dead_letter'),
        client.query("SELECT COUNT(*)::int AS c FROM documents_normalized WHERE status = 'observado'"),
        client.query("SELECT COUNT(*)::int AS c FROM audit_log WHERE accion LIKE 'period.%' AND (detalle::text ILIKE '%No se permite%' OR detalle::text ILIKE '%cerrado%')"),
        client.query("SELECT COUNT(*)::int AS c FROM backup_restore_validations WHERE status = 'error' AND validated_at >= NOW() - INTERVAL '7 day'")
      ]);

      const alerts = [];
      const dlqCount = Number(dlq.rows[0]?.c || 0);
      const obsCount = Number(observed.rows[0]?.c || 0);
      const closeCount = Number(closeAttempts.rows[0]?.c || 0);
      const backupFailCount = Number(backupFails.rows[0]?.c || 0);

      if (dlqCount > 0) alerts.push({ key: 'sync-failures', severity: 'high', value: dlqCount, message: 'Hay sincronizaciones fallidas en dead-letter.' });
      if (obsCount > 0) alerts.push({ key: 'reconciliation-observed', severity: 'medium', value: obsCount, message: 'Existen documentos en estado observado.' });
      if (closeCount > 0) alerts.push({ key: 'post-close-attempt', severity: 'high', value: closeCount, message: 'Se detectaron intentos de mutación post-cierre.' });
      if (backupFailCount > 0) alerts.push({ key: 'backup-failed', severity: 'critical', value: backupFailCount, message: 'Fallaron validaciones de restore de backup en la última semana.' });

      return alerts;
    });
  }

  const state = await readStore();
  const alerts = [];
  const dlqCount = (state.integrationDeadLetter || []).length;
  const obsCount = (state.conciliaciones || []).filter(x => String(x.estado).toLowerCase() === 'observado').length;
  const closeCount = (state.auditLog || []).filter(a => String(a.action || '').includes('period') && JSON.stringify(a.detail || {}).toLowerCase().includes('cerrado')).length;
  const backupFailCount = (state.auditLog || []).filter(a => String(a.action || '').includes('backup') && JSON.stringify(a.detail || {}).toLowerCase().includes('error')).length;

  if (dlqCount > 0) alerts.push({ key: 'sync-failures', severity: 'high', value: dlqCount, message: 'Hay sincronizaciones fallidas en dead-letter.' });
  if (obsCount > 0) alerts.push({ key: 'reconciliation-observed', severity: 'medium', value: obsCount, message: 'Existen conciliaciones en observado.' });
  if (closeCount > 0) alerts.push({ key: 'post-close-attempt', severity: 'high', value: closeCount, message: 'Se detectaron intentos de mutación post-cierre.' });
  if (backupFailCount > 0) alerts.push({ key: 'backup-failed', severity: 'critical', value: backupFailCount, message: 'Se detectaron fallas de backup/restore.' });
  return alerts;
}

async function getDashboard(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const latency = summarizeLatency(runtime.latencies);
  const alerts = await buildAlerts();

  return sendJson(res, 200, {
    ok: true,
    dashboard: {
      generatedAt: new Date().toISOString(),
      runtime: {
        requests: runtime.requests,
        errors: runtime.errors,
        validationRejects: runtime.validationRejects,
        ...latency
      },
      alerts,
      alertsActive: alerts.length > 0,
      appLogsTail: runtime.appLogs.slice(-50)
    }
  });
}

module.exports = {
  logStructured,
  recordRequest,
  getDashboard
};
