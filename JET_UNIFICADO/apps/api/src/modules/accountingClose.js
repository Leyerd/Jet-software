const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');

function key(anio, mes) {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

function assertAnioMes(anio, mes) {
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new Error('anio o mes inválidos');
  }
}

function ensurePeriodExists(state, anio, mes) {
  const existing = state.periodos.find(p => p.key === key(anio, mes));
  if (existing) return existing;
  const period = {
    key: key(anio, mes), anio, mes, estado: 'abierto',
    cerradoPor: null, cerradoEn: null, reabiertoPor: null, reabiertoEn: null, motivoReapertura: null
  };
  state.periodos.push(period);
  return period;
}

function isPeriodClosed(state, isoDate) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;
  const anio = d.getFullYear();
  const mes = d.getMonth() + 1;
  const period = state.periodos.find(p => p.key === key(anio, mes));
  return period ? period.estado === 'cerrado' : false;
}

async function isPeriodClosedInDb(isoDate) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;
  const anio = d.getFullYear();
  const mes = d.getMonth() + 1;
  return withPgClient(async (client) => {
    const rs = await client.query(
      'SELECT estado FROM periodos_contables WHERE anio = $1 AND mes = $2 LIMIT 1',
      [anio, mes]
    );
    return rs.rows.length ? rs.rows[0].estado === 'cerrado' : false;
  });
}

async function closePeriod(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const anio = Number(body.anio);
  const mes = Number(body.mes);
  assertAnioMes(anio, mes);

  if (isPostgresMode()) {
    const period = await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO periodos_contables (anio, mes, estado)
         VALUES ($1, $2, 'abierto')
         ON CONFLICT (anio, mes) DO NOTHING`,
        [anio, mes]
      );
      const current = await client.query(
        'SELECT anio, mes, estado, cerrado_por AS "cerradoPor", cerrado_en AS "cerradoEn", reabierto_por AS "reabiertoPor", reabierto_en AS "reabiertoEn", motivo_reapertura AS "motivoReapertura" FROM periodos_contables WHERE anio = $1 AND mes = $2',
        [anio, mes]
      );
      if (current.rows[0].estado === 'cerrado') return { conflict: true, period: current.rows[0] };
      const updated = await client.query(
        `UPDATE periodos_contables
         SET estado = 'cerrado', cerrado_por = $3, cerrado_en = NOW()
         WHERE anio = $1 AND mes = $2
         RETURNING anio, mes, estado, cerrado_por AS "cerradoPor", cerrado_en AS "cerradoEn", reabierto_por AS "reabiertoPor", reabierto_en AS "reabiertoEn", motivo_reapertura AS "motivoReapertura"`,
        [anio, mes, auth.user.email]
      );
      return { conflict: false, period: updated.rows[0] };
    });

    if (period.conflict) return sendJson(res, 409, { ok: false, message: 'El período ya está cerrado', period: period.period });
    await appendAuditLog('period.close', { anio, mes }, auth.user.email);
    return sendJson(res, 200, { ok: true, period: period.period });
  }

  const state = await readStore();
  const period = ensurePeriodExists(state, anio, mes);
  if (period.estado === 'cerrado') return sendJson(res, 409, { ok: false, message: 'El período ya está cerrado', period });

  period.estado = 'cerrado';
  period.cerradoPor = auth.user.email;
  period.cerradoEn = new Date().toISOString();
  await writeStore(state);
  await appendAudit('period.close', { anio, mes }, auth.user.email);
  return sendJson(res, 200, { ok: true, period });
}

async function reopenPeriod(req, res) {
  const auth = await requireRoles(req, ['contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const anio = Number(body.anio);
  const mes = Number(body.mes);
  const motivo = body.motivo || 'sin motivo';
  assertAnioMes(anio, mes);

  if (isPostgresMode()) {
    const period = await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO periodos_contables (anio, mes, estado)
         VALUES ($1, $2, 'abierto')
         ON CONFLICT (anio, mes) DO NOTHING`,
        [anio, mes]
      );
      const current = await client.query(
        'SELECT estado FROM periodos_contables WHERE anio = $1 AND mes = $2',
        [anio, mes]
      );
      if (!current.rows.length || current.rows[0].estado !== 'cerrado') return null;
      const updated = await client.query(
        `UPDATE periodos_contables
         SET estado = 'reabierto', reabierto_por = $3, reabierto_en = NOW(), motivo_reapertura = $4
         WHERE anio = $1 AND mes = $2
         RETURNING anio, mes, estado, cerrado_por AS "cerradoPor", cerrado_en AS "cerradoEn", reabierto_por AS "reabiertoPor", reabierto_en AS "reabiertoEn", motivo_reapertura AS "motivoReapertura"`,
        [anio, mes, auth.user.email, motivo]
      );
      return updated.rows[0];
    });

    if (!period) return sendJson(res, 409, { ok: false, message: 'Solo se puede reabrir un período cerrado' });
    await appendAuditLog('period.reopen', { anio, mes, motivo }, auth.user.email);
    return sendJson(res, 200, { ok: true, period });
  }

  const state = await readStore();
  const period = ensurePeriodExists(state, anio, mes);
  if (period.estado !== 'cerrado') return sendJson(res, 409, { ok: false, message: 'Solo se puede reabrir un período cerrado', period });

  period.estado = 'reabierto';
  period.reabiertoPor = auth.user.email;
  period.reabiertoEn = new Date().toISOString();
  period.motivoReapertura = motivo;
  await writeStore(state);
  await appendAudit('period.reopen', { anio, mes, motivo }, auth.user.email);
  return sendJson(res, 200, { ok: true, period });
}

async function listPeriods(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  if (isPostgresMode()) {
    const periods = await withPgClient(async (client) => {
      const rs = await client.query(
        `SELECT anio, mes, estado, cerrado_por AS "cerradoPor", cerrado_en AS "cerradoEn", reabierto_por AS "reabiertoPor", reabierto_en AS "reabiertoEn", motivo_reapertura AS "motivoReapertura"
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

module.exports = { closePeriod, reopenPeriod, listPeriods, isPeriodClosed, isPeriodClosedInDb };
