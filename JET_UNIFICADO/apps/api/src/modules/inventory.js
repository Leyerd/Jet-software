const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');

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

  if (isPostgresMode()) {
    const result = await withPgClient(async (client) => {
      const p = await client.query('SELECT id, stock, costo_promedio AS "costoPromedio" FROM productos WHERE id = $1', [Number(productId)]);
      if (!p.rows.length) return null;
      const product = p.rows[0];
      const lotRs = await client.query(
        `INSERT INTO lotes_inventario (producto_id, fecha_ingreso, cantidad, costo_unitario, origen, creado_en)
         VALUES ($1, $2::date, $3, $4, $5, NOW())
         RETURNING id, producto_id AS "productId", fecha_ingreso AS "fechaIngreso", cantidad AS qty, costo_unitario AS "unitCost", origen AS source`,
        [Number(productId), fechaIngreso, qty, unitCost, source]
      );
      const lot = { ...lotRs.rows[0], remainingQty: qty };
      const currentStock = Number(product.stock || 0);
      const currentCost = Number(product.costoPromedio || 0);
      const newStock = currentStock + qty;
      const newAvg = newStock > 0 ? (((currentStock * currentCost) + (qty * unitCost)) / newStock) : unitCost;
      await client.query('UPDATE productos SET stock = $2, costo_promedio = $3 WHERE id = $1', [Number(productId), newStock, Math.round(newAvg)]);
      await client.query(
        `INSERT INTO kardex_movimientos (producto_id, lote_id, fecha, tipo, cantidad, costo_unitario, referencia, creado_en)
         VALUES ($1, $2, $3::date, 'IN', $4, $5, $6, NOW())`,
        [Number(productId), lot.id, fechaIngreso, qty, unitCost, source]
      );
      const updated = await client.query('SELECT id, sku, nombre, stock, costo_promedio AS "costoPromedio" FROM productos WHERE id=$1', [Number(productId)]);
      return { lot, product: updated.rows[0] };
    });

    if (!result) return sendJson(res, 404, { ok: false, message: 'Producto no encontrado' });
    await appendAuditLog('inventory.lot.import', { productId, qty, unitCost, lotId: result.lot.id }, auth.user.email);
    return sendJson(res, 201, { ok: true, lot: result.lot, product: result.product });
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

  if (isPostgresMode()) {
    const out = await withPgClient(async (client) => {
      const p = await client.query('SELECT id, stock FROM productos WHERE id = $1', [Number(productId)]);
      if (!p.rows.length) return { err: 404, payload: { ok: false, message: 'Producto no encontrado' } };

      const lots = await client.query(
        `SELECT id, cantidad, costo_unitario,
                (cantidad - COALESCE((SELECT SUM(km.cantidad) FROM kardex_movimientos km WHERE km.lote_id = li.id AND km.tipo='OUT'),0)) AS remaining
         FROM lotes_inventario li
         WHERE producto_id = $1
         ORDER BY fecha_ingreso ASC, id ASC`,
        [Number(productId)]
      );

      let remaining = qty;
      let totalCost = 0;
      const allocations = [];
      for (const lot of lots.rows) {
        if (remaining <= 0) break;
        const avail = Number(lot.remaining || 0);
        if (avail <= 0) continue;
        const take = Math.min(remaining, avail);
        remaining -= take;
        const cost = take * Number(lot.costo_unitario);
        totalCost += cost;
        allocations.push({ lotId: lot.id, qty: take, unitCost: Number(lot.costo_unitario), cost: Math.round(cost) });
        await client.query(
          `INSERT INTO kardex_movimientos (producto_id, lote_id, fecha, tipo, cantidad, costo_unitario, referencia, creado_en)
           VALUES ($1, $2, $3::date, 'OUT', $4, $5, $6, NOW())`,
          [Number(productId), lot.id, fecha, take, Number(lot.costo_unitario), reference]
        );
      }
      if (remaining > 0) return { err: 409, payload: { ok: false, message: 'Stock insuficiente por lotes', missingQty: remaining } };
      await client.query('UPDATE productos SET stock = GREATEST(0, stock - $2) WHERE id = $1', [Number(productId), qty]);
      return { err: 0, payload: { ok: true, productId: String(productId), qty, totalCost: Math.round(totalCost), averageUnitCost: Math.round(totalCost / qty), allocations } };
    });

    if (out.err) return sendJson(res, out.err, out.payload);
    await appendAuditLog('inventory.stock.consume', { productId, qty, totalCost: out.payload.totalCost, allocations: out.payload.allocations }, auth.user.email);
    return sendJson(res, 200, out.payload);
  }

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
    registerKardex(state, { id: `KDX-${Date.now()}-${Math.floor(Math.random() * 1000)}`, fecha, productId: String(productId), type: 'OUT', qty: take, unitCost: Number(lot.unitCost), totalCost: Math.round(cost), lotId: lot.id, reference });
  }
  if (remaining > 0) return sendJson(res, 409, { ok: false, message: 'Stock insuficiente por lotes', missingQty: remaining });
  product.stock = Math.max(0, Number(product.stock || 0) - qty);
  await writeStore(state);
  await appendAudit('inventory.stock.consume', { productId, qty, totalCost: Math.round(totalCost), allocations }, auth.user.email);
  return sendJson(res, 200, { ok: true, productId: String(productId), qty, totalCost: Math.round(totalCost), averageUnitCost: qty > 0 ? Math.round(totalCost / qty) : 0, allocations });
}

async function getKardex(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const url = new URL(req.url, 'http://localhost');
  const productId = url.searchParams.get('productId');

  if (isPostgresMode()) {
    const rows = await withPgClient(async (client) => {
      const rs = await client.query(
        `SELECT id, producto_id AS "productId", lote_id AS "lotId", fecha, tipo AS type,
                cantidad AS qty, costo_unitario AS "unitCost", (cantidad * COALESCE(costo_unitario,0)) AS "totalCost", referencia AS reference
         FROM kardex_movimientos
         WHERE ($1::int IS NULL OR producto_id = $1)
         ORDER BY fecha ASC, id ASC`,
        [productId ? Number(productId) : null]
      );
      return rs.rows;
    });
    return sendJson(res, 200, { ok: true, count: rows.length, rows });
  }

  const state = await readStore();
  ensureInventoryStructures(state);
  const rows = state.kardexMovements.filter(r => !productId || String(r.productId) === String(productId)).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  return sendJson(res, 200, { ok: true, count: rows.length, rows });
}

async function getInventoryOverview(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  if (isPostgresMode()) {
    const products = await withPgClient(async (client) => {
      const rs = await client.query('SELECT id, sku, nombre, stock, costo_promedio AS "costoPromedio" FROM productos ORDER BY id ASC');
      return rs.rows;
    });
    return sendJson(res, 200, {
      ok: true,
      totals: {
        products: products.length,
        stockUnits: Math.round(products.reduce((a, b) => a + Number(b.stock || 0), 0)),
        inventoryValue: Math.round(products.reduce((a, b) => a + (Number(b.stock || 0) * Number(b.costoPromedio || 0)), 0))
      },
      products
    });
  }

  const state = await readStore();
  ensureInventoryStructures(state);
  const products = state.productos || [];
  const stockUnits = products.reduce((a, b) => a + Number(b.stock || 0), 0);
  const inventoryValue = products.reduce((a, b) => a + (Number(b.stock || 0) * Number(b.costoPromedio || 0)), 0);
  return sendJson(res, 200, { ok: true, totals: { products: products.length, stockUnits: Math.round(stockUnits), inventoryValue: Math.round(inventoryValue) }, products });
}

module.exports = { getInventoryOverview, importLot, consumeStock, getKardex };
