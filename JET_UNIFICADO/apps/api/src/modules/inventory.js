const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');

function ensureInventoryStructures(state) {
  if (!Array.isArray(state.inventoryLots)) state.inventoryLots = [];
  if (!Array.isArray(state.kardexMovements)) state.kardexMovements = [];
}

function findProduct(state, productId) {
  return (state.productos || []).find(p => String(p.id) === String(productId));
}

function productLots(state, productId) {
  return state.inventoryLots
    .filter(l => String(l.productId) === String(productId) && Number(l.remainingQty || 0) > 0)
    .sort((a, b) => new Date(a.fechaIngreso) - new Date(b.fechaIngreso));
}

function registerKardex(state, movement) {
  state.kardexMovements.push(movement);
}

async function importLot(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const productId = body.productId;
  const qty = Number(body.qty || 0);
  const unitCost = Number(body.unitCost || 0);
  const fechaIngreso = body.fechaIngreso || new Date().toISOString().slice(0, 10);
  const source = body.source || 'importacion';

  if (!productId || qty <= 0 || unitCost <= 0) {
    return sendJson(res, 400, { ok: false, message: 'productId, qty y unitCost (>0) son requeridos' });
  }

  const state = await readStore();
  ensureInventoryStructures(state);
  const product = findProduct(state, productId);
  if (!product) return sendJson(res, 404, { ok: false, message: 'Producto no encontrado' });

  const lot = {
    id: `LOT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    productId: String(productId),
    fechaIngreso,
    qty,
    remainingQty: qty,
    unitCost,
    source
  };

  state.inventoryLots.push(lot);

  // recalcular costo promedio
  const currentStock = Number(product.stock || 0);
  const currentCost = Number(product.costoPromedio || 0);
  const newStock = currentStock + qty;
  const newAvg = newStock > 0 ? (((currentStock * currentCost) + (qty * unitCost)) / newStock) : unitCost;
  product.stock = newStock;
  product.costoPromedio = Math.round(newAvg);

  registerKardex(state, {
    id: `KDX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    fecha: fechaIngreso,
    productId: String(productId),
    type: 'IN',
    qty,
    unitCost,
    totalCost: Math.round(qty * unitCost),
    lotId: lot.id,
    reference: source
  });

  await writeStore(state);
  await appendAudit('inventory.lot.import', { productId, qty, unitCost, lotId: lot.id }, auth.user.email);

  return sendJson(res, 201, { ok: true, lot, product });
}

async function consumeStock(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const productId = body.productId;
  const qty = Number(body.qty || 0);
  const fecha = body.fecha || new Date().toISOString().slice(0, 10);
  const reference = body.reference || 'venta';

  if (!productId || qty <= 0) return sendJson(res, 400, { ok: false, message: 'productId y qty (>0) son requeridos' });

  const state = await readStore();
  ensureInventoryStructures(state);
  const product = findProduct(state, productId);
  if (!product) return sendJson(res, 404, { ok: false, message: 'Producto no encontrado' });

  let remaining = qty;
  let totalCost = 0;
  const allocations = [];

  for (const lot of productLots(state, productId)) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(lot.remainingQty));
    if (take <= 0) continue;

    lot.remainingQty = Number(lot.remainingQty) - take;
    remaining -= take;
    const cost = take * Number(lot.unitCost);
    totalCost += cost;
    allocations.push({ lotId: lot.id, qty: take, unitCost: Number(lot.unitCost), cost: Math.round(cost) });

    registerKardex(state, {
      id: `KDX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      fecha,
      productId: String(productId),
      type: 'OUT',
      qty: take,
      unitCost: Number(lot.unitCost),
      totalCost: Math.round(cost),
      lotId: lot.id,
      reference
    });
  }

  if (remaining > 0) {
    return sendJson(res, 409, { ok: false, message: 'Stock insuficiente por lotes', missingQty: remaining });
  }

  product.stock = Math.max(0, Number(product.stock || 0) - qty);

  await writeStore(state);
  await appendAudit('inventory.stock.consume', { productId, qty, totalCost: Math.round(totalCost), allocations }, auth.user.email);

  return sendJson(res, 200, {
    ok: true,
    productId: String(productId),
    qty,
    totalCost: Math.round(totalCost),
    averageUnitCost: qty > 0 ? Math.round(totalCost / qty) : 0,
    allocations
  });
}

async function getKardex(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const state = await readStore();
  ensureInventoryStructures(state);

  const url = new URL(req.url, 'http://localhost');
  const productId = url.searchParams.get('productId');

  const rows = state.kardexMovements
    .filter(r => !productId || String(r.productId) === String(productId))
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  return sendJson(res, 200, { ok: true, count: rows.length, rows });
}

async function getInventoryOverview(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const state = await readStore();
  ensureInventoryStructures(state);
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
      inventoryValuation: Math.round(valuation),
      totalLots: state.inventoryLots.length,
      totalKardexRows: state.kardexMovements.length
    },
    lowStock: lowStock.map(p => ({ id: p.id, nombre: p.nombre, sku: p.sku || null, stock: Number(p.stock || 0) }))
  });
}

module.exports = { getInventoryOverview, importLot, consumeStock, getKardex };
