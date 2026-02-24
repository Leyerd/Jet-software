const crypto = require('crypto');
const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { appendAuditLog } = require('../lib/postgresRepo');

const OBLIGATION_TEMPLATES = [
  { code: 'F29', name: 'Formulario 29', day: 20, severity: 'critical' },
  { code: 'DDJJ', name: 'Declaraciones Juradas', day: 25, severity: 'high' },
  { code: 'F22', name: 'Formulario 22', annual: true, month: 4, day: 30, severity: 'critical' },
  { code: 'PATENTE', name: 'Patente Comercial', annual: true, month: 7, day: 31, severity: 'medium' }
];

function ensureComplianceStructures(state) {
  if (!Array.isArray(state.complianceObligations)) state.complianceObligations = [];
  if (!Array.isArray(state.complianceEvidence)) state.complianceEvidence = [];
  if (!state.complianceConfig || typeof state.complianceConfig !== 'object') {
    state.complianceConfig = {
      taxpayerType: 'EIRL',
      alerts: { emailEnabled: false, webhookEnabled: false, emailTo: '', webhookUrl: '' },
      escalationDaysBefore: [7, 3, 1]
    };
  }
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function toIsoDate(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}

function adjustBusinessDay(date) {
  const d = new Date(date);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

function buildPeriodObligations(year, month) {
  return OBLIGATION_TEMPLATES.filter((tpl) => {
    if (!tpl.annual) return true;
    return Number(month) === Number(tpl.month);
  }).map((tpl) => {
    const dueRaw = new Date(year, (tpl.annual ? tpl.month - 1 : month - 1), tpl.day);
    const due = adjustBusinessDay(dueRaw);
    return {
      key: `${tpl.code}-${year}-${String(month).padStart(2, '0')}`,
      code: tpl.code,
      name: tpl.name,
      period: `${year}-${String(month).padStart(2, '0')}`,
      dueDate: toIsoDate(due),
      severity: tpl.severity
    };
  });
}

function riskStatus(ob, today = new Date()) {
  const due = new Date(`${ob.dueDate}T00:00:00Z`);
  const diffDays = Math.floor((due - new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))) / (1000 * 60 * 60 * 24));
  const lifecycle = String(ob.lifecycleStatus || 'pendiente').toLowerCase();
  if (lifecycle === 'acuse') return { color: 'verde', reason: 'Obligación con acuse registrado' };
  if (diffDays < 0) return { color: 'rojo', reason: 'Obligación vencida sin acuse' };
  if (diffDays <= 3) return { color: 'amarillo', reason: 'Próxima a vencer' };
  return { color: 'verde', reason: 'Dentro de plazo' };
}

function buildEscalations(obligations, config) {
  const levels = Array.isArray(config?.escalationDaysBefore) ? config.escalationDaysBefore : [7, 3, 1];
  const today = new Date();
  return obligations.flatMap((ob) => {
    const due = new Date(`${ob.dueDate}T00:00:00Z`);
    const diffDays = Math.floor((due - new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))) / (1000 * 60 * 60 * 24));
    const risk = riskStatus(ob, today);
    if (risk.color === 'rojo' || levels.includes(diffDays)) {
      return [{
        obligationKey: ob.key,
        severity: risk.color === 'rojo' ? 'critical' : 'high',
        message: `Alerta ${ob.code}: ${risk.reason} (vence ${ob.dueDate})`,
        channels: {
          email: Boolean(config?.alerts?.emailEnabled),
          webhook: Boolean(config?.alerts?.webhookEnabled)
        }
      }];
    }
    return [];
  });
}

async function loadOrCreateObligations(year, month) {
  const state = await readStore();
  ensureComplianceStructures(state);
  const generated = buildPeriodObligations(year, month);
  for (const g of generated) {
    if (!state.complianceObligations.some((x) => x.key === g.key)) {
      state.complianceObligations.push({
        id: id('OBL'),
        ...g,
        lifecycleStatus: 'pendiente',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }
  await writeStore(state);
  return state;
}


function evaluateComplianceBlockers(state, today = new Date()) {
  ensureComplianceStructures(state);
  const now = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const overdueCritical = (state.complianceObligations || []).filter((ob) => {
    if (!ob || String(ob.severity || '').toLowerCase() !== 'critical') return false;
    const lifecycle = String(ob.lifecycleStatus || 'pendiente').toLowerCase();
    if (lifecycle === 'acuse') return false;
    const due = new Date(`${ob.dueDate}T00:00:00Z`);
    return Number.isFinite(due.getTime()) && due < now;
  });
  return {
    blocked: overdueCritical.length > 0,
    reason: overdueCritical.length ? 'Existen obligaciones críticas vencidas sin acuse.' : 'Sin bloqueos críticos de cumplimiento.',
    blockers: overdueCritical.map((ob) => ({
      key: ob.key,
      code: ob.code,
      period: ob.period,
      dueDate: ob.dueDate,
      lifecycleStatus: ob.lifecycleStatus,
      severity: ob.severity
    }))
  };
}

async function getComplianceBlockers(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const state = await readStore();
  const result = evaluateComplianceBlockers(state);
  return sendJson(res, 200, { ok: true, ...result, generatedAt: new Date().toISOString() });
}

async function getCalendar(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const query = req.url.includes('?') ? new URL(req.url, 'http://localhost').searchParams : new URLSearchParams();
  const year = Number(query.get('year') || new Date().getFullYear());
  const month = Number(query.get('month') || (new Date().getMonth() + 1));

  const state = await loadOrCreateObligations(year, month);
  const obligations = state.complianceObligations.filter((x) => x.period === `${year}-${String(month).padStart(2, '0')}`);
  const escalations = buildEscalations(obligations, state.complianceConfig);

  return sendJson(res, 200, { ok: true, calendar: { year, month, obligations, escalations, taxpayerType: state.complianceConfig.taxpayerType } });
}

async function getSemaphore(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const query = req.url.includes('?') ? new URL(req.url, 'http://localhost').searchParams : new URLSearchParams();
  const year = Number(query.get('year') || new Date().getFullYear());
  const month = Number(query.get('month') || (new Date().getMonth() + 1));

  const state = await loadOrCreateObligations(year, month);
  const obligations = state.complianceObligations.filter((x) => x.period === `${year}-${String(month).padStart(2, '0')}`);
  const semaforo = obligations.map((ob) => ({ ...ob, risk: riskStatus(ob) }));
  const summary = {
    verde: semaforo.filter((x) => x.risk.color === 'verde').length,
    amarillo: semaforo.filter((x) => x.risk.color === 'amarillo').length,
    rojo: semaforo.filter((x) => x.risk.color === 'rojo').length
  };

  return sendJson(res, 200, { ok: true, semaforo, summary, generatedAt: new Date().toISOString() });
}

function hashEvidence(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function registerEvidence(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const key = String(body.obligationKey || '').trim();
  const lifecycleStatus = String(body.lifecycleStatus || '').trim().toLowerCase();

  if (!key) return sendJson(res, 400, { ok: false, message: 'obligationKey requerido' });
  if (!['preparado', 'validado', 'enviado', 'acuse'].includes(lifecycleStatus)) {
    return sendJson(res, 400, { ok: false, message: 'lifecycleStatus inválido' });
  }

  const state = await readStore();
  ensureComplianceStructures(state);
  const ob = state.complianceObligations.find((x) => x.key === key);
  if (!ob) return sendJson(res, 404, { ok: false, message: 'Obligación no encontrada' });

  const evidencePayload = {
    obligationKey: key,
    lifecycleStatus,
    sentAt: body.sentAt || new Date().toISOString(),
    ackNumber: body.ackNumber || null,
    source: body.source || 'manual',
    notes: body.notes || null,
    user: auth.user.email
  };
  const evidence = {
    id: id('EVD'),
    ...evidencePayload,
    hash: hashEvidence(evidencePayload),
    createdAt: new Date().toISOString()
  };
  state.complianceEvidence.push(evidence);
  ob.lifecycleStatus = lifecycleStatus;
  ob.updatedAt = new Date().toISOString();

  await writeStore(state);
  await appendAudit('compliance.evidence.registered', { obligationKey: key, lifecycleStatus, evidenceId: evidence.id, hash: evidence.hash }, auth.user.email);
  await appendAuditLog('compliance.evidence.registered', { obligationKey: key, lifecycleStatus, evidenceId: evidence.id, hash: evidence.hash }, auth.user.email);

  return sendJson(res, 201, { ok: true, evidence, obligation: ob });
}

async function updateComplianceConfig(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);

  const state = await readStore();
  ensureComplianceStructures(state);
  state.complianceConfig = {
    ...state.complianceConfig,
    taxpayerType: body.taxpayerType || state.complianceConfig.taxpayerType,
    alerts: {
      ...state.complianceConfig.alerts,
      ...(body.alerts || {})
    },
    escalationDaysBefore: Array.isArray(body.escalationDaysBefore) && body.escalationDaysBefore.length
      ? body.escalationDaysBefore.map((x) => Number(x)).filter((x) => !Number.isNaN(x))
      : state.complianceConfig.escalationDaysBefore
  };
  await writeStore(state);
  await appendAudit('compliance.config.updated', { taxpayerType: state.complianceConfig.taxpayerType, alerts: state.complianceConfig.alerts }, auth.user.email);
  await appendAuditLog('compliance.config.updated', { taxpayerType: state.complianceConfig.taxpayerType, alerts: state.complianceConfig.alerts }, auth.user.email);

  return sendJson(res, 200, { ok: true, config: state.complianceConfig });
}

module.exports = {
  getCalendar,
  getSemaphore,
  getComplianceBlockers,
  registerEvidence,
  updateComplianceConfig,
  ensureComplianceStructures,
  evaluateComplianceBlockers
};
