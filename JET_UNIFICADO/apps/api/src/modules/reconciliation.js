const crypto = require('crypto');
const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');
const { assertPeriodOpenForDate } = require('./accountingClose');

const ALLOWED_RECONCILIATION_STATUS = ['pendiente', 'conciliado', 'observado', 'resuelto'];

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

function sha(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function normalizeCartolaRow(r, i) {
  return {
    id: r.id || `CART-${Date.now()}-${i}`,
    fecha: r.fecha,
    tipoMovimiento: r.tipoMovimiento || 'INGRESO',
    monto: Number(r.monto || 0),
    descripcion: r.descripcion || ''
  };
}

function normalizeRcvVentaRow(r, i) {
  return {
    id: r.id || `RCV-${Date.now()}-${i}`,
    fecha: r.fecha,
    neto: Number(r.neto || 0),
    iva: Number(r.iva || 0),
    total: Number(r.total || 0),
    folio: r.folio || null
  };
}

function normalizeMarketplaceRow(r, i) {
  return {
    id: r.id || `MKT-${Date.now()}-${i}`,
    fecha: r.fecha,
    total: Number(r.total || 0),
    comision: Number(r.comision || 0),
    netoLiquidado: Number(r.netoLiquidado || (Number(r.total || 0) - Number(r.comision || 0)))
  };
}

function buildDocumentIdentity(source, row) {
  if (source === 'cartola') {
    const period = toMonthKey(row.fecha) || 'sin-periodo';
    const docKey = `${row.id}-${row.fecha}`;
    return { docKey, period };
  }
  if (source === 'marketplace') {
    const period = toMonthKey(row.fecha) || 'sin-periodo';
    const docKey = `${row.id}-${row.fecha}`;
    return { docKey, period };
  }
  const folio = String(row.folio || row.id);
  const period = toMonthKey(row.fecha) || 'sin-periodo';
  const docKey = `${folio}-${row.fecha}`;
  return { docKey, period };
}

async function ensurePgReconciliationTables(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS ingestion_batches (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    period TEXT,
    checksum TEXT NOT NULL,
    total_rows INTEGER NOT NULL,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS documents_raw (
    id BIGSERIAL PRIMARY KEY,
    batch_id BIGINT NOT NULL REFERENCES ingestion_batches(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    doc_key TEXT NOT NULL,
    period TEXT,
    payload_hash TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (source, doc_key, payload_hash)
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS documents_normalized (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    doc_key TEXT NOT NULL,
    period TEXT,
    normalized_data JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendiente',
    version INTEGER NOT NULL DEFAULT 1,
    first_batch_id BIGINT REFERENCES ingestion_batches(id),
    last_batch_id BIGINT REFERENCES ingestion_batches(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (source, doc_key)
  )`);

  await client.query(`ALTER TABLE documents_normalized
    DROP CONSTRAINT IF EXISTS documents_normalized_status_check`);
  await client.query(`ALTER TABLE documents_normalized
    ADD CONSTRAINT documents_normalized_status_check
    CHECK (status IN ('pendiente','conciliado','observado','resuelto'))`);

  await client.query('CREATE INDEX IF NOT EXISTS idx_documents_raw_batch ON documents_raw(batch_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_documents_normalized_period ON documents_normalized(period)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_documents_normalized_status ON documents_normalized(status)');

  // Compat backward: tabla anterior usada en versiones previas.
  await client.query(`CREATE TABLE IF NOT EXISTS reconciliation_documents (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    period TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
}

async function importDocumentsBatch(source, rows, userEmail) {
  return withPgClient(async (client) => {
    await ensurePgReconciliationTables(client);

    const periodHint = rows.length ? (toMonthKey(rows[0].fecha) || 'sin-periodo') : null;
    const checksum = sha({ source, rows });
    const batchRs = await client.query(
      `INSERT INTO ingestion_batches (source, period, checksum, total_rows, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, source, period, checksum, total_rows AS "totalRows", created_at AS "createdAt"`,
      [source, periodHint, checksum, rows.length, userEmail]
    );
    const batch = batchRs.rows[0];

    let imported = 0;
    let skipped = 0;
    let normalizedInserted = 0;
    let normalizedUpdated = 0;

    for (const row of rows) {
      const { docKey, period } = buildDocumentIdentity(source, row);
      const payloadHash = sha(row);

      const rawIns = await client.query(
        `INSERT INTO documents_raw (batch_id, source, doc_key, period, payload_hash, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (source, doc_key, payload_hash) DO NOTHING
         RETURNING id`,
        [batch.id, source, docKey, period, payloadHash, JSON.stringify(row)]
      );

      if (!rawIns.rows.length) {
        skipped += 1;
        continue;
      }

      imported += 1;

      const normalizedUpsert = await client.query(
        `INSERT INTO documents_normalized
           (source, doc_key, period, normalized_data, status, version, first_batch_id, last_batch_id, created_at, updated_at)
         VALUES
           ($1, $2, $3, $4::jsonb, 'pendiente', 1, $5, $5, NOW(), NOW())
         ON CONFLICT (source, doc_key)
         DO UPDATE SET
           normalized_data = EXCLUDED.normalized_data,
           period = EXCLUDED.period,
           last_batch_id = EXCLUDED.last_batch_id,
           version = documents_normalized.version + 1,
           updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [source, docKey, period, JSON.stringify(row), batch.id]
      );

      if (normalizedUpsert.rows[0].inserted) normalizedInserted += 1;
      else normalizedUpdated += 1;

      // compatibilidad legacy para reportes previos
      await client.query(
        `INSERT INTO reconciliation_documents (id, source, period, payload, created_at)
         VALUES ($1,$2,$3,$4::jsonb,NOW())
         ON CONFLICT (id) DO NOTHING`,
        [`${source}:${docKey}`, source, period, JSON.stringify(row)]
      );
    }

    return { batch, imported, skipped, normalizedInserted, normalizedUpdated };
  });
}

async function importCartola(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const rows = parseImportRows(body).map(normalizeCartolaRow);

  for (const r of rows) await assertPeriodOpenForDate(r.fecha, 'importación cartola');

  if (isPostgresMode()) {
    const out = await importDocumentsBatch('cartola', rows, auth.user.email);
    await appendAuditLog('reconciliation.import_cartola', { received: rows.length, ...out }, auth.user.email);
    return sendJson(res, 200, { ok: true, received: rows.length, ...out });
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
  const rows = parseImportRows(body).map(normalizeRcvVentaRow);

  for (const r of rows) await assertPeriodOpenForDate(r.fecha, 'importación RCV ventas');

  if (isPostgresMode()) {
    const out = await importDocumentsBatch('rcv_ventas', rows, auth.user.email);

    await withPgClient(async (client) => {
      for (const row of rows) {
        const tipo = 'RCV_VENTA';
        const folio = String(row.folio || row.id);
        await client.query(
          `INSERT INTO documentos_fiscales (tipo_dte, folio, fecha_emision, neto, iva, total, metadata, creado_en)
           VALUES ($1,$2,$3::date,$4,$5,$6,$7::jsonb,NOW())
           ON CONFLICT (tipo_dte, folio)
           DO UPDATE SET fecha_emision = EXCLUDED.fecha_emision, neto = EXCLUDED.neto, iva = EXCLUDED.iva, total = EXCLUDED.total`,
          [tipo, folio, row.fecha, row.neto, row.iva, row.total, JSON.stringify({ source: 'reconciliation.import_rcv_ventas' })]
        );
      }
    });

    await appendAuditLog('reconciliation.import_rcv_ventas', { received: rows.length, ...out }, auth.user.email);
    return sendJson(res, 200, { ok: true, received: rows.length, ...out });
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
  const rows = parseImportRows(body).map(normalizeMarketplaceRow);

  for (const r of rows) await assertPeriodOpenForDate(r.fecha, 'importación marketplace');

  if (isPostgresMode()) {
    const out = await importDocumentsBatch('marketplace', rows, auth.user.email);
    await appendAuditLog('reconciliation.import_marketplace', { received: rows.length, ...out }, auth.user.email);
    return sendJson(res, 200, { ok: true, received: rows.length, ...out });
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

async function updateReconciliationStatus(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const source = String(body.source || '').trim();
  const docKey = String(body.docKey || '').trim();
  const status = String(body.status || '').trim().toLowerCase();
  const note = String(body.note || '').trim();

  if (!source || !docKey) return sendJson(res, 400, { ok: false, message: 'source y docKey son obligatorios' });
  if (!ALLOWED_RECONCILIATION_STATUS.includes(status)) {
    return sendJson(res, 400, { ok: false, message: `status inválido. Use: ${ALLOWED_RECONCILIATION_STATUS.join(', ')}` });
  }

  if (isPostgresMode()) {
    const updated = await withPgClient(async (client) => {
      await ensurePgReconciliationTables(client);
      const rs = await client.query(
        `UPDATE documents_normalized
         SET status = $3,
             normalized_data = jsonb_set(normalized_data, '{_statusNote}', to_jsonb($4::text), true),
             updated_at = NOW()
         WHERE source = $1 AND doc_key = $2
         RETURNING id, source, doc_key AS "docKey", period, status, version, updated_at AS "updatedAt"`,
        [source, docKey, status, note || '']
      );
      return rs.rows[0] || null;
    });

    if (!updated) return sendJson(res, 404, { ok: false, message: 'Documento no encontrado' });
    await appendAuditLog('reconciliation.status.update', { source, docKey, status, note }, auth.user.email);
    return sendJson(res, 200, { ok: true, document: updated });
  }

  return sendJson(res, 400, { ok: false, message: 'La actualización de estado documental requiere modo postgres para trazabilidad completa' });
}

async function listReconciliationDocuments(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const query = req.url.includes('?') ? new URL(req.url, 'http://localhost').searchParams : new URLSearchParams();
  const status = query.get('status');
  const source = query.get('source');
  const period = query.get('period');

  if (isPostgresMode()) {
    const out = await withPgClient(async (client) => {
      await ensurePgReconciliationTables(client);
      const clauses = [];
      const params = [];
      if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
      if (source) { params.push(source); clauses.push(`source = $${params.length}`); }
      if (period) { params.push(period); clauses.push(`period = $${params.length}`); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

      const rs = await client.query(
        `SELECT source, doc_key AS "docKey", period, status, version,
                first_batch_id AS "firstBatchId", last_batch_id AS "lastBatchId",
                updated_at AS "updatedAt"
         FROM documents_normalized
         ${where}
         ORDER BY updated_at DESC
         LIMIT 500`,
        params
      );

      const statusRs = await client.query(
        `SELECT status, COUNT(*)::int AS count
         FROM documents_normalized
         GROUP BY status`
      );

      const batchRs = await client.query(
        `SELECT id, source, period, checksum, total_rows AS "totalRows", created_by AS "createdBy", created_at AS "createdAt"
         FROM ingestion_batches
         ORDER BY id DESC
         LIMIT 50`
      );

      return { documents: rs.rows, statusBreakdown: statusRs.rows, recentBatches: batchRs.rows };
    });

    return sendJson(res, 200, { ok: true, ...out });
  }

  return sendJson(res, 200, { ok: true, documents: [], statusBreakdown: [], recentBatches: [], mode: 'file' });
}

async function getReconciliationSummary(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  let movements; let cashflows; let cartola; let rcvVentas; let marketplace; let statusBreakdown = [];

  if (isPostgresMode()) {
    const loaded = await withPgClient(async (client) => {
      await ensurePgReconciliationTables(client);
      const m = await client.query('SELECT fecha, tipo, total FROM movimientos');
      const f = await client.query('SELECT fecha, tipo_movimiento AS "tipoMovimiento", monto FROM flujo_caja');
      const d = await client.query('SELECT source, normalized_data AS payload FROM documents_normalized');
      const r = await client.query("SELECT fecha_emision AS fecha, total FROM documentos_fiscales WHERE tipo_dte='RCV_VENTA'");
      const statusRows = await client.query('SELECT status, COUNT(*)::int AS count FROM documents_normalized GROUP BY status');
      const cart = d.rows.filter(x => x.source === 'cartola').map(x => x.payload);
      const mk = d.rows.filter(x => x.source === 'marketplace').map(x => x.payload);
      return { movements: m.rows, cashflows: f.rows, cartola: cart, rcv: r.rows, marketplace: mk, statusBreakdown: statusRows.rows };
    });
    movements = loaded.movements;
    cashflows = loaded.cashflows;
    cartola = loaded.cartola;
    rcvVentas = loaded.rcv;
    marketplace = loaded.marketplace;
    statusBreakdown = loaded.statusBreakdown;
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

  return sendJson(res, 200, {
    ok: true,
    generatedAt: new Date().toISOString(),
    summary,
    documentStatuses: statusBreakdown
  });
}

module.exports = {
  getReconciliationSummary,
  importCartola,
  importRCVVentas,
  importMarketplaceOrders,
  listReconciliationDocuments,
  updateReconciliationStatus
};
