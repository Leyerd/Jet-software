const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');

function ensureIntegrationStructures(state) {
  if (!state.integrationConfigs || typeof state.integrationConfigs !== 'object') {
    state.integrationConfigs = {
      alibaba: { enabled: false, lastSyncAt: null },
      mercadolibre: { enabled: false, lastSyncAt: null },
      sii: { enabled: false, lastSyncAt: null }
    };
  }
  if (!Array.isArray(state.integrationSyncLog)) state.integrationSyncLog = [];
}

async function ensurePgTables(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS integration_provider_state (
    provider TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT false,
    last_sync_at TIMESTAMP,
    account_alias TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS integration_sync_log (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    imported_at TIMESTAMP NOT NULL,
    result JSONB NOT NULL
  )`);
}

function upsertAlibabaProducts(state, rows) {
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const sku = String(row.sku || '').trim();
    if (!sku) continue;
    const existing = (state.productos || []).find(p => String(p.sku || '').trim() === sku);
    const nombre = row.nombre || row.name || `Producto ${sku}`;
    const costoPromedio = Number(row.unitCost || row.costo || 0);
    if (!existing) {
      state.productos.push({ id: `PROD-${Date.now()}-${Math.floor(Math.random() * 10000)}`, sku, nombre, stock: Number(row.stock || 0), costoPromedio });
      created += 1;
    } else {
      existing.nombre = nombre;
      if (!Number.isNaN(costoPromedio) && costoPromedio > 0) existing.costoPromedio = costoPromedio;
      updated += 1;
    }
  }
  return { created, updated };
}

async function updateIntegrationConfig(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const provider = String(body.provider || '').toLowerCase();
  const enabled = Boolean(body.enabled);
  if (!['alibaba', 'mercadolibre', 'sii'].includes(provider)) return sendJson(res, 400, { ok: false, message: 'provider inválido: usa alibaba|mercadolibre|sii' });

  if (isPostgresMode()) {
    const config = await withPgClient(async (client) => {
      await ensurePgTables(client);
      await client.query(
        `INSERT INTO integration_provider_state (provider, enabled, account_alias, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (provider)
         DO UPDATE SET enabled = EXCLUDED.enabled, account_alias = EXCLUDED.account_alias, updated_at = NOW()
         RETURNING provider, enabled, last_sync_at AS "lastSyncAt", account_alias AS "accountAlias"`,
        [provider, enabled, body.accountAlias || null]
      );
      const rs = await client.query('SELECT provider, enabled, last_sync_at AS "lastSyncAt", account_alias AS "accountAlias" FROM integration_provider_state WHERE provider = $1', [provider]);
      return rs.rows[0];
    });
    await appendAuditLog('integrations.config.update', { provider, enabled }, auth.user.email);
    return sendJson(res, 200, { ok: true, provider, config });
  }

  const state = await readStore();
  ensureIntegrationStructures(state);
  state.integrationConfigs[provider] = { ...(state.integrationConfigs[provider] || {}), enabled, lastSyncAt: state.integrationConfigs[provider]?.lastSyncAt || null, accountAlias: body.accountAlias || null };
  await writeStore(state);
  await appendAudit('integrations.config.update', { provider, enabled }, auth.user.email);
  return sendJson(res, 200, { ok: true, provider, config: state.integrationConfigs[provider] });
}

async function getIntegrationsStatus(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  if (isPostgresMode()) {
    const out = await withPgClient(async (client) => {
      await ensurePgTables(client);
      const p = await client.query('SELECT provider, enabled, last_sync_at AS "lastSyncAt", account_alias AS "accountAlias" FROM integration_provider_state ORDER BY provider ASC');
      const l = await client.query('SELECT id, provider, imported_at AS "importedAt", result FROM integration_sync_log ORDER BY imported_at DESC LIMIT 10');
      const providers = { alibaba: { enabled: false, lastSyncAt: null }, mercadolibre: { enabled: false, lastSyncAt: null }, sii: { enabled: false, lastSyncAt: null } };
      for (const row of p.rows) providers[row.provider] = { enabled: row.enabled, lastSyncAt: row.lastSyncAt, accountAlias: row.accountAlias };
      return { providers, syncLogCount: l.rows.length, latestSyncEvents: l.rows };
    });
    return sendJson(res, 200, { ok: true, ...out });
  }

  const state = await readStore();
  ensureIntegrationStructures(state);
  return sendJson(res, 200, { ok: true, providers: state.integrationConfigs, syncLogCount: state.integrationSyncLog.length, latestSyncEvents: state.integrationSyncLog.slice(-10) });
}

async function importAlibabaCatalog(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return sendJson(res, 400, { ok: false, message: 'rows es requerido (array no vacío)' });

  if (isPostgresMode()) {
    const result = { created: 0, updated: 0 };
    await withPgClient(async (client) => {
      await ensurePgTables(client);
      for (const row of rows) {
        const sku = String(row.sku || '').trim();
        if (!sku) continue;
        const nombre = row.nombre || row.name || `Producto ${sku}`;
        const costo = Number(row.unitCost || row.costo || 0);
        const found = await client.query('SELECT id FROM productos WHERE sku = $1', [sku]);
        if (!found.rows.length) {
          await client.query('INSERT INTO productos (sku, nombre, stock, costo_promedio, creado_en) VALUES ($1, $2, $3, $4, NOW())', [sku, nombre, Number(row.stock || 0), costo]);
          result.created += 1;
        } else {
          await client.query('UPDATE productos SET nombre=$2, costo_promedio = CASE WHEN $3>0 THEN $3 ELSE costo_promedio END WHERE sku=$1', [sku, nombre, costo]);
          result.updated += 1;
        }
      }
      const id = `SYNC-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const importedAt = new Date().toISOString();
      await client.query('INSERT INTO integration_sync_log (id, provider, imported_at, result) VALUES ($1,$2,$3::timestamp,$4::jsonb)', [id, 'alibaba', importedAt, JSON.stringify(result)]);
      await client.query(
        `INSERT INTO integration_provider_state (provider, enabled, last_sync_at, updated_at)
         VALUES ('alibaba', true, $1::timestamp, NOW())
         ON CONFLICT (provider)
         DO UPDATE SET enabled=true, last_sync_at=$1::timestamp, updated_at=NOW()`, [importedAt]
      );
    });
    await appendAuditLog('integrations.alibaba.importCatalog', { count: rows.length, result }, auth.user.email);
    return sendJson(res, 200, { ok: true, provider: 'alibaba', importedAt: new Date().toISOString(), result });
  }

  const state = await readStore();
  ensureIntegrationStructures(state);
  const result = upsertAlibabaProducts(state, rows);
  const event = { id: `SYNC-${Date.now()}-${Math.floor(Math.random() * 10000)}`, provider: 'alibaba', importedAt: new Date().toISOString(), result };
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

  if (isPostgresMode()) {
    let imported = 0;
    let skipped = 0;
    await withPgClient(async (client) => {
      await ensurePgTables(client);
      for (const row of rows) {
        const orderId = String(row.orderId || row.id || '').trim();
        const fecha = row.fecha || new Date().toISOString().slice(0, 10);
        const total = Number(row.total || 0);
        const comision = Number(row.comision || 0);
        const netoLiquidado = Number(row.netoLiquidado || (total - comision));
        if (!orderId || total <= 0) { skipped += 1; continue; }
        const exists = await client.query('SELECT id FROM movimientos WHERE n_doc = $1 AND fecha = $2::date LIMIT 1', [orderId, fecha]);
        if (exists.rows.length) { skipped += 1; continue; }
        await client.query(
          `INSERT INTO movimientos (fecha, tipo, descripcion, total, neto, iva, n_doc, creado_en)
           VALUES ($1::date, 'VENTA', $2, $3, $4, 0, $5, NOW())`,
          [fecha, `Venta Mercado Libre ${orderId}`, netoLiquidado, netoLiquidado, orderId]
        );
        imported += 1;
      }
      const result = { imported, skipped };
      const id = `SYNC-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const importedAt = new Date().toISOString();
      await client.query('INSERT INTO integration_sync_log (id, provider, imported_at, result) VALUES ($1,$2,$3::timestamp,$4::jsonb)', [id, 'mercadolibre', importedAt, JSON.stringify(result)]);
      await client.query(`INSERT INTO integration_provider_state (provider, enabled, last_sync_at, updated_at)
        VALUES ('mercadolibre', true, $1::timestamp, NOW()) ON CONFLICT (provider) DO UPDATE SET enabled=true, last_sync_at=$1::timestamp, updated_at=NOW()`, [importedAt]);
    });
    const result = { imported, skipped };
    await appendAuditLog('integrations.mercadolibre.importOrders', { count: rows.length, result }, auth.user.email);
    return sendJson(res, 200, { ok: true, provider: 'mercadolibre', importedAt: new Date().toISOString(), result });
  }

  const state = await readStore();
  ensureIntegrationStructures(state);
  let imported = 0; let skipped = 0;
  for (const row of rows) {
    const orderId = String(row.orderId || row.id || '').trim();
    const fecha = row.fecha || new Date().toISOString().slice(0, 10);
    const total = Number(row.total || 0);
    const comision = Number(row.comision || 0);
    const netoLiquidado = Number(row.netoLiquidado || (total - comision));
    if (!orderId || total <= 0) { skipped += 1; continue; }
    const exists = (state.marketplaceOrders || []).find(r => String(r.orderId || r.id) === orderId && r.fecha === fecha);
    if (exists) { skipped += 1; continue; }
    state.marketplaceOrders.push({ orderId, fecha, total, comision, netoLiquidado, source: 'mercadolibre' });
    state.movimientos.push({ id: `MKT-${Date.now()}-${Math.floor(Math.random() * 10000)}`, fecha, tipo: 'ingreso', categoria: 'venta_marketplace', descripcion: `Venta Mercado Libre ${orderId}`, monto: netoLiquidado, origen: 'mercadolibre' });
    imported += 1;
  }
  const result = { imported, skipped };
  const event = { id: `SYNC-${Date.now()}-${Math.floor(Math.random() * 10000)}`, provider: 'mercadolibre', importedAt: new Date().toISOString(), result };
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

  if (isPostgresMode()) {
    let imported = 0; let skipped = 0;
    await withPgClient(async (client) => {
      await ensurePgTables(client);
      for (const row of rows) {
        const folio = String(row.folio || '').trim();
        const fecha = row.fecha || new Date().toISOString().slice(0, 10);
        const total = Number(row.total || 0);
        const iva = Number(row.iva || Math.round(total * 0.19));
        if (!folio || total <= 0) { skipped += 1; continue; }
        const tipoDte = kind === 'compras' ? 'RCV_COMPRA' : 'RCV_VENTA';
        const exists = await client.query('SELECT id FROM documentos_fiscales WHERE tipo_dte = $1 AND folio = $2 LIMIT 1', [tipoDte, folio]);
        if (exists.rows.length) { skipped += 1; continue; }
        await client.query(
          `INSERT INTO documentos_fiscales (tipo_dte, folio, fecha_emision, total, iva, metadata, creado_en)
           VALUES ($1, $2, $3::date, $4, $5, $6::jsonb, NOW())`,
          [tipoDte, folio, fecha, total, iva, JSON.stringify({ source: 'sii', kind })]
        );
        imported += 1;
      }
      const result = { imported, skipped, kind };
      const id = `SYNC-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const importedAt = new Date().toISOString();
      await client.query('INSERT INTO integration_sync_log (id, provider, imported_at, result) VALUES ($1,$2,$3::timestamp,$4::jsonb)', [id, 'sii', importedAt, JSON.stringify(result)]);
      await client.query(`INSERT INTO integration_provider_state (provider, enabled, last_sync_at, updated_at)
        VALUES ('sii', true, $1::timestamp, NOW()) ON CONFLICT (provider) DO UPDATE SET enabled=true, last_sync_at=$1::timestamp, updated_at=NOW()`, [importedAt]);
    });
    const result = { imported, skipped, kind };
    await appendAuditLog('integrations.sii.importRCV', { count: rows.length, result }, auth.user.email);
    return sendJson(res, 200, { ok: true, provider: 'sii', importedAt: new Date().toISOString(), result });
  }

  const state = await readStore();
  ensureIntegrationStructures(state);
  const target = kind === 'compras' ? (state.rcvCompras || (state.rcvCompras = [])) : (state.rcvVentas || (state.rcvVentas = []));
  let imported = 0; let skipped = 0;
  for (const row of rows) {
    const folio = String(row.folio || '').trim();
    const fecha = row.fecha || new Date().toISOString().slice(0, 10);
    const total = Number(row.total || 0);
    const iva = Number(row.iva || Math.round(total * 0.19));
    if (!folio || total <= 0) { skipped += 1; continue; }
    const key = `${folio}-${fecha}`;
    const exists = target.find(r => `${r.folio}-${r.fecha}` === key);
    if (exists) { skipped += 1; continue; }
    target.push({ folio, fecha, total, iva, source: 'sii' });
    imported += 1;
  }
  const result = { imported, skipped, kind };
  const event = { id: `SYNC-${Date.now()}-${Math.floor(Math.random() * 10000)}`, provider: 'sii', importedAt: new Date().toISOString(), result };
  state.integrationConfigs.sii.enabled = true;
  state.integrationConfigs.sii.lastSyncAt = event.importedAt;
  state.integrationSyncLog.push(event);
  await writeStore(state);
  await appendAudit('integrations.sii.importRCV', { count: rows.length, result }, auth.user.email);
  return sendJson(res, 200, { ok: true, ...event });
}

module.exports = { updateIntegrationConfig, getIntegrationsStatus, importAlibabaCatalog, importMercadoLibre, importSii };
