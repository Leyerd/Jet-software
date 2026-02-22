const crypto = require('crypto');
const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { appendAuditLog } = require('../lib/postgresRepo');

function ensureNormative(state) {
  if (!Array.isArray(state.normativeChanges)) state.normativeChanges = [];
  if (!Array.isArray(state.normativeRegressionRuns)) state.normativeRegressionRuns = [];
  if (!state.normativePolicy || typeof state.normativePolicy !== 'object') {
    state.normativePolicy = {
      monthlyReviewEnabled: true,
      ownerRole: 'contador_admin',
      hotfixWindowHours: 24,
      lastReviewedAt: null
    };
  }
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function listChanges(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const state = await readStore();
  ensureNormative(state);
  await writeStore(state);
  return sendJson(res, 200, { ok: true, policy: state.normativePolicy, changes: state.normativeChanges, runs: state.normativeRegressionRuns.slice(-20) });
}

async function registerChange(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const title = String(body.title || '').trim();
  const source = String(body.source || '').trim();
  const effectiveDate = String(body.effectiveDate || '').trim();
  const impactedAreas = Array.isArray(body.impactedAreas) ? body.impactedAreas : [];

  if (title.length < 5) return sendJson(res, 400, { ok: false, message: 'title mínimo 5 caracteres' });
  if (!source) return sendJson(res, 400, { ok: false, message: 'source requerida' });
  if (!effectiveDate) return sendJson(res, 400, { ok: false, message: 'effectiveDate requerida' });

  const state = await readStore();
  ensureNormative(state);

  const change = {
    id: newId('NORM'),
    title,
    source,
    effectiveDate,
    impactedAreas,
    notes: body.notes || '',
    status: 'pending_regression',
    createdBy: auth.user.email,
    createdAt: new Date().toISOString(),
    hash: hashPayload({ title, source, effectiveDate, impactedAreas, notes: body.notes || '' })
  };

  state.normativeChanges.push(change);
  state.normativePolicy.lastReviewedAt = new Date().toISOString();
  await writeStore(state);
  await appendAudit('normative.change.registered', { id: change.id, title, effectiveDate, hash: change.hash }, auth.user.email);
  await appendAuditLog('normative.change.registered', { id: change.id, title, effectiveDate, hash: change.hash }, auth.user.email);

  return sendJson(res, 201, { ok: true, change });
}

function buildRegressionSummary(changes) {
  const pending = changes.filter((c) => c.status !== 'validated').length;
  const validated = changes.filter((c) => c.status === 'validated').length;
  return { pending, validated, total: changes.length };
}

async function runRegression(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const targetYear = Number(body.targetYear || new Date().getFullYear());

  const state = await readStore();
  ensureNormative(state);
  const run = {
    id: newId('REG'),
    targetYear,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    summary: buildRegressionSummary(state.normativeChanges),
    status: 'ok',
    executedBy: auth.user.email
  };

  state.normativeRegressionRuns.push(run);
  state.normativeChanges = state.normativeChanges.map((c) => ({ ...c, status: 'validated', validatedAt: run.finishedAt, validatedBy: auth.user.email }));
  await writeStore(state);
  await appendAudit('normative.regression.run', { id: run.id, targetYear, summary: run.summary }, auth.user.email);
  await appendAuditLog('normative.regression.run', { id: run.id, targetYear, summary: run.summary }, auth.user.email);

  return sendJson(res, 200, { ok: true, run, changes: state.normativeChanges });
}

module.exports = {
  ensureNormative,
  listChanges,
  registerChange,
  runRegression
};
