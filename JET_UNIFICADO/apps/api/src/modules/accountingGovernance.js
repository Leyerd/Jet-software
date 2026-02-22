const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { appendAuditLog } = require('../lib/postgresRepo');

const DEFAULT_CHART = [
  { code: '1101', name: 'Caja/Bancos', type: 'activo', parent: null, centerRequired: false },
  { code: '1201', name: 'Inventarios', type: 'activo', parent: null, centerRequired: false },
  { code: '2101', name: 'Proveedores', type: 'pasivo', parent: null, centerRequired: false },
  { code: '4101', name: 'Ingresos por ventas', type: 'resultado', parent: null, centerRequired: true },
  { code: '5101', name: 'Gastos operacionales', type: 'resultado', parent: null, centerRequired: true }
];

const DEFAULT_RULES = [
  { eventType: 'VENTA', debitAccount: '1101', creditAccount: '4101', requiresCostCenter: true },
  { eventType: 'GASTO_LOCAL', debitAccount: '5101', creditAccount: '1101', requiresCostCenter: true },
  { eventType: 'IMPORTACION', debitAccount: '1201', creditAccount: '2101', requiresCostCenter: false }
];

function ensureGovernance(state) {
  if (!Array.isArray(state.chartOfAccounts) || !state.chartOfAccounts.length) {
    state.chartOfAccounts = DEFAULT_CHART.map((x) => ({ ...x, active: true, version: 1 }));
  }
  if (!Array.isArray(state.accountingRules) || !state.accountingRules.length) {
    state.accountingRules = DEFAULT_RULES.map((x) => ({ ...x, active: true, version: 1 }));
  }
  if (!Array.isArray(state.costCenters)) {
    state.costCenters = [{ id: 'CC-GENERAL', name: 'General', active: true }];
  }
  if (!Array.isArray(state.approvalRequests)) state.approvalRequests = [];
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function getChart(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const state = await readStore();
  ensureGovernance(state);
  await writeStore(state);
  return sendJson(res, 200, { ok: true, chartOfAccounts: state.chartOfAccounts, costCenters: state.costCenters });
}

async function updateChart(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  if (!Array.isArray(body.chartOfAccounts) || !body.chartOfAccounts.length) return sendJson(res, 400, { ok: false, message: 'chartOfAccounts requerido' });

  const state = await readStore();
  ensureGovernance(state);
  state.chartOfAccounts = body.chartOfAccounts.map((x) => ({ ...x, active: x.active !== false, version: Number(x.version || 1) }));
  if (Array.isArray(body.costCenters) && body.costCenters.length) {
    state.costCenters = body.costCenters.map((x) => ({ id: x.id, name: x.name, active: x.active !== false }));
  }
  await writeStore(state);
  await appendAudit('governance.chart.updated', { accounts: state.chartOfAccounts.length, centers: state.costCenters.length }, auth.user.email);
  await appendAuditLog('governance.chart.updated', { accounts: state.chartOfAccounts.length, centers: state.costCenters.length }, auth.user.email);
  return sendJson(res, 200, { ok: true, chartOfAccounts: state.chartOfAccounts, costCenters: state.costCenters });
}

async function getRules(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const state = await readStore();
  ensureGovernance(state);
  await writeStore(state);
  return sendJson(res, 200, { ok: true, accountingRules: state.accountingRules });
}

async function updateRules(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  if (!Array.isArray(body.accountingRules) || !body.accountingRules.length) return sendJson(res, 400, { ok: false, message: 'accountingRules requerido' });

  const state = await readStore();
  ensureGovernance(state);
  state.accountingRules = body.accountingRules.map((x) => ({ ...x, active: x.active !== false, version: Number(x.version || 1) }));
  await writeStore(state);
  await appendAudit('governance.rules.updated', { rules: state.accountingRules.length }, auth.user.email);
  await appendAuditLog('governance.rules.updated', { rules: state.accountingRules.length }, auth.user.email);
  return sendJson(res, 200, { ok: true, accountingRules: state.accountingRules });
}

function consistencyCheck(state) {
  const movs = state.movimientos || [];
  const ventas = movs.filter((m) => String(m.tipo).toUpperCase() === 'VENTA').reduce((s, m) => s + Number(m.neto || m.total || 0), 0);
  const rcvVentas = (state.rcvVentas || []).reduce((s, x) => s + Number(x.neto || x.total || 0), 0);
  const flujoIngresos = (state.flujoCaja || []).filter((f) => String(f.tipoMovimiento).toUpperCase() === 'INGRESO').reduce((s, f) => s + Number(f.monto || 0), 0);

  const inventarioMov = movs.filter((m) => String(m.tipo).toUpperCase() === 'VENTA').reduce((s, m) => s + Number(m.costoMercaderia || 0), 0);
  const inventarioStock = (state.productos || []).reduce((s, p) => s + Number(p.stock || 0) * Number(p.costoPromedio || 0), 0);

  const difVentasRcv = Math.round((ventas - rcvVentas) * 100) / 100;
  const difVentasFlujo = Math.round((ventas - flujoIngresos) * 100) / 100;
  const difInventario = Math.round((inventarioStock - inventarioMov) * 100) / 100;

  const observations = [];
  if (Math.abs(difVentasRcv) > 1000) observations.push({ key: 'ventas-vs-rcv', severity: 'high', diff: difVentasRcv });
  if (Math.abs(difVentasFlujo) > 1000) observations.push({ key: 'ventas-vs-flujo', severity: 'high', diff: difVentasFlujo });
  if (Math.abs(difInventario) > 5000) observations.push({ key: 'inventario-vs-costo', severity: 'medium', diff: difInventario });

  return {
    checks: [
      { key: 'ventas-vs-rcv', valueA: ventas, valueB: rcvVentas, diff: difVentasRcv },
      { key: 'ventas-vs-flujo', valueA: ventas, valueB: flujoIngresos, diff: difVentasFlujo },
      { key: 'inventario-vs-costo', valueA: inventarioStock, valueB: inventarioMov, diff: difInventario }
    ],
    observations,
    passed: observations.length === 0
  };
}

async function runConsistencyCheck(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const state = await readStore();
  ensureGovernance(state);
  const result = consistencyCheck(state);
  await appendAudit('governance.consistency.check', { passed: result.passed, observations: result.observations }, auth.user.email);
  await appendAuditLog('governance.consistency.check', { passed: result.passed, observations: result.observations }, auth.user.email);
  return sendJson(res, 200, { ok: true, result });
}

async function createApprovalRequest(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const actionType = String(body.actionType || '').trim();
  const reason = String(body.reason || '').trim();
  if (!actionType) return sendJson(res, 400, { ok: false, message: 'actionType requerido' });
  if (reason.length < 10) return sendJson(res, 400, { ok: false, message: 'reason mínimo 10 caracteres' });

  const state = await readStore();
  ensureGovernance(state);
  const reqRow = {
    id: newId('APR'),
    actionType,
    payload: body.payload || {},
    reason,
    status: 'pending',
    requestedBy: auth.user.email,
    requestedAt: new Date().toISOString(),
    approvals: []
  };
  state.approvalRequests.push(reqRow);
  await writeStore(state);
  await appendAudit('governance.approval.requested', { id: reqRow.id, actionType }, auth.user.email);
  await appendAuditLog('governance.approval.requested', { id: reqRow.id, actionType }, auth.user.email);
  return sendJson(res, 201, { ok: true, request: reqRow });
}

async function approveRequest(req, res) {
  const auth = await requireRoles(req, ['dueno']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const requestId = String(body.requestId || '').trim();
  if (!requestId) return sendJson(res, 400, { ok: false, message: 'requestId requerido' });

  const state = await readStore();
  ensureGovernance(state);
  const r = state.approvalRequests.find((x) => x.id === requestId);
  if (!r) return sendJson(res, 404, { ok: false, message: 'Solicitud no encontrada' });
  if (r.status === 'approved') return sendJson(res, 200, { ok: true, request: r });
  if (String(r.requestedBy).toLowerCase() === String(auth.user.email).toLowerCase()) {
    return sendJson(res, 409, { ok: false, message: 'Aprobador debe ser distinto al solicitante' });
  }

  if (!r.approvals.some((a) => a.email === auth.user.email)) {
    r.approvals.push({ email: auth.user.email, at: new Date().toISOString() });
  }
  if (r.approvals.length >= 1) {
    r.status = 'approved';
    r.approvedAt = new Date().toISOString();
  }
  await writeStore(state);
  await appendAudit('governance.approval.approved', { requestId: r.id, actionType: r.actionType }, auth.user.email);
  await appendAuditLog('governance.approval.approved', { requestId: r.id, actionType: r.actionType }, auth.user.email);
  return sendJson(res, 200, { ok: true, request: r });
}

async function assertApprovedRequest(actionType, requestId) {
  if (!requestId) throw new Error('approvalRequestId requerido para acción crítica');
  const state = await readStore();
  ensureGovernance(state);
  const r = state.approvalRequests.find((x) => x.id === requestId);
  if (!r) throw new Error('approvalRequestId no encontrado');
  if (r.actionType !== actionType) throw new Error('approvalRequestId no corresponde al tipo de acción');
  if (r.status !== 'approved') throw new Error('approvalRequestId no aprobado');
  return r;
}

module.exports = {
  ensureGovernance,
  getChart,
  updateChart,
  getRules,
  updateRules,
  runConsistencyCheck,
  createApprovalRequest,
  approveRequest,
  assertApprovedRequest
};
