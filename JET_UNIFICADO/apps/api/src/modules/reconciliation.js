const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');

function toMonthKey(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parseImportRows(body) {
  const rows = body.rows;
  if (!Array.isArray(rows)) throw new Error('rows debe ser un arreglo');
  return rows;
}

async function importCartola(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const rows = parseImportRows(body).map((r, i) => ({
    id: r.id || `CART-${Date.now()}-${i}`,
    fecha: r.fecha,
    tipoMovimiento: r.tipoMovimiento || 'INGRESO',
    monto: Number(r.monto || 0),
    descripcion: r.descripcion || ''
  }));

  const state = await readStore();
  state.cartolaMovimientos = rows;
  await writeStore(state);
  await appendAudit('reconciliation.import_cartola', { rows: rows.length }, auth.user.email);
  return sendJson(res, 200, { ok: true, imported: rows.length });
}

async function importRCVVentas(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const rows = parseImportRows(body).map((r, i) => ({
    id: r.id || `RCV-${Date.now()}-${i}`,
    fecha: r.fecha,
    neto: Number(r.neto || 0),
    iva: Number(r.iva || 0),
    total: Number(r.total || 0),
    folio: r.folio || null
  }));

  const state = await readStore();
  state.rcvVentas = rows;
  await writeStore(state);
  await appendAudit('reconciliation.import_rcv_ventas', { rows: rows.length }, auth.user.email);
  return sendJson(res, 200, { ok: true, imported: rows.length });
}

async function importMarketplaceOrders(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const rows = parseImportRows(body).map((r, i) => ({
    id: r.id || `MKT-${Date.now()}-${i}`,
    fecha: r.fecha,
    total: Number(r.total || 0),
    comision: Number(r.comision || 0),
    netoLiquidado: Number(r.netoLiquidado || (Number(r.total || 0) - Number(r.comision || 0)))
  }));

  const state = await readStore();
  state.marketplaceOrders = rows;
  await writeStore(state);
  await appendAudit('reconciliation.import_marketplace', { rows: rows.length }, auth.user.email);
  return sendJson(res, 200, { ok: true, imported: rows.length });
}

async function getReconciliationSummary(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const state = await readStore();
  const movements = state.movimientos || [];
  const cashflows = state.flujoCaja || [];
  const cartola = state.cartolaMovimientos || [];
  const rcvVentas = state.rcvVentas || [];
  const marketplace = state.marketplaceOrders || [];

  const by = {
    internalSales: {},
    internalNetCash: {},
    cartolaNet: {},
    rcvSales: {},
    marketplaceNet: {}
  };

  for (const m of movements) {
    const key = toMonthKey(m.fecha); if (!key) continue;
    if (m.tipo === 'VENTA') by.internalSales[key] = (by.internalSales[key] || 0) + Number(m.total || 0);
  }

  for (const f of cashflows) {
    const key = toMonthKey(f.fecha); if (!key) continue;
    const sign = f.tipoMovimiento === 'EGRESO' ? -1 : 1;
    by.internalNetCash[key] = (by.internalNetCash[key] || 0) + sign * Number(f.monto || 0);
  }

  for (const c of cartola) {
    const key = toMonthKey(c.fecha); if (!key) continue;
    const sign = c.tipoMovimiento === 'EGRESO' ? -1 : 1;
    by.cartolaNet[key] = (by.cartolaNet[key] || 0) + sign * Number(c.monto || 0);
  }

  for (const r of rcvVentas) {
    const key = toMonthKey(r.fecha); if (!key) continue;
    by.rcvSales[key] = (by.rcvSales[key] || 0) + Number(r.total || 0);
  }

  for (const o of marketplace) {
    const key = toMonthKey(o.fecha); if (!key) continue;
    by.marketplaceNet[key] = (by.marketplaceNet[key] || 0) + Number(o.netoLiquidado || 0);
  }

  const months = [...new Set([
    ...Object.keys(by.internalSales), ...Object.keys(by.internalNetCash), ...Object.keys(by.cartolaNet),
    ...Object.keys(by.rcvSales), ...Object.keys(by.marketplaceNet)
  ])].sort();

  const summary = months.map(period => {
    const internalSales = Math.round(by.internalSales[period] || 0);
    const internalNetCash = Math.round(by.internalNetCash[period] || 0);
    const cartolaNet = Math.round(by.cartolaNet[period] || 0);
    const rcvSales = Math.round(by.rcvSales[period] || 0);
    const marketplaceNet = Math.round(by.marketplaceNet[period] || 0);

    const diffSalesVsRCV = internalSales - rcvSales;
    const diffCashVsCartola = internalNetCash - cartolaNet;
    const diffCashVsMarketplace = internalNetCash - marketplaceNet;

    const observed = Math.abs(diffSalesVsRCV) > 1 || Math.abs(diffCashVsCartola) > 1 || Math.abs(diffCashVsMarketplace) > 1;

    return {
      period,
      internalSales,
      rcvSales,
      internalNetCash,
      cartolaNet,
      marketplaceNet,
      differences: {
        salesVsRCV: diffSalesVsRCV,
        cashVsCartola: diffCashVsCartola,
        cashVsMarketplace: diffCashVsMarketplace
      },
      status: observed ? 'observado' : 'conciliado'
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
    sources: {
      movimientos: movements.length,
      flujoCaja: cashflows.length,
      cartola: cartola.length,
      rcvVentas: rcvVentas.length,
      marketplaceOrders: marketplace.length
    },
    summary
  });
}

module.exports = {
  getReconciliationSummary,
  importCartola,
  importRCVVentas,
  importMarketplaceOrders
};
