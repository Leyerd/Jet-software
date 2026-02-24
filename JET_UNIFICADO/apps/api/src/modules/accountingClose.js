const crypto = require('crypto');
const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');
const { assertApprovedRequest } = require('./accountingGovernance');

function key(anio, mes) {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

function assertAnioMes(anio, mes) {
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new Error('anio o mes inválidos');
  }
}

function hashSnapshot(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function ensurePeriodExists(state, anio, mes) {
  const existing = state.periodos.find(p => p.key === key(anio, mes));
  if (existing) return existing;
  const period = {
    key: key(anio, mes), anio, mes, estado: 'abierto',
    cerradoPor: null, cerradoEn: null, reabiertoPor: null, reabiertoEn: null, motivoReapertura: null,
    cierreHash: null, cierreSnapshot: null, reaperturaAprobadaPor: null, reaperturaAprobadaEn: null
  };
  state.periodos.push(period);
  return period;
}

function periodFromDate(isoDate) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  return { anio: d.getFullYear(), mes: d.getMonth() + 1 };
}

function isPeriodClosed(state, isoDate) {
  const p = periodFromDate(isoDate);
  if (!p) return false;
  const period = state.periodos.find(x => x.key === key(p.anio, p.mes));
  return period ? period.estado === 'cerrado' : false;
}

async function isPeriodClosedInDb(isoDate) {
  const p = periodFromDate(isoDate);
  if (!p) return false;
  return withPgClient(async (client) => {
    const rs = await client.query('SELECT estado FROM periodos_contables WHERE anio = $1 AND mes = $2 LIMIT 1', [p.anio, p.mes]);
    return rs.rows.length ? rs.rows[0].estado === 'cerrado' : false;
  });
}

async function assertPeriodOpenForDate(isoDate, operationLabel = 'mutación') {
  if (!isoDate) return;
  const p = periodFromDate(isoDate);
  if (!p) return;

  if (isPostgresMode()) {
    const closed = await isPeriodClosedInDb(isoDate);
    if (closed) throw new Error(`No se permite ${operationLabel}: período ${key(p.anio, p.mes)} está cerrado`);
    return;
  }

  const state = await readStore();
  if (isPeriodClosed(state, isoDate)) throw new Error(`No se permite ${operationLabel}: período ${key(p.anio, p.mes)} está cerrado`);
}

async function buildCloseSnapshotInDb(client, anio, mes) {
  const mov = await client.query(
    `SELECT COALESCE(SUM(total),0)::numeric AS total, COALESCE(SUM(neto),0)::numeric AS neto, COALESCE(SUM(iva),0)::numeric AS iva, COUNT(*)::int AS count
     FROM movimientos
     WHERE EXTRACT(YEAR FROM fecha) = $1 AND EXTRACT(MONTH FROM fecha) = $2`,
    [anio, mes]
  );
  const ast = await client.query(
    `SELECT COALESCE(SUM(l.debe),0)::numeric AS debe, COALESCE(SUM(l.haber),0)::numeric AS haber, COUNT(DISTINCT a.id)::int AS entries
     FROM asientos_contables a
     LEFT JOIN asiento_lineas l ON l.asiento_id = a.id
     WHERE EXTRACT(YEAR FROM a.fecha) = $1 AND EXTRACT(MONTH FROM a.fecha) = $2`,
    [anio, mes]
  );
  const tax = await client.query('SELECT anio AS year, regimen AS regime, ppm_rate AS "ppmRate", iva_rate AS "ivaRate", ret_rate AS "retentionRate" FROM tax_config WHERE anio = $1 ORDER BY id DESC LIMIT 1', [anio]);
  return {
    period: key(anio, mes),
    movements: mov.rows[0],
    journal: ast.rows[0],
    taxConfig: tax.rows[0] || null,
    generatedAt: new Date().toISOString()
  };
}

function buildCloseSnapshotInFile(state, anio, mes) {
  const movs = (state.movimientos || []).filter(m => {
    const d = new Date(m.fecha);
    return !Number.isNaN(d.getTime()) && d.getFullYear() === anio && (d.getMonth() + 1) === mes;
  });
  const entries = (state.asientos || []).filter(a => {
    const d = new Date(a.fecha);
    return !Number.isNaN(d.getTime()) && d.getFullYear() === anio && (d.getMonth() + 1) === mes;
  });
  const entryIds = new Set(entries.map(e => e.id));
  const lines = (state.asientoLineas || []).filter(l => entryIds.has(l.asientoId));
  return {
    period: key(anio, mes),
    movements: {
      total: movs.reduce((s, m) => s + Number(m.total || 0), 0),
      neto: movs.reduce((s, m) => s + Number(m.neto || 0), 0),
      iva: movs.reduce((s, m) => s + Number(m.iva || 0), 0),
      count: movs.length
    },
    journal: {
      debe: lines.reduce((s, l) => s + Number(l.debe || 0), 0),
      haber: lines.reduce((s, l) => s + Number(l.haber || 0), 0),
      entries: entries.length
    },
    taxConfig: state.taxConfig || null,
    generatedAt: new Date().toISOString()
  };
}

function buildTaxCloseChecklist(state, anio, mes) {
  const period = key(anio, mes);
  const obligations = (state.complianceObligations || []).filter((x) => x.period === period);
  const byCode = new Map(obligations.map((x) => [x.code, x]));
  const required = ['F29', 'DDJJ', 'F22_EMPRESA', 'F22_DUENO'];
  return required.map((code) => {
    const applies = !(code === 'F22_EMPRESA' || code === 'F22_DUENO') || mes === 4;
    const current = byCode.get(code);
    const lifecycle = String(current?.lifecycleStatus || (applies ? 'pendiente' : 'no_aplica_mes')).toLowerCase();
    return {
      code,
      appliesThisMonth: applies,
      obligationKey: current?.key || `${code}-${period}`,
      lifecycleStatus: lifecycle,
      completed: applies ? lifecycle === 'acuse' : true
    };
  });
}

async function getCloseChecklist(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const query = req.url.includes('?') ? new URL(req.url, 'http://localhost').searchParams : new URLSearchParams();
  const anio = Number(query.get('anio') || query.get('year') || new Date().getFullYear());
  const mes = Number(query.get('mes') || query.get('month') || (new Date().getMonth() + 1));
  try {
    assertAnioMes(anio, mes);
  } catch (err) {
    return sendJson(res, 400, { ok: false, message: err.message });
  }

  const state = await readStore();
  const periodKey = key(anio, mes);
  const snapshot = buildCloseSnapshotInFile(state, anio, mes);
  const journalDebe = Number(snapshot.journal.debe || 0);
  const journalHaber = Number(snapshot.journal.haber || 0);
  const diff = Math.round((journalDebe - journalHaber) * 100) / 100;
  const accountingConsistent = Math.abs(diff) < 0.01;
  const taxItems = buildTaxCloseChecklist(state, anio, mes);
  const taxComplete = taxItems.every((x) => x.completed);

  const ruleTypes = new Set(['VENTA', 'GASTO_LOCAL', 'IMPORTACION', 'COMPRA', 'HONORARIOS', 'COMISION_MARKETPLACE']);
  const periodMovements = (state.movimientos || []).filter((m) => {
    const d = new Date(m.fecha);
    return !Number.isNaN(d.getTime()) && d.getFullYear() === anio && (d.getMonth() + 1) === mes;
  });
  const frequentOps = periodMovements.filter((m) => ruleTypes.has(String(m.tipo || '').toUpperCase()));
  const autoPosted = frequentOps.filter((m) => m.autoJournalCreated || m.autoJournalEntryId).length;

  const periodRecord = (state.periodos || []).find((x) => x.key === periodKey);
  const checklist = [
    {
      id: 'tax.checklist',
      title: 'Checklist tributario mensual (empresa + dueño)',
      status: taxComplete ? 'done' : 'pending',
      trace: taxItems.map((x) => ({ code: x.code, obligationKey: x.obligationKey, lifecycleStatus: x.lifecycleStatus, appliesThisMonth: x.appliesThisMonth }))
    },
    {
      id: 'accounting.consistency',
      title: 'Consistencia Diario/Mayor/Balance',
      status: accountingConsistent ? 'done' : 'pending',
      trace: { debe: journalDebe, haber: journalHaber, diff }
    },
    {
      id: 'journal.autoPosting',
      title: 'Asientos automáticos por operación frecuente',
      status: frequentOps.length === 0 || autoPosted === frequentOps.length ? 'done' : 'pending',
      trace: { frequentOps: frequentOps.length, autoPosted }
    },
    {
      id: 'period.close.state',
      title: 'Estado de cierre del período',
      status: periodRecord?.estado === 'cerrado' ? 'done' : 'pending',
      trace: periodRecord || { key: periodKey, estado: 'abierto' }
    }
  ];

  const traceId = `close-checklist-${periodKey}-${Date.now()}`;
  await appendAudit('period.close.checklist.viewed', { period: periodKey, traceId }, auth.user.email);
  if (isPostgresMode()) await appendAuditLog('period.close.checklist.viewed', { period: periodKey, traceId }, auth.user.email);

  return sendJson(res, 200, {
    ok: true,
    period: periodKey,
    checklist,
    summary: { completed: checklist.filter((x) => x.status === 'done').length, total: checklist.length },
    traceId,
    generatedAt: new Date().toISOString()
  });
}

async function closePeriod(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const anio = Number(body.anio);
  const mes = Number(body.mes);
  const approvalRequestId = String(body.approvalRequestId || '').trim();
  assertAnioMes(anio, mes);
  await assertApprovedRequest('period.close', approvalRequestId);

  if (isPostgresMode()) {
    const period = await withPgClient(async (client) => {
      await client.query('ALTER TABLE periodos_contables ADD COLUMN IF NOT EXISTS cierre_hash TEXT');
      await client.query('ALTER TABLE periodos_contables ADD COLUMN IF NOT EXISTS cierre_snapshot JSONB');
      await client.query('ALTER TABLE periodos_contables ADD COLUMN IF NOT EXISTS reapertura_aprobada_por TEXT');
      await client.query('ALTER TABLE periodos_contables ADD COLUMN IF NOT EXISTS reapertura_aprobada_en TIMESTAMP');

      await client.query(
        `INSERT INTO periodos_contables (anio, mes, estado)
         VALUES ($1, $2, 'abierto')
         ON CONFLICT (anio, mes) DO NOTHING`,
        [anio, mes]
      );
      const current = await client.query(
        `SELECT anio, mes, estado, cerrado_por AS "cerradoPor", cerrado_en AS "cerradoEn", reabierto_por AS "reabiertoPor", reabierto_en AS "reabiertoEn", motivo_reapertura AS "motivoReapertura", cierre_hash AS "cierreHash"
         FROM periodos_contables WHERE anio = $1 AND mes = $2`,
        [anio, mes]
      );
      if (current.rows[0].estado === 'cerrado') return { conflict: true, period: current.rows[0] };

      const snapshot = await buildCloseSnapshotInDb(client, anio, mes);
      const cierreHash = hashSnapshot(snapshot);

      const updated = await client.query(
        `UPDATE periodos_contables
         SET estado = 'cerrado', cerrado_por = $3, cerrado_en = NOW(), cierre_hash = $4, cierre_snapshot = $5::jsonb
         WHERE anio = $1 AND mes = $2
         RETURNING anio, mes, estado, cerrado_por AS "cerradoPor", cerrado_en AS "cerradoEn", reabierto_por AS "reabiertoPor", reabierto_en AS "reabiertoEn", motivo_reapertura AS "motivoReapertura", cierre_hash AS "cierreHash"`,
        [anio, mes, auth.user.email, cierreHash, JSON.stringify(snapshot)]
      );
      return { conflict: false, period: updated.rows[0], snapshot, cierreHash };
    });

    if (period.conflict) return sendJson(res, 409, { ok: false, message: 'El período ya está cerrado', period: period.period });
    await appendAuditLog('period.close', { anio, mes, cierreHash: period.cierreHash }, auth.user.email);
    return sendJson(res, 200, { ok: true, period: period.period, cierreHash: period.cierreHash });
  }

  const state = await readStore();
  const period = ensurePeriodExists(state, anio, mes);
  if (period.estado === 'cerrado') return sendJson(res, 409, { ok: false, message: 'El período ya está cerrado', period });

  const snapshot = buildCloseSnapshotInFile(state, anio, mes);
  period.estado = 'cerrado';
  period.cerradoPor = auth.user.email;
  period.cerradoEn = new Date().toISOString();
  period.cierreSnapshot = snapshot;
  period.cierreHash = hashSnapshot(snapshot);
  await writeStore(state);
  await appendAudit('period.close', { anio, mes, cierreHash: period.cierreHash }, auth.user.email);
  return sendJson(res, 200, { ok: true, period, cierreHash: period.cierreHash });
}

async function reopenPeriod(req, res) {
  const auth = await requireRoles(req, ['contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const anio = Number(body.anio);
  const mes = Number(body.mes);
  const approvalRequestId = String(body.approvalRequestId || '').trim();
  const motivo = String(body.motivo || '').trim();
  const aprobadoPor = String(body.aprobadoPor || '').trim().toLowerCase();
  assertAnioMes(anio, mes);

  if (!motivo || motivo.length < 10) return sendJson(res, 400, { ok: false, message: 'motivo de reapertura es requerido (mín 10 chars)' });
  await assertApprovedRequest('period.reopen', approvalRequestId);
  if (!aprobadoPor) return sendJson(res, 400, { ok: false, message: 'aprobadoPor es requerido (workflow de aprobación)' });

  if (isPostgresMode()) {
    const period = await withPgClient(async (client) => {
      const approver = await client.query('SELECT email, rol FROM usuarios WHERE LOWER(email)=LOWER($1) LIMIT 1', [aprobadoPor]);
      if (!approver.rows.length || approver.rows[0].rol !== 'dueno') return { error: 'aprobadoPor debe ser usuario con rol dueno' };

      await client.query(
        `INSERT INTO periodos_contables (anio, mes, estado)
         VALUES ($1, $2, 'abierto')
         ON CONFLICT (anio, mes) DO NOTHING`,
        [anio, mes]
      );
      const current = await client.query('SELECT estado FROM periodos_contables WHERE anio = $1 AND mes = $2', [anio, mes]);
      if (!current.rows.length || current.rows[0].estado !== 'cerrado') return { error: 'Solo se puede reabrir un período cerrado' };

      const updated = await client.query(
        `UPDATE periodos_contables
         SET estado = 'reabierto', reabierto_por = $3, reabierto_en = NOW(), motivo_reapertura = $4,
             reapertura_aprobada_por = $5, reapertura_aprobada_en = NOW()
         WHERE anio = $1 AND mes = $2
         RETURNING anio, mes, estado, cerrado_por AS "cerradoPor", cerrado_en AS "cerradoEn", reabierto_por AS "reabiertoPor", reabierto_en AS "reabiertoEn", motivo_reapertura AS "motivoReapertura", reapertura_aprobada_por AS "reaperturaAprobadaPor", cierre_hash AS "cierreHash"`,
        [anio, mes, auth.user.email, motivo, aprobadoPor]
      );
      return { period: updated.rows[0] };
    });

    if (period.error) return sendJson(res, 409, { ok: false, message: period.error });
    await appendAuditLog('period.reopen', { anio, mes, motivo, aprobadoPor }, auth.user.email);
    return sendJson(res, 200, { ok: true, period: period.period });
  }

  const state = await readStore();
  const approver = (state.usuarios || []).find(u => String(u.email || '').toLowerCase() === aprobadoPor && u.rol === 'dueno');
  if (!approver) return sendJson(res, 409, { ok: false, message: 'aprobadoPor debe ser usuario con rol dueno' });

  const period = ensurePeriodExists(state, anio, mes);
  if (period.estado !== 'cerrado') return sendJson(res, 409, { ok: false, message: 'Solo se puede reabrir un período cerrado', period });

  period.estado = 'reabierto';
  period.reabiertoPor = auth.user.email;
  period.reabiertoEn = new Date().toISOString();
  period.motivoReapertura = motivo;
  period.reaperturaAprobadaPor = aprobadoPor;
  period.reaperturaAprobadaEn = new Date().toISOString();
  await writeStore(state);
  await appendAudit('period.reopen', { anio, mes, motivo, aprobadoPor }, auth.user.email);
  return sendJson(res, 200, { ok: true, period });
}

async function listPeriods(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  if (isPostgresMode()) {
    const periods = await withPgClient(async (client) => {
      await client.query('ALTER TABLE periodos_contables ADD COLUMN IF NOT EXISTS cierre_hash TEXT');
      await client.query('ALTER TABLE periodos_contables ADD COLUMN IF NOT EXISTS reapertura_aprobada_por TEXT');
      const rs = await client.query(
        `SELECT anio, mes, estado, cerrado_por AS "cerradoPor", cerrado_en AS "cerradoEn", reabierto_por AS "reabiertoPor", reabierto_en AS "reabiertoEn", motivo_reapertura AS "motivoReapertura", cierre_hash AS "cierreHash", reapertura_aprobada_por AS "reaperturaAprobadaPor"
         FROM periodos_contables
         ORDER BY anio DESC, mes DESC`
      );
      return rs.rows;
    });
    return sendJson(res, 200, { ok: true, periods });
  }

  const state = await readStore();
  return sendJson(res, 200, { ok: true, periods: state.periodos });
}

module.exports = { closePeriod, reopenPeriod, listPeriods, getCloseChecklist, isPeriodClosed, isPeriodClosedInDb, assertPeriodOpenForDate };
