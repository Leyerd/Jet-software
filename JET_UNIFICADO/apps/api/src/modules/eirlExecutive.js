const crypto = require('crypto');
const { sendJson } = require('../lib/http');
const { readStore } = require('../lib/store');
const { requireRoles } = require('./auth');

function stableHash(obj) {
  const norm = JSON.stringify(obj, Object.keys(obj).sort());
  return crypto.createHash('sha256').update(norm).digest('hex');
}

function buildAuditPackage(state, year, month) {
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const movs = (state.movimientos || []).filter((m) => {
    const d = new Date(m.fecha);
    return !Number.isNaN(d.getTime()) && d.getFullYear() === year && (d.getMonth() + 1) === month;
  });
  const evid = (state.complianceEvidence || []).filter((e) => String(e.obligationKey || '').includes(period));
  const obligations = (state.complianceObligations || []).filter((o) => o.period === period);
  const auditLog = (state.auditLog || []).filter((a) => String(a.createdAt || '').startsWith(`${year}-${String(month).padStart(2, '0')}`));

  const packageData = {
    period,
    generatedAt: new Date().toISOString(),
    books: {
      movimientos: movs,
      obligations,
      evidence: evid
    },
    auditTrail: auditLog,
    hashes: {
      movimientos: stableHash(movs),
      obligations: stableHash(obligations),
      evidence: stableHash(evid),
      auditTrail: stableHash(auditLog)
    }
  };
  packageData.hashChain = stableHash(packageData.hashes);
  return packageData;
}

function runRiskSimulation(state, year, month) {
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const obligations = (state.complianceObligations || []).filter((o) => o.period === period);
  const riskItems = obligations.map((o) => {
    const due = new Date(`${o.dueDate}T00:00:00Z`);
    const daysLate = Math.max(0, Math.floor((Date.now() - due.getTime()) / (1000 * 60 * 60 * 24)));
    const base = o.code === 'F29' ? 3 : o.code === 'F22' ? 4 : 2;
    const exposure = Math.round((base * 25000) + (daysLate * 7000));
    const probability = o.lifecycleStatus === 'acuse' ? 0.05 : daysLate > 0 ? 0.85 : 0.35;
    return {
      obligationKey: o.key,
      severity: o.severity,
      lifecycleStatus: o.lifecycleStatus,
      daysLate,
      probability,
      exposure,
      expectedRisk: Math.round(exposure * probability)
    };
  }).sort((a, b) => b.expectedRisk - a.expectedRisk);

  return {
    period,
    totalExpectedRisk: riskItems.reduce((s, x) => s + x.expectedRisk, 0),
    highRiskCount: riskItems.filter((x) => x.expectedRisk >= 60000).length,
    items: riskItems
  };
}

function buildExecutiveDashboard(state, year, month) {
  const movsYear = (state.movimientos || []).filter((m) => new Date(m.fecha).getFullYear() === year);
  const sales = movsYear.filter((m) => String(m.tipo).toUpperCase() === 'VENTA').reduce((s, m) => s + Number(m.neto || m.total || 0), 0);
  const expenses = movsYear.filter((m) => ['GASTO_LOCAL', 'HONORARIOS', 'IMPORTACION'].includes(String(m.tipo).toUpperCase())).reduce((s, m) => s + Number(m.neto || m.total || 0), 0);
  const cash = (state.cuentas || []).reduce((s, c) => s + Number(c.saldo || 0), 0);
  const criticalStock = (state.productos || []).filter((p) => Number(p.stock || 0) <= 5).length;
  const compliance = (state.complianceObligations || []).filter((o) => o.period === `${year}-${String(month).padStart(2, '0')}`);
  const complianceScore = compliance.length ? Math.round((compliance.filter((x) => x.lifecycleStatus === 'acuse').length / compliance.length) * 100) : 100;

  const priorities = [];
  const periodKey = `${year}-${String(month).padStart(2, '0')}`;
  const overdueCritical = compliance.filter((o) => o.severity === 'critical' && String(o.lifecycleStatus || '').toLowerCase() !== 'acuse' && new Date(`${o.dueDate}T00:00:00Z`) < new Date());
  if (overdueCritical.length) {
    priorities.push({
      priority: 'alta',
      area: 'Cumplimiento fiscal',
      action: `Regularizar ${overdueCritical.length} obligación(es) crítica(s) vencida(s) y cargar acuse.`,
      reason: 'Hay riesgo de multa por obligaciones críticas sin acuse.'
    });
  }
  if (cash < 0) {
    priorities.push({
      priority: 'alta',
      area: 'Caja',
      action: 'Ajustar egresos de la semana y priorizar cobranza de ventas pendientes.',
      reason: 'La caja disponible está negativa.'
    });
  }
  if (criticalStock > 0) {
    priorities.push({
      priority: 'media',
      area: 'Operación',
      action: `Reponer ${criticalStock} producto(s) en stock crítico para no frenar ventas.`,
      reason: 'Riesgo de quiebre de stock en operación diaria.'
    });
  }
  if (!priorities.length) {
    priorities.push({
      priority: 'normal',
      area: 'Seguimiento',
      action: `Mantener control semanal de ${periodKey} y generar reporte ejecutivo para revisión de dueño.`,
      reason: 'No se detectan brechas críticas hoy.'
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    financial: {
      cash,
      sales,
      expenses,
      margin: Math.round((sales - expenses) * 100) / 100
    },
    operations: {
      criticalStock,
      productCount: (state.productos || []).length,
      movementCount: movsYear.length
    },
    compliance: {
      period: periodKey,
      score: complianceScore,
      obligations: compliance.length,
      withAck: compliance.filter((x) => x.lifecycleStatus === 'acuse').length
    },
    ownerSummary: {
      cashStatus: cash >= 0 ? 'Caja saludable para operar' : 'Caja en riesgo, requiere ajuste inmediato',
      taxStatus: complianceScore >= 85 ? 'Cumplimiento fiscal controlado' : 'Cumplimiento fiscal con riesgo relevante',
      businessStatus: (sales - expenses) >= 0 ? 'Operación rentable en el período' : 'Operación con margen presionado'
    },
    todayPriorities: priorities
  };
}

function parseYearMonth(req) {
  const query = req.url.includes('?') ? new URL(req.url, 'http://localhost').searchParams : new URLSearchParams();
  const year = Number(query.get('year') || new Date().getFullYear());
  const month = Number(query.get('month') || (new Date().getMonth() + 1));
  return { year, month };
}

function buildAnnualFiscalProposal(state, year, regime = '14D3') {
  const movsYear = (state.movimientos || []).filter((m) => {
    const d = new Date(m.fecha);
    return !Number.isNaN(d.getTime()) && d.getFullYear() === year;
  });
  const salesNet = movsYear
    .filter((m) => String(m.tipo || '').toUpperCase() === 'VENTA')
    .reduce((s, m) => s + Number(m.neto || m.total || 0), 0);
  const expenseNet = movsYear
    .filter((m) => ['GASTO_LOCAL', 'HONORARIOS', 'IMPORTACION', 'COMPRA'].includes(String(m.tipo || '').toUpperCase()))
    .reduce((s, m) => s + Number(m.neto || m.total || 0), 0);

  const taxableBase = Math.max(0, salesNet - expenseNet);
  const rate = regime === '14D8' ? 0.0 : 0.25;
  const companyEstimate = Math.round(taxableBase * rate);
  const ownerEstimate = Math.round(Math.max(0, taxableBase * (regime === '14D8' ? 0.15 : 0.12)));

  const docs = (state.documentosFiscales || []).filter((d) => {
    const issued = new Date(d.fechaEmision || d.fecha || `${year}-01-01`);
    return !Number.isNaN(issued.getTime()) && issued.getFullYear() === year;
  });
  const sourceCoverage = {
    rcvVentasCount: docs.filter((d) => String(d.tipoDte || '').includes('VENTA')).length,
    rcvComprasCount: docs.filter((d) => String(d.tipoDte || '').includes('COMPRA')).length,
    movementCount: movsYear.length,
    evidenceCount: (state.complianceEvidence || []).filter((e) => String(e.createdAt || '').startsWith(String(year))).length
  };

  const ownerEvidence = (state.complianceObligations || []).filter((o) => String(o.period || '').startsWith(String(year)) && o.ownerScope === 'dueno');
  const companyEvidence = (state.complianceObligations || []).filter((o) => String(o.period || '').startsWith(String(year)) && o.ownerScope !== 'dueno');
  const summarizeAck = (list) => ({
    total: list.length,
    withAck: list.filter((x) => String(x.lifecycleStatus || '').toLowerCase() === 'acuse').length,
    pending: list.filter((x) => String(x.lifecycleStatus || '').toLowerCase() !== 'acuse').map((x) => ({ key: x.key, code: x.code, dueDate: x.dueDate }))
  });

  return {
    generatedAt: new Date().toISOString(),
    year,
    regime,
    proposal: {
      company: {
        taxableBase,
        annualTaxEstimate: companyEstimate,
        creditSupport: {
          source: 'rcv+movements',
          detail: sourceCoverage
        }
      },
      owner: {
        annualTaxEstimate: ownerEstimate,
        sourceTrace: {
          basedOnCompanyBase: taxableBase,
          regime,
          method: regime === '14D8' ? 'flujo-transparente-estimado' : 'distribucion-estimada'
        }
      }
    },
    declarationEvidence: {
      empresa: summarizeAck(companyEvidence),
      dueno: summarizeAck(ownerEvidence)
    }
  };
}

async function getAuditPackage(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const { year, month } = parseYearMonth(req);
  const state = await readStore();
  const pack = buildAuditPackage(state, year, month);
  return sendJson(res, 200, { ok: true, package: pack });
}

async function getRiskSimulation(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const { year, month } = parseYearMonth(req);
  const state = await readStore();
  return sendJson(res, 200, { ok: true, simulation: runRiskSimulation(state, year, month) });
}

async function getExecutiveDashboard(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const { year, month } = parseYearMonth(req);
  const state = await readStore();
  const dashboard = buildExecutiveDashboard(state, year, month);
  const simulation = runRiskSimulation(state, year, month);
  return sendJson(res, 200, { ok: true, dashboard, risk: { totalExpectedRisk: simulation.totalExpectedRisk, highRiskCount: simulation.highRiskCount } });
}

async function getFiscalProposal(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const query = req.url.includes('?') ? new URL(req.url, 'http://localhost').searchParams : new URLSearchParams();
  const year = Number(query.get('year') || new Date().getFullYear());
  const regime = String(query.get('regime') || query.get('regimen') || '14D3').toUpperCase();
  const state = await readStore();
  const proposal = buildAnnualFiscalProposal(state, year, regime);
  return sendJson(res, 200, { ok: true, proposal });
}


function addMonths(year, month, delta) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function buildAccountantReplacementPilot(state, startYear, startMonth) {
  const guided = Array.isArray(state.guidedTaskExecutions) ? state.guidedTaskExecutions : [];
  const periods = [0, 1, 2].map((i) => addMonths(startYear, startMonth, i));

  const monthly = periods.map(({ year, month }) => {
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const obligations = (state.complianceObligations || []).filter((o) => o.period === period);
    const criticalPending = obligations.filter((o) => String(o.severity || '').toLowerCase() === 'critical' && String(o.lifecycleStatus || '').toLowerCase() !== 'acuse');

    const ownerObs = obligations.filter((o) => o.ownerScope === 'dueno');
    const companyObs = obligations.filter((o) => o.ownerScope !== 'dueno');
    const ownerAck = ownerObs.filter((o) => String(o.lifecycleStatus || '').toLowerCase() === 'acuse').length;
    const companyAck = companyObs.filter((o) => String(o.lifecycleStatus || '').toLowerCase() === 'acuse').length;

    const auditPackage = buildAuditPackage(state, year, month);

    const taskKeys = ['cierre', 'f29', 'ddjj'];
    const taskDone = taskKeys.filter((taskKey) => guided.some((g) => g.period === period && g.taskKey === taskKey && g.status === 'done' && g.guided));
    const guidedCoverage = taskKeys.length ? Number((taskDone.length / taskKeys.length).toFixed(2)) : 0;

    const closedWithJet = criticalPending.length === 0 && guidedCoverage >= 0.67;
    const externalDependency = guidedCoverage < 0.67;

    const deviations = [];
    if (criticalPending.length) deviations.push(`${criticalPending.length} obligación(es) crítica(s) sin acuse`);
    if (guidedCoverage < 0.67) deviations.push('Cobertura guiada insuficiente en tareas críticas mensuales');
    if (!auditPackage.hashChain) deviations.push('Paquete fiscalizador sin hashChain');

    return {
      period,
      closeWithJet: closedWithJet,
      externalDependency,
      guidedCoverage,
      evidence: {
        company: { total: companyObs.length, withAck: companyAck },
        owner: { total: ownerObs.length, withAck: ownerAck },
        auditHashChain: auditPackage.hashChain
      },
      deviations,
      correctiveActions: deviations.map((d) => d.includes('Cobertura guiada')
        ? 'Ejecutar tareas críticas desde /operations/guided-flow y completar evidencia bloqueante.'
        : d.includes('obligación')
          ? 'Registrar evidencia con acuse en /compliance/evidence para empresa y dueño.'
          : 'Generar nuevamente paquete fiscalizador para asegurar hashChain trazable.')
    };
  });

  const consecutiveNoExternal = monthly.every((m) => m.closeWithJet && !m.externalDependency);
  const report = {
    generatedAt: new Date().toISOString(),
    window: { start: monthly[0]?.period, end: monthly[monthly.length - 1]?.period, months: monthly.length },
    monthly,
    summary: {
      closeSuccessCount: monthly.filter((m) => m.closeWithJet).length,
      noExternalDependencyCount: monthly.filter((m) => !m.externalDependency).length,
      gateReached: consecutiveNoExternal
    }
  };

  return report;
}

async function getAccountantReplacementPilot(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const query = req.url.includes('?') ? new URL(req.url, 'http://localhost').searchParams : new URLSearchParams();
  const startYear = Number(query.get('year') || new Date().getFullYear());
  const startMonth = Number(query.get('month') || (new Date().getMonth() + 1));

  const state = await readStore();
  const pilot = buildAccountantReplacementPilot(state, startYear, startMonth);
  return sendJson(res, 200, { ok: true, pilot });
}

module.exports = {
  getAuditPackage,
  getRiskSimulation,
  getExecutiveDashboard,
  getFiscalProposal,
  getAccountantReplacementPilot,
  buildAuditPackage,
  runRiskSimulation,
  buildExecutiveDashboard,
  buildAnnualFiscalProposal,
  buildAccountantReplacementPilot
};
