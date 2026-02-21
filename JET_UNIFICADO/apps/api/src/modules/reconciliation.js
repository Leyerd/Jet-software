const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');

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

async function ensurePgReconciliationTables(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS reconciliation_documents (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    period TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
}

async function importCartola(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const rows = parseImportRows(body).map((r, i) => ({ id: r.id || `CART-${Date.now()}-${i}`, fecha: r.fecha, tipoMovimiento: r.tipoMovimiento || 'INGRESO', monto: Number(r.monto || 0), descripcion: r.descripcion || '' }));

  if (isPostgresMode()) {
    const imported = await withPgClient(async (client) => {
      await ensurePgReconciliationTables(client);
      let count = 0;
      for (const row of rows) {
        const period = toMonthKey(row.fecha) || 'sin-periodo';
        const key = `${row.id}-${row.fecha}`;
        const ex = await client.query('SELECT id FROM reconciliation_documents WHERE id = $1', [key]);
        if (ex.rows.length) continue;
        await client.query('INSERT INTO reconciliation_documents (id, source, period, payload, created_at) VALUES ($1,$2,$3,$4::jsonb,NOW())', [key, 'cartola', period, JSON.stringify(row)]);
        count += 1;
      }
      return count;
    });
    await appendAuditLog('reconciliation.import_cartola', { received: rows.length, imported }, auth.user.email);
    return sendJson(res, 200, { ok: true, received: rows.length, imported, skipped: rows.length - imported });
  }

  const state = await readStore();
  const existing = Array.isArray(state.cartolaMovimientos) ? state.cartolaMovimientos : [];
  const index = new Set(existing.map(r => `${r.id}-${r.fecha}`));
  const toAdd = rows.filter(r => !index.has(`${r.id}-${r.fecha}`));
  state.cartolaMovimientos = existing.concat(toAdd);
  await writeStore(state);
  await appendAudit('reconciliation.import_cartola', { received: rows.length, imported: toAdd.length }, auth.user.email);
  return sendJson(res, 200, { ok: true, received: rows.length, imported: toAdd.length, skipped: rows.length - toAdd.length });
}

async function importRCVVentas(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const rows = parseImportRows(body).map((r, i) => ({ id: r.id || `RCV-${Date.now()}-${i}`, fecha: r.fecha, neto: Number(r.neto || 0), iva: Number(r.iva || 0), total: Number(r.total || 0), folio: r.folio || null }));

  if (isPostgresMode()) {
    const imported = await withPgClient(async (client) => {
      let count = 0;
      for (const row of rows) {
        const tipo = 'RCV_VENTA';
        const folio = String(row.folio || row.id);
        const ex = await client.query('SELECT id FROM documentos_fiscales WHERE tipo_dte=$1 AND folio=$2 LIMIT 1', [tipo, folio]);
        if (ex.rows.length) continue;
        await client.query(
          `INSERT INTO documentos_fiscales (tipo_dte, folio, fecha_emision, neto, iva, total, metadata, creado_en)
           VALUES ($1,$2,$3::date,$4,$5,$6,$7::jsonb,NOW())`,
          [tipo, folio, row.fecha, row.neto, row.iva, row.total, JSON.stringify({ source: 'reconciliation.import_rcv_ventas' })]
        );
        count += 1;
      }
      return count;
    });
    await appendAuditLog('reconciliation.import_rcv_ventas', { received: rows.length, imported }, auth.user.email);
    return sendJson(res, 200, { ok: true, received: rows.length, imported, skipped: rows.length - imported });
  }

  const state = await readStore();
  const existing = Array.isArray(state.rcvVentas) ? state.rcvVentas : [];
  const index = new Set(existing.map(r => `${r.folio || r.id}-${r.fecha}`));
  const toAdd = rows.filter(r => !index.has(`${r.folio || r.id}-${r.fecha}`));
  state.rcvVentas = existing.concat(toAdd);
  await writeStore(state);
  await appendAudit('reconciliation.import_rcv_ventas', { received: rows.length, imported: toAdd.length }, auth.user.email);
  return sendJson(res, 200, { ok: true, received: rows.length, imported: toAdd.length, skipped: rows.length - toAdd.length });
}

async function importMarketplaceOrders(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const rows = parseImportRows(body).map((r, i) => ({ id: r.id || `MKT-${Date.now()}-${i}`, fecha: r.fecha, total: Number(r.total || 0), comision: Number(r.comision || 0), netoLiquidado: Number(r.netoLiquidado || (Number(r.total || 0) - Number(r.comision || 0))) }));

  if (isPostgresMode()) {
    const imported = await withPgClient(async (client) => {
      await ensurePgReconciliationTables(client);
      let count = 0;
      for (const row of rows) {
        const key = `${row.id}-${row.fecha}`;
        const ex = await client.query('SELECT id FROM reconciliation_documents WHERE id=$1', [key]);
        if (ex.rows.length) continue;
        await client.query('INSERT INTO reconciliation_documents (id, source, period, payload, created_at) VALUES ($1,$2,$3,$4::jsonb,NOW())', [key, 'marketplace', toMonthKey(row.fecha) || 'sin-periodo', JSON.stringify(row)]);
        count += 1;
      }
      return count;
    });
    await appendAuditLog('reconciliation.import_marketplace', { received: rows.length, imported }, auth.user.email);
    return sendJson(res, 200, { ok: true, received: rows.length, imported, skipped: rows.length - imported });
  }

  const state = await readStore();
  const existing = Array.isArray(state.marketplaceOrders) ? state.marketplaceOrders : [];
  const index = new Set(existing.map(r => `${r.id}-${r.fecha}`));
  const toAdd = rows.filter(r => !index.has(`${r.id}-${r.fecha}`));
  state.marketplaceOrders = existing.concat(toAdd);
  await writeStore(state);
  await appendAudit('reconciliation.import_marketplace', { received: rows.length, imported: toAdd.length }, auth.user.email);
  return sendJson(res, 200, { ok: true, received: rows.length, imported: toAdd.length, skipped: rows.length - toAdd.length });
}

async function getReconciliationSummary(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  let movements; let cashflows; let cartola; let rcvVentas; let marketplace;

  if (isPostgresMode()) {
    const loaded = await withPgClient(async (client) => {
      await ensurePgReconciliationTables(client);
      const m = await client.query('SELECT fecha, tipo, total FROM movimientos');
      const f = await client.query('SELECT fecha, tipo_movimiento AS "tipoMovimiento", monto FROM flujo_caja');
      const d = await client.query('SELECT source, payload FROM reconciliation_documents');
      const r = await client.query("SELECT fecha_emision AS fecha, total FROM documentos_fiscales WHERE tipo_dte='RCV_VENTA'");
      const cart = d.rows.filter(x => x.source === 'cartola').map(x => x.payload);
      const mk = d.rows.filter(x => x.source === 'marketplace').map(x => x.payload);
      return { movements: m.rows, cashflows: f.rows, cartola: cart, rcv: r.rows, marketplace: mk };
    });
    movements = loaded.movements; cashflows = loaded.cashflows; cartola = loaded.cartola; rcvVentas = loaded.rcv; marketplace = loaded.marketplace;
  } else {
    const state = await readStore();
    movements = state.movimientos || [];
    cashflows = state.flujoCaja || [];
    cartola = state.cartolaMovimientos || [];
    rcvVentas = state.rcvVentas || [];
    marketplace = state.marketplaceOrders || [];
  }

  const by = { internalSales: {}, internalNetCash: {}, cartolaNet: {}, rcvSales: {}, marketplaceNet: {} };
  for (const m of movements) { const key = toMonthKey(m.fecha); if (!key) continue; if (String(m.tipo).toUpperCase().includes('VENTA')) by.internalSales[key] = (by.internalSales[key] || 0) + Number(m.total || 0); }
  for (const f of cashflows) { const key = toMonthKey(f.fecha); if (!key) continue; const sign = String(f.tipoMovimiento).toUpperCase() === 'EGRESO' ? -1 : 1; by.internalNetCash[key] = (by.internalNetCash[key] || 0) + sign * Number(f.monto || 0); }
  for (const c of cartola) { const key = toMonthKey(c.fecha); if (!key) continue; const sign = String(c.tipoMovimiento).toUpperCase() === 'EGRESO' ? -1 : 1; by.cartolaNet[key] = (by.cartolaNet[key] || 0) + sign * Number(c.monto || 0); }
  for (const r of rcvVentas) { const key = toMonthKey(r.fecha); if (!key) continue; by.rcvSales[key] = (by.rcvSales[key] || 0) + Number(r.total || 0); }
  for (const o of marketplace) { const key = toMonthKey(o.fecha); if (!key) continue; by.marketplaceNet[key] = (by.marketplaceNet[key] || 0) + Number(o.netoLiquidado || 0); }

  const months = [...new Set([...Object.keys(by.internalSales), ...Object.keys(by.internalNetCash), ...Object.keys(by.cartolaNet), ...Object.keys(by.rcvSales), ...Object.keys(by.marketplaceNet)])].sort();
  const summary = months.map(period => {
    const internalSales = Math.round(by.internalSales[period] || 0);
    const internalNetCash = Math.round(by.internalNetCash[period] || 0);
    const cartolaNet = Math.round(by.cartolaNet[period] || 0);
    const rcvSales = Math.round(by.rcvSales[period] || 0);
    const marketplaceNet = Math.round(by.marketplaceNet[period] || 0);
    return {
      period,
      internalSales,
      internalNetCash,
      cartolaNet,
      rcvSales,
      marketplaceNet,
      deltas: {
        salesVsRcv: internalSales - rcvSales,
        cashVsCartola: internalNetCash - cartolaNet,
        rcvVsMarketplace: rcvSales - marketplaceNet
      },
      status: {
        salesVsRcv: Math.abs(internalSales - rcvSales) <= Math.max(1000, Math.round(internalSales * 0.01)) ? 'ok' : 'observed',
        cashVsCartola: Math.abs(internalNetCash - cartolaNet) <= Math.max(1000, Math.round(Math.abs(internalNetCash) * 0.01)) ? 'ok' : 'observed',
        rcvVsMarketplace: Math.abs(rcvSales - marketplaceNet) <= Math.max(1000, Math.round(Math.abs(rcvSales) * 0.02)) ? 'ok' : 'observed'
      }
    };
  });

  return sendJson(res, 200, { ok: true, generatedAt: new Date().toISOString(), summary });
}

module.exports = { getReconciliationSummary, importCartola, importRCVVentas, importMarketplaceOrders };
