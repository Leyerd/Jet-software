const { sendJson } = require('../lib/http');
const { readStore } = require('../lib/store');
const { requireRoles } = require('./auth');

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function calculateProjection(state) {
  const now = new Date();
  const start = monthStart(now);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = Math.max(1, now.getDate());

  const monthMovs = state.movimientos.filter(m => {
    const d = new Date(m.fecha);
    return !Number.isNaN(d.getTime()) && d >= start && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const sales = monthMovs.filter(m => m.tipo === 'VENTA').reduce((a, b) => a + (Number(b.total || 0)), 0);
  const expenses = monthMovs.filter(m => m.tipo !== 'VENTA').reduce((a, b) => a + (Number(b.total || 0)), 0);
  const margin = sales - expenses;

  const factor = daysInMonth / day;
  const base = {
    projectedSales: Math.round(sales * factor),
    projectedExpenses: Math.round(expenses * factor),
    projectedMargin: Math.round(margin * factor)
  };

  return {
    current: { sales, expenses, margin, day, daysInMonth },
    scenarios: {
      conservative: {
        projectedSales: Math.round(base.projectedSales * 0.9),
        projectedExpenses: Math.round(base.projectedExpenses * 1.05),
        projectedMargin: Math.round(base.projectedSales * 0.9 - base.projectedExpenses * 1.05)
      },
      base,
      optimistic: {
        projectedSales: Math.round(base.projectedSales * 1.1),
        projectedExpenses: Math.round(base.projectedExpenses * 0.95),
        projectedMargin: Math.round(base.projectedSales * 1.1 - base.projectedExpenses * 0.95)
      }
    }
  };
}

async function getProjection(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const state = await readStore();
  const projection = calculateProjection(state);
  return sendJson(res, 200, { ok: true, projection });
}

module.exports = { getProjection };
