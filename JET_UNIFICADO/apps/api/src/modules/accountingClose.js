const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');

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

async function closePeriod(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const anio = Number(body.anio);
  const mes = Number(body.mes);
  assertAnioMes(anio, mes);

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

async function listPeriods(_req, res) {
  const state = await readStore();
  const sorted = [...state.periodos].sort((a, b) => (a.anio - b.anio) || (a.mes - b.mes));
  return sendJson(res, 200, { ok: true, periods: sorted });
}

module.exports = { closePeriod, reopenPeriod, listPeriods, isPeriodClosed, assertAnioMes };
