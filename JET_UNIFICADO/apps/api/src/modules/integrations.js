const crypto = require('crypto');
const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');
const { assertPeriodOpenForDate } = require('./accountingClose');

const ALLOWED_PROVIDERS = ['alibaba', 'mercadolibre', 'sii'];

function ensureIntegrationStructures(state) {
  if (!state.integrationConfigs || typeof state.integrationConfigs !== 'object') {
    state.integrationConfigs = {
      alibaba: { enabled: false, lastSyncAt: null, accountAlias: null, secretRef: 'ALIBABA_API_KEY' },
      mercadolibre: { enabled: false, lastSyncAt: null, accountAlias: null, secretRef: 'ML_ACCESS_TOKEN' },
      sii: { enabled: false, lastSyncAt: null, accountAlias: null, secretRef: 'SII_API_KEY' }
    };
  }
  if (!Array.isArray(state.integrationSyncLog)) state.integrationSyncLog = [];
  if (!Array.isArray(state.integrationDeadLetter)) state.integrationDeadLetter = [];
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function sha(v) {
  return crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
}

function resolveConnectorSecret(provider) {
  if (provider === 'mercadolibre') return process.env.ML_ACCESS_TOKEN || null;
  if (provider === 'sii') return process.env.SII_API_KEY || null;
  if (provider === 'alibaba') return process.env.ALIBABA_API_KEY || null;
  return null;
}

async function ensurePgTables(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS integration_provider_state (
    provider TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT false,
    last_sync_at TIMESTAMP,
    account_alias TEXT,
    secret_ref TEXT,
    last_error TEXT,
    last_latency_ms INT,
    last_volume INT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW()
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS integration_sync_log (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    imported_at TIMESTAMP NOT NULL,
    result JSONB NOT NULL
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS integration_sync_jobs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    payload JSONB,
    last_error TEXT,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS integration_dead_letter (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    job_id TEXT,
    payload JSONB,
    error TEXT,
    retries INT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
}

function upsertAlibabaProducts(state, rows) {
  let created = 0;
  let updated = 0;
  if (!Array.isArray(state.productos)) state.productos = [];
  for (const row of rows) {
    const sku = String(row.sku || '').trim();
    if (!sku) continue;
    const existing = state.productos.find(p => String(p.sku || '').trim() === sku);
    const nombre = row.nombre || row.name || `Producto ${sku}`;
    const costoPromedio = Number(row.unitCost || row.costo || 0);
    if (!existing) {
      state.productos.push({ id: newId('PROD'), sku, nombre, stock: Number(row.stock || 0), costoPromedio });
      created += 1;
    } else {
      existing.nombre = nombre;
      if (!Number.isNaN(costoPromedio) && costoPromedio > 0) existing.costoPromedio = costoPromedio;
      updated += 1;
    }
  }
  return { created, updated };
}

function importMercadoLibreRowsToState(state, rows) {
  if (!Array.isArray(state.marketplaceOrders)) state.marketplaceOrders = [];
  if (!Array.isArray(state.movimientos)) state.movimientos = [];
  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    const orderId = String(row.orderId || row.id || '').trim();
    const fecha = row.fecha || nowIso().slice(0, 10);
    const total = Number(row.total || 0);
    const comision = Number(row.comision || 0);
    const netoLiquidado = Number(row.netoLiquidado || (total - comision));
    if (!orderId || total <= 0) { skipped += 1; continue; }
    const exists = state.marketplaceOrders.find(r => String(r.orderId || r.id) === orderId && r.fecha === fecha);
    if (exists) { skipped += 1; continue; }
    state.marketplaceOrders.push({ orderId, fecha, total, comision, netoLiquidado, source: 'mercadolibre' });
    state.movimientos.push({ id: newId('MKT'), fecha, tipo: 'ingreso', categoria: 'venta_marketplace', descripcion: `Venta Mercado Libre ${orderId}`, monto: netoLiquidado, origen: 'mercadolibre' });
    imported += 1;
  }
  return { imported, skipped };
}

function importSiiRowsToState(state, rows, kind) {
  const target = kind === 'compras' ? (state.rcvCompras || (state.rcvCompras = [])) : (state.rcvVentas || (state.rcvVentas = []));
  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    const folio = String(row.folio || '').trim();
    const fecha = row.fecha || nowIso().slice(0, 10);
    const total = Number(row.total || 0);
    const iva = Number(row.iva || Math.round(total * 0.19));
    if (!folio || total <= 0) { skipped += 1; continue; }
    const key = `${folio}-${fecha}`;
    if (target.find(r => `${r.folio}-${r.fecha}` === key)) { skipped += 1; continue; }
    target.push({ folio, fecha, total, iva, source: 'sii' });
    imported += 1;
  }
  return { imported, skipped, kind };
}

async function upsertProviderStateInDb(client, provider, patch) {
  await ensurePgTables(client);
  const current = await client.query('SELECT provider, enabled, last_sync_at, account_alias, secret_ref, last_error, last_latency_ms, last_volume FROM integration_provider_state WHERE provider=$1', [provider]);
  const c = current.rows[0] || {};
  await client.query(
    `INSERT INTO integration_provider_state (provider, enabled, last_sync_at, account_alias, secret_ref, last_error, last_latency_ms, last_volume, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (provider)
     DO UPDATE SET enabled=$2, last_sync_at=$3, account_alias=$4, secret_ref=$5, last_error=$6, last_latency_ms=$7, last_volume=$8, updated_at=NOW()`,
    [
      provider,
      patch.enabled !== undefined ? patch.enabled : (c.enabled ?? false),
      patch.lastSyncAt !== undefined ? patch.lastSyncAt : (c.last_sync_at || null),
      patch.accountAlias !== undefined ? patch.accountAlias : (c.account_alias || null),
      patch.secretRef !== undefined ? patch.secretRef : (c.secret_ref || null),
      patch.lastError !== undefined ? patch.lastError : (c.last_error || null),
      patch.lastLatencyMs !== undefined ? patch.lastLatencyMs : (c.last_latency_ms || null),
      patch.lastVolume !== undefined ? patch.lastVolume : (c.last_volume || 0)
    ]
  );
}

async function updateIntegrationConfig(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const provider = String(body.provider || '').toLowerCase();
  const enabled = Boolean(body.enabled);
  if (!ALLOWED_PROVIDERS.includes(provider)) return sendJson(res, 400, { ok: false, message: 'provider inválido: usa alibaba|mercadolibre|sii' });

  if (isPostgresMode()) {
    const config = await withPgClient(async (client) => {
      await upsertProviderStateInDb(client, provider, {
        enabled,
        accountAlias: body.accountAlias || null,
        secretRef: body.secretRef || `${provider.toUpperCase()}_API_KEY`
      });
      const rs = await client.query(
        `SELECT provider, enabled, last_sync_at AS "lastSyncAt", account_alias AS "accountAlias",
                secret_ref AS "secretRef", last_error AS "lastError", last_latency_ms AS "lastLatencyMs", last_volume AS "lastVolume"
         FROM integration_provider_state
         WHERE provider = $1`,
        [provider]
      );
      return rs.rows[0];
    });
    await appendAuditLog('integrations.config.update', { provider, enabled }, auth.user.email);
    return sendJson(res, 200, { ok: true, provider, config });
  }

  const state = await readStore();
  ensureIntegrationStructures(state);
  state.integrationConfigs[provider] = {
    ...(state.integrationConfigs[provider] || {}),
    enabled,
    lastSyncAt: state.integrationConfigs[provider]?.lastSyncAt || null,
    accountAlias: body.accountAlias || null,
    secretRef: body.secretRef || `${provider.toUpperCase()}_API_KEY`
  };
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
      const p = await client.query(
        `SELECT provider, enabled, last_sync_at AS "lastSyncAt", account_alias AS "accountAlias", secret_ref AS "secretRef",
                last_error AS "lastError", last_latency_ms AS "lastLatencyMs", last_volume AS "lastVolume"
         FROM integration_provider_state ORDER BY provider ASC`
      );
      const l = await client.query('SELECT id, provider, imported_at AS "importedAt", result FROM integration_sync_log ORDER BY imported_at DESC LIMIT 20');
      const d = await client.query('SELECT id, provider, job_id AS "jobId", error, retries, created_at AS "createdAt" FROM integration_dead_letter ORDER BY created_at DESC LIMIT 20');
      const providers = { alibaba: { enabled: false, lastSyncAt: null }, mercadolibre: { enabled: false, lastSyncAt: null }, sii: { enabled: false, lastSyncAt: null } };
      for (const row of p.rows) providers[row.provider] = row;
      return { providers, syncLogCount: l.rows.length, latestSyncEvents: l.rows, deadLetterCount: d.rows.length, deadLetter: d.rows };
    });
    return sendJson(res, 200, { ok: true, ...out });
  }

  const state = await readStore();
  ensureIntegrationStructures(state);
  return sendJson(res, 200, {
    ok: true,
    providers: state.integrationConfigs,
    syncLogCount: state.integrationSyncLog.length,
    latestSyncEvents: state.integrationSyncLog.slice(-20),
    deadLetterCount: (state.integrationDeadLetter || []).length,
    deadLetter: (state.integrationDeadLetter || []).slice(-20)
  });
}

async function logSyncEvent(provider, result, importedAt) {
  if (isPostgresMode()) {
    await withPgClient(async (client) => {
      await ensurePgTables(client);
      await client.query('INSERT INTO integration_sync_log (id, provider, imported_at, result) VALUES ($1,$2,$3::timestamp,$4::jsonb)', [newId('SYNC'), provider, importedAt, JSON.stringify(result)]);
    });
    return;
  }
  const state = await readStore();
  ensureIntegrationStructures(state);
  state.integrationSyncLog.push({ id: newId('SYNC'), provider, importedAt, result });
  await writeStore(state);
}

async function registerProviderMetrics(provider, data) {
  if (isPostgresMode()) {
    await withPgClient(async (client) => {
      await upsertProviderStateInDb(client, provider, data);
    });
    return;
  }
  const state = await readStore();
  ensureIntegrationStructures(state);
  state.integrationConfigs[provider] = { ...(state.integrationConfigs[provider] || {}), ...data };
  await writeStore(state);
}

async function pushDeadLetter(provider, jobId, payload, error, retries) {
  if (isPostgresMode()) {
    await withPgClient(async (client) => {
      await ensurePgTables(client);
      await client.query(
        `INSERT INTO integration_dead_letter (id, provider, job_id, payload, error, retries, created_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,NOW())`,
        [newId('DLQ'), provider, jobId, JSON.stringify(payload || {}), String(error || 'unknown'), Number(retries || 0)]
      );
    });
    return;
  }
  const state = await readStore();
  ensureIntegrationStructures(state);
  state.integrationDeadLetter.push({ id: newId('DLQ'), provider, jobId, payload, error: String(error || 'unknown'), retries: Number(retries || 0), createdAt: nowIso() });
  await writeStore(state);
}

async function resolveConnectorRows(provider, payload = {}) {
  const rows = Array.isArray(payload.rows) ? payload.rows : null;
  if (rows && rows.length) return rows;

  const secret = resolveConnectorSecret(provider);
  if (!secret) throw new Error(`secret faltante para provider ${provider}`);

  if (provider === 'mercadolibre') {
    const envRows = process.env.ML_ORDERS_JSON ? JSON.parse(process.env.ML_ORDERS_JSON) : [];
    return Array.isArray(envRows) ? envRows : [];
  }
  if (provider === 'sii') {
    const envRows = process.env.SII_RCV_JSON ? JSON.parse(process.env.SII_RCV_JSON) : [];
    return Array.isArray(envRows) ? envRows : [];
  }
  if (provider === 'alibaba') {
    const envRows = process.env.ALIBABA_PRODUCTS_JSON ? JSON.parse(process.env.ALIBABA_PRODUCTS_JSON) : [];
    return Array.isArray(envRows) ? envRows : [];
  }
  return [];
}

async function importAlibabaCatalog(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return sendJson(res, 400, { ok: false, message: 'rows es requerido (array no vacío)' });

  for (const r of rows) await assertPeriodOpenForDate(r.fecha || nowIso().slice(0, 10), 'importación Alibaba');

  if (isPostgresMode()) {
    const started = Date.now();
    const result = await withPgClient(async (client) => {
      await ensurePgTables(client);
      let imported = 0;
      for (const row of rows) {
        const sku = String(row.sku || '').trim();
        if (!sku) continue;
        const nombre = row.nombre || row.name || `Producto ${sku}`;
        const costo = Number(row.unitCost || row.costo || 0);
        const stock = Number(row.stock || 0);
        await client.query(
          `INSERT INTO productos (sku, nombre, costo_promedio, stock, creado_en)
           VALUES ($1,$2,$3,$4,NOW())
           ON CONFLICT (sku)
           DO UPDATE SET nombre=EXCLUDED.nombre, costo_promedio=EXCLUDED.costo_promedio, stock=GREATEST(productos.stock, EXCLUDED.stock)`,
          [sku, nombre, costo, stock]
        );
        imported += 1;
      }
      return { imported, skipped: Math.max(0, rows.length - imported) };
    });
    const importedAt = nowIso();
    const latencyMs = Date.now() - started;
    await logSyncEvent('alibaba', result, importedAt);
    await registerProviderMetrics('alibaba', { enabled: true, lastSyncAt: importedAt, lastError: null, lastLatencyMs: latencyMs, lastVolume: result.imported });
    await appendAuditLog('integrations.alibaba.importProducts', { count: rows.length, result, latencyMs }, auth.user.email);
    return sendJson(res, 200, { ok: true, provider: 'alibaba', importedAt, latencyMs, result });
  }

  const state = await readStore();
  ensureIntegrationStructures(state);
  const result = upsertAlibabaProducts(state, rows);
  const importedAt = nowIso();
  state.integrationConfigs.alibaba.enabled = true;
  state.integrationConfigs.alibaba.lastSyncAt = importedAt;
  state.integrationSyncLog.push({ id: newId('SYNC'), provider: 'alibaba', importedAt, result });
  await writeStore(state);
  await appendAudit('integrations.alibaba.importProducts', { count: rows.length, result }, auth.user.email);
  return sendJson(res, 200, { ok: true, provider: 'alibaba', importedAt, result });
}

async function importMercadoLibre(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return sendJson(res, 400, { ok: false, message: 'rows es requerido (array no vacío)' });

  for (const r of rows) await assertPeriodOpenForDate(r.fecha || nowIso().slice(0, 10), 'importación MercadoLibre');

  if (isPostgresMode()) {
    const started = Date.now();
    let imported = 0;
    let skipped = 0;
    await withPgClient(async (client) => {
      await ensurePgTables(client);
      for (const row of rows) {
        const orderId = String(row.orderId || row.id || '').trim();
        const fecha = row.fecha || nowIso().slice(0, 10);
        const total = Number(row.total || 0);
        const comision = Number(row.comision || 0);
        const netoLiquidado = Number(row.netoLiquidado || (total - comision));
        if (!orderId || total <= 0) { skipped += 1; continue; }
        const exists = await client.query("SELECT id FROM reconciliation_documents WHERE id = $1 LIMIT 1", [`ml:${orderId}:${fecha}`]);
        if (exists.rows.length) { skipped += 1; continue; }
        await client.query(
          `INSERT INTO reconciliation_documents (id, source, period, payload, created_at)
           VALUES ($1,'marketplace',$2,$3::jsonb,NOW())`,
          [`ml:${orderId}:${fecha}`, `${fecha.slice(0, 7)}`, JSON.stringify({ orderId, fecha, total, comision, netoLiquidado, source: 'mercadolibre' })]
        );
        imported += 1;
      }
    });
    const result = { imported, skipped };
    const importedAt = nowIso();
    const latencyMs = Date.now() - started;
    await logSyncEvent('mercadolibre', result, importedAt);
    await registerProviderMetrics('mercadolibre', { enabled: true, lastSyncAt: importedAt, lastError: null, lastLatencyMs: latencyMs, lastVolume: imported });
    await appendAuditLog('integrations.mercadolibre.importOrders', { count: rows.length, result, latencyMs }, auth.user.email);
    return sendJson(res, 200, { ok: true, provider: 'mercadolibre', importedAt, latencyMs, result });
  }

  const state = await readStore();
  ensureIntegrationStructures(state);
  const result = importMercadoLibreRowsToState(state, rows);
  const importedAt = nowIso();
  state.integrationConfigs.mercadolibre.enabled = true;
  state.integrationConfigs.mercadolibre.lastSyncAt = importedAt;
  state.integrationSyncLog.push({ id: newId('SYNC'), provider: 'mercadolibre', importedAt, result });
  await writeStore(state);
  await appendAudit('integrations.mercadolibre.importOrders', { count: rows.length, result }, auth.user.email);
  return sendJson(res, 200, { ok: true, provider: 'mercadolibre', importedAt, result });
}

async function importSii(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const kind = body.kind === 'compras' ? 'compras' : 'ventas';
  if (!rows.length) return sendJson(res, 400, { ok: false, message: 'rows es requerido (array no vacío)' });

  for (const r of rows) await assertPeriodOpenForDate(r.fecha || nowIso().slice(0, 10), 'importación SII RCV');

  if (isPostgresMode()) {
    const started = Date.now();
    let imported = 0;
    let skipped = 0;
    await withPgClient(async (client) => {
      await ensurePgTables(client);
      for (const row of rows) {
        const folio = String(row.folio || '').trim();
        const fecha = row.fecha || nowIso().slice(0, 10);
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
    });
    const result = { imported, skipped, kind };
    const importedAt = nowIso();
    const latencyMs = Date.now() - started;
    await logSyncEvent('sii', result, importedAt);
    await registerProviderMetrics('sii', { enabled: true, lastSyncAt: importedAt, lastError: null, lastLatencyMs: latencyMs, lastVolume: imported });
    await appendAuditLog('integrations.sii.importRCV', { count: rows.length, result, latencyMs }, auth.user.email);
    return sendJson(res, 200, { ok: true, provider: 'sii', importedAt, latencyMs, result });
  }

  const state = await readStore();
  ensureIntegrationStructures(state);
  const result = importSiiRowsToState(state, rows, kind);
  const importedAt = nowIso();
  state.integrationConfigs.sii.enabled = true;
  state.integrationConfigs.sii.lastSyncAt = importedAt;
  state.integrationSyncLog.push({ id: newId('SYNC'), provider: 'sii', importedAt, result });
  await writeStore(state);
  await appendAudit('integrations.sii.importRCV', { count: rows.length, result }, auth.user.email);
  return sendJson(res, 200, { ok: true, provider: 'sii', importedAt, result });
}

async function runProviderSync(provider, payload, actor) {
  const started = Date.now();
  const rows = await resolveConnectorRows(provider, payload);
  if (!rows.length) {
    throw new Error(`sin datos para sincronizar provider ${provider} (configure ${provider.toUpperCase()}_... o entregue rows)`);
  }

  if (provider === 'mercadolibre') {
    const fakeReq = { headers: { authorization: `Bearer ${payload.__token || ''}` } };
    void fakeReq;
    // reuse import logic by emulation in current mode
    if (isPostgresMode()) {
      let imported = 0;
      let skipped = 0;
      await withPgClient(async (client) => {
        await ensurePgTables(client);
        for (const row of rows) {
          const orderId = String(row.orderId || row.id || '').trim();
          const fecha = row.fecha || nowIso().slice(0, 10);
          const total = Number(row.total || 0);
          const comision = Number(row.comision || 0);
          const netoLiquidado = Number(row.netoLiquidado || (total - comision));
          if (!orderId || total <= 0) { skipped += 1; continue; }
          const exists = await client.query('SELECT id FROM reconciliation_documents WHERE id = $1 LIMIT 1', [`ml:${orderId}:${fecha}`]);
          if (exists.rows.length) { skipped += 1; continue; }
          await client.query('INSERT INTO reconciliation_documents (id, source, period, payload, created_at) VALUES ($1,$2,$3,$4::jsonb,NOW())', [`ml:${orderId}:${fecha}`, 'marketplace', `${fecha.slice(0, 7)}`, JSON.stringify({ orderId, fecha, total, comision, netoLiquidado, source: 'mercadolibre' })]);
          imported += 1;
        }
      });
      return { provider, result: { imported, skipped }, latencyMs: Date.now() - started, volume: imported };
    }
    const state = await readStore();
    ensureIntegrationStructures(state);
    const result = importMercadoLibreRowsToState(state, rows);
    await writeStore(state);
    return { provider, result, latencyMs: Date.now() - started, volume: result.imported };
  }

  if (provider === 'sii') {
    const kind = payload.kind === 'compras' ? 'compras' : 'ventas';
    if (isPostgresMode()) {
      let imported = 0;
      let skipped = 0;
      await withPgClient(async (client) => {
        await ensurePgTables(client);
        for (const row of rows) {
          const folio = String(row.folio || '').trim();
          const fecha = row.fecha || nowIso().slice(0, 10);
          const total = Number(row.total || 0);
          const iva = Number(row.iva || Math.round(total * 0.19));
          if (!folio || total <= 0) { skipped += 1; continue; }
          const tipoDte = kind === 'compras' ? 'RCV_COMPRA' : 'RCV_VENTA';
          const exists = await client.query('SELECT id FROM documentos_fiscales WHERE tipo_dte = $1 AND folio = $2 LIMIT 1', [tipoDte, folio]);
          if (exists.rows.length) { skipped += 1; continue; }
          await client.query('INSERT INTO documentos_fiscales (tipo_dte, folio, fecha_emision, total, iva, metadata, creado_en) VALUES ($1,$2,$3::date,$4,$5,$6::jsonb,NOW())', [tipoDte, folio, fecha, total, iva, JSON.stringify({ source: 'sii', kind })]);
          imported += 1;
        }
      });
      return { provider, result: { imported, skipped, kind }, latencyMs: Date.now() - started, volume: imported };
    }
    const state = await readStore();
    ensureIntegrationStructures(state);
    const result = importSiiRowsToState(state, rows, kind);
    await writeStore(state);
    return { provider, result, latencyMs: Date.now() - started, volume: result.imported };
  }

  if (provider === 'alibaba') {
    if (isPostgresMode()) {
      let imported = 0;
      await withPgClient(async (client) => {
        for (const row of rows) {
          const sku = String(row.sku || '').trim();
          if (!sku) continue;
          const nombre = row.nombre || row.name || `Producto ${sku}`;
          const costo = Number(row.unitCost || row.costo || 0);
          const stock = Number(row.stock || 0);
          await client.query('INSERT INTO productos (sku, nombre, costo_promedio, stock, creado_en) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (sku) DO UPDATE SET nombre=EXCLUDED.nombre, costo_promedio=EXCLUDED.costo_promedio, stock=GREATEST(productos.stock, EXCLUDED.stock)', [sku, nombre, costo, stock]);
          imported += 1;
        }
      });
      return { provider, result: { imported, skipped: Math.max(0, rows.length - imported) }, latencyMs: Date.now() - started, volume: imported };
    }
    const state = await readStore();
    ensureIntegrationStructures(state);
    const result = upsertAlibabaProducts(state, rows);
    await writeStore(state);
    return { provider, result, latencyMs: Date.now() - started, volume: (result.created + result.updated) };
  }

  throw new Error(`provider no soportado: ${provider}`);
}

async function runSyncWithRetry(provider, payload, actor) {
  const maxAttempts = Number(payload.maxAttempts || 3);
  const jobId = newId('JOB');
  let lastError = null;

  if (isPostgresMode()) {
    await withPgClient(async (client) => {
      await ensurePgTables(client);
      await client.query('INSERT INTO integration_sync_jobs (id, provider, status, attempts, max_attempts, payload, created_at) VALUES ($1,$2,$3,0,$4,$5::jsonb,NOW())', [jobId, provider, 'pending', maxAttempts, JSON.stringify(payload || {})]);
    });
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const startedAt = nowIso();
      if (isPostgresMode()) {
        await withPgClient(async (client) => {
          await client.query('UPDATE integration_sync_jobs SET status=$2, attempts=$3, started_at=NOW() WHERE id=$1', [jobId, 'running', attempt]);
        });
      }

      const out = await runProviderSync(provider, payload, actor);
      const importedAt = nowIso();
      await logSyncEvent(provider, { ...out.result, latencyMs: out.latencyMs, volume: out.volume, attempt }, importedAt);
      await registerProviderMetrics(provider, { enabled: true, lastSyncAt: importedAt, lastError: null, lastLatencyMs: out.latencyMs, lastVolume: out.volume });

      if (isPostgresMode()) {
        await withPgClient(async (client) => {
          await client.query('UPDATE integration_sync_jobs SET status=$2, finished_at=NOW(), last_error=NULL WHERE id=$1', [jobId, 'ok']);
        });
      }

      return { ok: true, provider, jobId, attempt, importedAt, ...out };
    } catch (err) {
      lastError = err;
      if (isPostgresMode()) {
        await withPgClient(async (client) => {
          await client.query('UPDATE integration_sync_jobs SET status=$2, last_error=$3 WHERE id=$1', [jobId, 'retrying', String(err.message || err)]);
        });
      }
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, Math.min(1000 * attempt, 3000)));
      }
    }
  }

  await registerProviderMetrics(provider, { lastError: String(lastError?.message || lastError), lastLatencyMs: null, lastVolume: 0 });
  await pushDeadLetter(provider, jobId, payload, String(lastError?.message || lastError), maxAttempts);
  if (isPostgresMode()) {
    await withPgClient(async (client) => {
      await client.query('UPDATE integration_sync_jobs SET status=$2, finished_at=NOW(), last_error=$3 WHERE id=$1', [jobId, 'failed', String(lastError?.message || lastError)]);
    });
  }
  return { ok: false, provider, jobId, error: String(lastError?.message || lastError), retries: maxAttempts };
}

async function runScheduledSync(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const provider = String(body.provider || '').toLowerCase();
  if (!ALLOWED_PROVIDERS.includes(provider)) return sendJson(res, 400, { ok: false, message: 'provider inválido: usa alibaba|mercadolibre|sii' });

  const result = await runSyncWithRetry(provider, body, auth.user.email);
  const status = result.ok ? 200 : 502;
  if (isPostgresMode()) await appendAuditLog('integrations.sync.run', result, auth.user.email);
  else await appendAudit('integrations.sync.run', result, auth.user.email);
  return sendJson(res, status, result);
}

async function listDeadLetter(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  if (isPostgresMode()) {
    const rows = await withPgClient(async (client) => {
      await ensurePgTables(client);
      const rs = await client.query('SELECT id, provider, job_id AS "jobId", error, retries, payload, created_at AS "createdAt" FROM integration_dead_letter ORDER BY created_at DESC LIMIT 100');
      return rs.rows;
    });
    return sendJson(res, 200, { ok: true, count: rows.length, deadLetter: rows });
  }

  const state = await readStore();
  ensureIntegrationStructures(state);
  const rows = (state.integrationDeadLetter || []).slice(-100).reverse();
  return sendJson(res, 200, { ok: true, count: rows.length, deadLetter: rows });
}

module.exports = {
  updateIntegrationConfig,
  getIntegrationsStatus,
  importAlibabaCatalog,
  importMercadoLibre,
  importSii,
  runScheduledSync,
  listDeadLetter
};
