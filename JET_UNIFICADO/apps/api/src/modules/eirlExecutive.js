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

module.exports = {
  getAuditPackage,
  getRiskSimulation,
  getExecutiveDashboard,
  buildAuditPackage,
  runRiskSimulation,
  buildExecutiveDashboard
};
