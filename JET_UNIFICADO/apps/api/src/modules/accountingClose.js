const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');

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
    key: key(anio, mes),
    anio,
    mes,
    estado: 'abierto',
    cerradoPor: null,
    cerradoEn: null,
    reabiertoPor: null,
    reabiertoEn: null,
    motivoReapertura: null
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
  const body = await parseBody(req);
  const anio = Number(body.anio);
  const mes = Number(body.mes);
  const user = body.user || 'system';
  assertAnioMes(anio, mes);

  const state = readStore();
  const period = ensurePeriodExists(state, anio, mes);
  if (period.estado === 'cerrado') {
    return sendJson(res, 409, { ok: false, message: 'El período ya está cerrado', period });
  }

  period.estado = 'cerrado';
  period.cerradoPor = user;
  period.cerradoEn = new Date().toISOString();
  writeStore(state);
  appendAudit('period.close', { anio, mes }, user);
  return sendJson(res, 200, { ok: true, period });
}

async function reopenPeriod(req, res) {
  const body = await parseBody(req);
  const anio = Number(body.anio);
  const mes = Number(body.mes);
  const user = body.user || 'system';
  const motivo = body.motivo || 'sin motivo';
  assertAnioMes(anio, mes);

  const state = readStore();
  const period = ensurePeriodExists(state, anio, mes);
  if (period.estado !== 'cerrado') {
    return sendJson(res, 409, { ok: false, message: 'Solo se puede reabrir un período cerrado', period });
  }

  period.estado = 'reabierto';
  period.reabiertoPor = user;
  period.reabiertoEn = new Date().toISOString();
  period.motivoReapertura = motivo;
  writeStore(state);
  appendAudit('period.reopen', { anio, mes, motivo }, user);
  return sendJson(res, 200, { ok: true, period });
}

function listPeriods(_req, res) {
  const state = readStore();
  const sorted = [...state.periodos].sort((a, b) => (a.anio - b.anio) || (a.mes - b.mes));
  return sendJson(res, 200, { ok: true, periods: sorted });
}

module.exports = {
  closePeriod,
  reopenPeriod,
  listPeriods,
  isPeriodClosed,
  assertAnioMes
};
