const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { appendAuditLog } = require('../lib/postgresRepo');

const CRITICAL_TASKS = {
  cierre: {
    key: 'cierre',
    name: 'Cierre mensual',
    runbookId: 'RB-CIERRE-001',
    steps: [
      { id: 'cierre-1', title: 'Validar consistencia contable', requiresEvidence: true, evidenceHint: 'Adjuntar hash/trace de /periods/close-checklist' },
      { id: 'cierre-2', title: 'Revisar brechas críticas A7', requiresEvidence: true, evidenceHint: 'Adjuntar id de reporte /reconciliation/cross-check' },
      { id: 'cierre-3', title: 'Emitir confirmación de cierre', requiresEvidence: false, evidenceHint: '' }
    ]
  },
  f29: {
    key: 'f29',
    name: 'Formulario 29',
    runbookId: 'RB-F29-001',
    steps: [
      { id: 'f29-1', title: 'Preparar base IVA ventas/compras', requiresEvidence: true, evidenceHint: 'Folio consolidado o hash de exportación' },
      { id: 'f29-2', title: 'Validar PPM y retenciones', requiresEvidence: true, evidenceHint: 'Referencia de cálculo/planilla' },
      { id: 'f29-3', title: 'Confirmar envío al SII', requiresEvidence: true, evidenceHint: 'Folio de acuse SII' }
    ]
  },
  f22: {
    key: 'f22',
    name: 'Formulario 22',
    runbookId: 'RB-F22-001',
    steps: [
      { id: 'f22-1', title: 'Consolidar resultado tributario anual', requiresEvidence: true, evidenceHint: 'Hash de propuesta anual A6' },
      { id: 'f22-2', title: 'Validar régimen y créditos', requiresEvidence: true, evidenceHint: 'Referencia de soporte de crédito' },
      { id: 'f22-3', title: 'Confirmar acuse de declaración', requiresEvidence: true, evidenceHint: 'N° de folio de envío' }
    ]
  },
  ddjj: {
    key: 'ddjj',
    name: 'Declaraciones juradas',
    runbookId: 'RB-DDJJ-001',
    steps: [
      { id: 'ddjj-1', title: 'Generar nómina de DDJJ aplicables', requiresEvidence: true, evidenceHint: 'Listado/export con versión' },
      { id: 'ddjj-2', title: 'Validar trazabilidad por actor', requiresEvidence: true, evidenceHint: 'Usuario responsable + timestamp' },
      { id: 'ddjj-3', title: 'Registrar envío y acuse', requiresEvidence: true, evidenceHint: 'Folio de recepción' }
    ]
  }
};

function ensureGuidedStructures(state) {
  if (!Array.isArray(state.guidedTaskExecutions)) state.guidedTaskExecutions = [];
}

function periodKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function resolveTask(key) {
  const task = CRITICAL_TASKS[String(key || '').toLowerCase()];
  if (!task) throw new Error('taskKey inválido. Usa cierre, f29, f22 o ddjj');
  return task;
}

function buildFlowState(task, period, executions) {
  const completedByStep = new Map();
  for (const ex of executions) {
    if (ex.taskKey === task.key && ex.period === period && ex.status === 'done') {
      completedByStep.set(ex.stepId, ex);
    }
  }

  const steps = task.steps.map((step, index) => {
    const completion = completedByStep.get(step.id);
    return {
      ...step,
      order: index + 1,
      status: completion ? 'done' : 'pending',
      completedAt: completion?.completedAt || null,
      completedBy: completion?.completedBy || null,
      evidenceRef: completion?.evidenceRef || null
    };
  });

  let blockingStep = null;
  for (const step of steps) {
    if (step.status === 'pending') {
      blockingStep = {
        stepId: step.id,
        title: step.title,
        reason: step.requiresEvidence
          ? 'Checklist bloqueante: confirma evidencia antes de continuar.'
          : 'Debe completarse este paso antes de avanzar.'
      };
      break;
    }
  }

  return {
    taskKey: task.key,
    taskName: task.name,
    period,
    runbookId: task.runbookId,
    steps,
    summary: { completed: steps.filter((x) => x.status === 'done').length, total: steps.length },
    blocked: Boolean(blockingStep),
    blockingStep
  };
}

async function getGuidedFlow(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const query = req.url.includes('?') ? new URL(req.url, 'http://localhost').searchParams : new URLSearchParams();
  const year = Number(query.get('year') || new Date().getFullYear());
  const month = Number(query.get('month') || (new Date().getMonth() + 1));
  const task = resolveTask(query.get('task') || 'cierre');

  const state = await readStore();
  ensureGuidedStructures(state);
  const period = periodKey(year, month);
  const flow = buildFlowState(task, period, state.guidedTaskExecutions);
  const traceId = `guided-${task.key}-${period}-${Date.now()}`;

  await appendAudit('guided.flow.viewed', { taskKey: task.key, period, traceId }, auth.user.email);
  await appendAuditLog('guided.flow.viewed', { taskKey: task.key, period, traceId }, auth.user.email);

  return sendJson(res, 200, { ok: true, traceId, flow });
}

async function completeGuidedStep(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const now = new Date();
  const year = Number(body.year || now.getFullYear());
  const month = Number(body.month || (now.getMonth() + 1));
  const task = resolveTask(body.taskKey);
  const stepId = String(body.stepId || '').trim();
  const evidenceConfirmed = Boolean(body.evidenceConfirmed);
  const evidenceRef = String(body.evidenceRef || '').trim();

  const step = task.steps.find((x) => x.id === stepId);
  if (!step) return sendJson(res, 400, { ok: false, message: 'stepId inválido para la tarea indicada' });
  if (step.requiresEvidence && !evidenceConfirmed) {
    return sendJson(res, 400, { ok: false, message: 'Paso bloqueado: debes confirmar evidencia para continuar' });
  }
  if (step.requiresEvidence && !evidenceRef) {
    return sendJson(res, 400, { ok: false, message: 'Paso bloqueado: evidenceRef requerido para pasos críticos' });
  }

  const state = await readStore();
  ensureGuidedStructures(state);
  const period = periodKey(year, month);
  const flowBefore = buildFlowState(task, period, state.guidedTaskExecutions);
  const nextPending = flowBefore.steps.find((x) => x.status === 'pending');
  if (!nextPending) return sendJson(res, 200, { ok: true, message: 'La tarea ya se encontraba completada', flow: flowBefore });
  if (nextPending.id !== step.id) {
    return sendJson(res, 409, { ok: false, message: `Paso fuera de orden. Debes completar primero ${nextPending.id}` });
  }

  state.guidedTaskExecutions.push({
    taskKey: task.key,
    stepId: step.id,
    period,
    status: 'done',
    guided: true,
    evidenceConfirmed,
    evidenceRef: evidenceRef || null,
    completedBy: auth.user.email,
    completedAt: now.toISOString()
  });
  await writeStore(state);

  await appendAudit('guided.flow.step_completed', { taskKey: task.key, stepId: step.id, period, evidenceRef: evidenceRef || null }, auth.user.email);
  await appendAuditLog('guided.flow.step_completed', { taskKey: task.key, stepId: step.id, period, evidenceRef: evidenceRef || null }, auth.user.email);

  const flow = buildFlowState(task, period, state.guidedTaskExecutions);
  return sendJson(res, 200, { ok: true, flow });
}

async function getRunbooks(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const runbooks = Object.values(CRITICAL_TASKS).map((task) => ({
    runbookId: task.runbookId,
    taskKey: task.key,
    taskName: task.name,
    objective: `Ejecutar ${task.name} sin errores manuales y con evidencia trazable.`,
    controls: task.steps.map((step) => ({ stepId: step.id, title: step.title, requiresEvidence: step.requiresEvidence, evidenceHint: step.evidenceHint }))
  }));

  const state = await readStore();
  ensureGuidedStructures(state);
  const guidedDone = state.guidedTaskExecutions.filter((x) => x.guided).length;
  const totalExpected = Object.values(CRITICAL_TASKS).reduce((acc, task) => acc + task.steps.length, 0);
  const guidedRatio = totalExpected ? Number((guidedDone / totalExpected).toFixed(2)) : 0;

  return sendJson(res, 200, {
    ok: true,
    runbooks,
    gate: {
      target: 0.9,
      guidedRatio,
      reached: guidedRatio >= 0.9,
      note: 'Meta A8: al menos 90% de tareas críticas ejecutadas por flujo guiado.'
    }
  });
}

module.exports = {
  getGuidedFlow,
  completeGuidedStep,
  getRunbooks,
  ensureGuidedStructures
};
