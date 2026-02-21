const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');

function ensureIntegrationStructures(state) {
  if (!state.integrationConfigs || typeof state.integrationConfigs !== 'object') {
    state.integrationConfigs = {
      alibaba: { enabled: false, lastSyncAt: null },
      mercadolibre: { enabled: false, lastSyncAt: null },
      sii: { enabled: false, lastSyncAt: null }
    };
  }
  if (!Array.isArray(state.integrationSyncLog)) state.integrationSyncLog = [];
  if (!Array.isArray(state.marketplaceOrders)) state.marketplaceOrders = [];
  if (!Array.isArray(state.rcvVentas)) state.rcvVentas = [];
  if (!Array.isArray(state.rcvCompras)) state.rcvCompras = [];
  if (!Array.isArray(state.productos)) state.productos = [];
  if (!Array.isArray(state.movimientos)) state.movimientos = [];
}

function upsertAlibabaProducts(state, rows) {
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const sku = String(row.sku || '').trim();
    const nombre = String(row.nombre || '').trim();
    const unitCost = Number(row.unitCost || 0);

    if (!sku || !nombre || unitCost <= 0) continue;

    const existing = state.productos.find(p => String(p.sku || '') === sku);
    if (!existing) {
      state.productos.push({
        id: `P-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        nombre,
        sku,
        stock: Number(row.stockInicial || 0),
        costoPromedio: Math.round(unitCost),
        proveedorOrigen: row.proveedor || 'alibaba'
      });
      created += 1;
      continue;
    }

    existing.nombre = nombre;
    existing.costoPromedio = Math.round(unitCost);
    existing.proveedorOrigen = row.proveedor || existing.proveedorOrigen || 'alibaba';
    updated += 1;
  }

  return { created, updated };
}

function importMercadoLibreOrders(state, rows) {
  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const orderId = String(row.orderId || '').trim();
    const fecha = row.fecha || new Date().toISOString().slice(0, 10);
    const total = Number(row.total || 0);
    const comision = Number(row.comision || 0);
    const netoLiquidado = Number(row.netoLiquidado || total - comision);

    if (!orderId || total <= 0 || netoLiquidado < 0) {
      skipped += 1;
      continue;
    }

    const already = state.marketplaceOrders.find(o => String(o.orderId) === orderId);
    if (already) {
      skipped += 1;
      continue;
    }

    state.marketplaceOrders.push({
      orderId,
      fecha,
      total,
      comision,
      netoLiquidado,
      source: 'mercadolibre'
    });

    state.movimientos.push({
      id: `MKT-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      fecha,
      tipo: 'ingreso',
      categoria: 'venta_marketplace',
      descripcion: `Venta Mercado Libre ${orderId}`,
      monto: netoLiquidado,
      origen: 'mercadolibre'
    });

    imported += 1;
  }

  return { imported, skipped };
}

function importSiiRCV(state, rows, kind = 'ventas') {
  let imported = 0;
  let skipped = 0;
  const target = kind === 'compras' ? state.rcvCompras : state.rcvVentas;

  for (const row of rows) {
    const folio = String(row.folio || '').trim();
    const fecha = row.fecha || new Date().toISOString().slice(0, 10);
    const total = Number(row.total || 0);
    const iva = Number(row.iva || Math.round(total * 0.19));

    if (!folio || total <= 0) {
      skipped += 1;
      continue;
    }

    const key = `${folio}-${fecha}`;
    const exists = target.find(r => `${r.folio}-${r.fecha}` === key);
    if (exists) {
      skipped += 1;
      continue;
    }

    target.push({ folio, fecha, total, iva, source: 'sii' });
    imported += 1;
  }

  return { imported, skipped, kind };
}

async function updateIntegrationConfig(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const provider = String(body.provider || '').toLowerCase();
  const enabled = Boolean(body.enabled);

  if (!['alibaba', 'mercadolibre', 'sii'].includes(provider)) {
    return sendJson(res, 400, { ok: false, message: 'provider inválido: usa alibaba|mercadolibre|sii' });
  }

  const state = await readStore();
  ensureIntegrationStructures(state);

  state.integrationConfigs[provider] = {
    ...(state.integrationConfigs[provider] || {}),
    enabled,
    lastSyncAt: state.integrationConfigs[provider]?.lastSyncAt || null,
    // solo metadatos no sensibles
    accountAlias: body.accountAlias || null
  };

  await writeStore(state);
  await appendAudit('integrations.config.update', { provider, enabled }, auth.user.email);

  return sendJson(res, 200, { ok: true, provider, config: state.integrationConfigs[provider] });
}

async function getIntegrationsStatus(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const state = await readStore();
  ensureIntegrationStructures(state);

  return sendJson(res, 200, {
    ok: true,
    providers: state.integrationConfigs,
    syncLogCount: state.integrationSyncLog.length,
    latestSyncEvents: state.integrationSyncLog.slice(-10)
  });
}

async function importAlibabaCatalog(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return sendJson(res, 400, { ok: false, message: 'rows es requerido (array no vacío)' });

  const state = await readStore();
  ensureIntegrationStructures(state);
  const result = upsertAlibabaProducts(state, rows);

  const event = {
    id: `SYNC-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    provider: 'alibaba',
    importedAt: new Date().toISOString(),
    result
  };

  state.integrationConfigs.alibaba.enabled = true;
  state.integrationConfigs.alibaba.lastSyncAt = event.importedAt;
  state.integrationSyncLog.push(event);

  await writeStore(state);
  await appendAudit('integrations.alibaba.importCatalog', { count: rows.length, result }, auth.user.email);

  return sendJson(res, 200, { ok: true, ...event });
}

async function importMercadoLibre(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return sendJson(res, 400, { ok: false, message: 'rows es requerido (array no vacío)' });

  const state = await readStore();
  ensureIntegrationStructures(state);
  const result = importMercadoLibreOrders(state, rows);

  const event = {
    id: `SYNC-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    provider: 'mercadolibre',
    importedAt: new Date().toISOString(),
    result
  };

  state.integrationConfigs.mercadolibre.enabled = true;
  state.integrationConfigs.mercadolibre.lastSyncAt = event.importedAt;
  state.integrationSyncLog.push(event);

  await writeStore(state);
  await appendAudit('integrations.mercadolibre.importOrders', { count: rows.length, result }, auth.user.email);

  return sendJson(res, 200, { ok: true, ...event });
}

async function importSii(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const kind = body.kind === 'compras' ? 'compras' : 'ventas';
  if (!rows.length) return sendJson(res, 400, { ok: false, message: 'rows es requerido (array no vacío)' });

  const state = await readStore();
  ensureIntegrationStructures(state);
  const result = importSiiRCV(state, rows, kind);

  const event = {
    id: `SYNC-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    provider: 'sii',
    importedAt: new Date().toISOString(),
    result
  };

  state.integrationConfigs.sii.enabled = true;
  state.integrationConfigs.sii.lastSyncAt = event.importedAt;
  state.integrationSyncLog.push(event);

  await writeStore(state);
  await appendAudit('integrations.sii.importRCV', { count: rows.length, result }, auth.user.email);

  return sendJson(res, 200, { ok: true, ...event });
}

module.exports = {
  updateIntegrationConfig,
  getIntegrationsStatus,
  importAlibabaCatalog,
  importMercadoLibre,
  importSii
};
