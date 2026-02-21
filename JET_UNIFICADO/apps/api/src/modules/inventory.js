const { sendJson } = require('../lib/http');
const { readStore } = require('../lib/store');
const { requireRoles } = require('./auth');

async function getInventoryOverview(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const state = await readStore();
  const products = state.productos || [];

  const valuation = products.reduce((acc, p) => acc + (Number(p.stock || 0) * Number(p.costoPromedio || 0)), 0);
  const lowStock = products.filter(p => Number(p.stock || 0) <= 5);
  const outOfStock = products.filter(p => Number(p.stock || 0) <= 0);

  return sendJson(res, 200, {
    ok: true,
    overview: {
      totalProducts: products.length,
      lowStockCount: lowStock.length,
      outOfStockCount: outOfStock.length,
      inventoryValuation: Math.round(valuation)
    },
    lowStock: lowStock.map(p => ({ id: p.id, nombre: p.nombre, sku: p.sku || null, stock: Number(p.stock || 0) }))
  });
}

module.exports = { getInventoryOverview };
