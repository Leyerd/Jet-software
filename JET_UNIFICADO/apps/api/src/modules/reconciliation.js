const { sendJson } = require('../lib/http');
const { readStore } = require('../lib/store');
const { requireRoles } = require('./auth');

function toMonthKey(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function getReconciliationSummary(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const state = await readStore();
  const movements = state.movimientos || [];
  const cashflows = state.flujoCaja || [];

  const salesByMonth = {};
  const incomeByMonth = {};
  const expenseByMonth = {};

  for (const m of movements) {
    const key = toMonthKey(m.fecha);
    if (!key) continue;
    if (m.tipo === 'VENTA') salesByMonth[key] = (salesByMonth[key] || 0) + Number(m.total || 0);
  }

  for (const f of cashflows) {
    const key = toMonthKey(f.fecha);
    if (!key) continue;
    if (f.tipoMovimiento === 'INGRESO') incomeByMonth[key] = (incomeByMonth[key] || 0) + Number(f.monto || 0);
    if (f.tipoMovimiento === 'EGRESO') expenseByMonth[key] = (expenseByMonth[key] || 0) + Number(f.monto || 0);
  }

  const months = [...new Set([...Object.keys(salesByMonth), ...Object.keys(incomeByMonth), ...Object.keys(expenseByMonth)])].sort();
  const summary = months.map(key => {
    const sales = Math.round(salesByMonth[key] || 0);
    const netCash = Math.round((incomeByMonth[key] || 0) - (expenseByMonth[key] || 0));
    const diff = Math.round(sales - netCash);
    return {
      period: key,
      sales,
      netCash,
      difference: diff,
      status: Math.abs(diff) <= 1 ? 'conciliado' : 'observado'
    };
  });

  const observed = summary.filter(x => x.status === 'observado').length;

  return sendJson(res, 200, {
    ok: true,
    totals: {
      periods: summary.length,
      observed,
      reconciled: summary.length - observed
    },
    summary
  });
}

module.exports = { getReconciliationSummary };
