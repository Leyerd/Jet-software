const crypto = require('crypto');
const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');
const { assertPeriodOpenForDate } = require('./accountingClose');
const { ensureTaxConfig, getCatalog, computeMonthlyF29, computeYearlyRli, computeF22ByRegime, isAcceptedForTax } = require('./tax');

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

function severityMatrix(absDelta, reference = 0) {
  const baseline = Math.max(1, Math.abs(reference));
  const ratio = absDelta / baseline;
  if (absDelta >= 150000 || ratio >= 0.15) return { severity: 'critical', slaHours: 24, owner: 'dueno' };
  if (absDelta >= 50000 || ratio >= 0.08) return { severity: 'high', slaHours: 48, owner: 'contador_admin' };
  if (absDelta >= 10000 || ratio >= 0.03) return { severity: 'medium', slaHours: 72, owner: 'operador' };
  return { severity: 'low', slaHours: 120, owner: 'operador' };
}

async function getCrossValidationReport(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const state = await readStore();
  const movements = state.movimientos || [];
  const inventory = state.productos || [];
  const rcvVentas = state.rcvVentas || [];
  const cartola = state.cartolaMovimientos || [];
  const now = new Date();

  const periods = new Set();
  for (const m of movements) { const k = toMonthKey(m.fecha); if (k) periods.add(k); }
  for (const r of rcvVentas) { const k = toMonthKey(r.fecha); if (k) periods.add(k); }
  for (const c of cartola) { const k = toMonthKey(c.fecha); if (k) periods.add(k); }

  const byPeriod = {};
  for (const p of periods) byPeriod[p] = { salesMov: 0, salesRcv: 0, cashBank: 0, stockValue: 0 };

  for (const m of movements) {
    const p = toMonthKey(m.fecha); if (!p || !byPeriod[p]) continue;
    if (String(m.tipo || '').toUpperCase() === 'VENTA') byPeriod[p].salesMov += Number(m.total || m.neto || 0);
  }
  for (const r of rcvVentas) { const p = toMonthKey(r.fecha); if (p && byPeriod[p]) byPeriod[p].salesRcv += Number(r.total || 0); }
  for (const c of cartola) {
    const p = toMonthKey(c.fecha); if (!p || !byPeriod[p]) continue;
    const sign = String(c.tipoMovimiento || '').toUpperCase() === 'EGRESO' ? -1 : 1;
    byPeriod[p].cashBank += sign * Number(c.monto || 0);
  }

  const totalStockValue = inventory.reduce((s, it) => s + (Number(it.stock || 0) * Number(it.costoPromedio || 0)), 0);
  Object.values(byPeriod).forEach((x) => { x.stockValue = totalStockValue; });

  const breaches = [];
  const sorted = Object.keys(byPeriod).sort();
  for (const period of sorted) {
    const row = byPeriod[period];
    const dSales = Math.round(row.salesMov - row.salesRcv);
    const dCash = Math.round(row.salesMov - row.cashBank);
    const dInv = Math.round(row.stockValue - (row.salesMov * 0.5));

    const rules = [
      { key: 'ventas_vs_rcv', delta: dSales, reference: row.salesMov, openedAt: `${period}-15T00:00:00.000Z` },
      { key: 'ventas_vs_bancos', delta: dCash, reference: row.salesMov, openedAt: `${period}-20T00:00:00.000Z` },
      { key: 'ventas_vs_inventario', delta: dInv, reference: row.stockValue, openedAt: `${period}-25T00:00:00.000Z` }
    ];

    for (const r of rules) {
      const m = severityMatrix(Math.abs(r.delta), r.reference);
      if (Math.abs(r.delta) <= 1000) continue;
      const openedAt = new Date(r.openedAt);
      const ageHours = Math.max(0, Math.floor((now.getTime() - openedAt.getTime()) / (1000 * 60 * 60)));
      breaches.push({
        id: `${r.key}:${period}`,
        period,
        ruleKey: r.key,
        delta: r.delta,
        severity: m.severity,
        slaHours: m.slaHours,
        owner: m.owner,
        ageHours,
        status: ageHours > m.slaHours ? 'over_sla' : 'open'
      });
    }
  }

  const summary = {
    totalBreaches: breaches.length,
    criticalOpenOver48h: breaches.filter((b) => b.severity === 'critical' && b.ageHours > 48).length,
    bySeverity: {
      critical: breaches.filter((b) => b.severity === 'critical').length,
      high: breaches.filter((b) => b.severity === 'high').length,
      medium: breaches.filter((b) => b.severity === 'medium').length,
      low: breaches.filter((b) => b.severity === 'low').length
    }
  };

  const topOwners = {};
  for (const b of breaches) topOwners[b.owner] = (topOwners[b.owner] || 0) + 1;
  const owners = Object.entries(topOwners).map(([owner, count]) => ({ owner, count })).sort((a, b) => b.count - a.count);

  await appendAudit('reconciliation.cross_check.daily', { totalBreaches: summary.totalBreaches, criticalOpenOver48h: summary.criticalOpenOver48h }, auth.user.email);
  if (isPostgresMode()) await appendAuditLog('reconciliation.cross_check.daily', { totalBreaches: summary.totalBreaches, criticalOpenOver48h: summary.criticalOpenOver48h }, auth.user.email);

  return sendJson(res, 200, {
    ok: true,
    generatedAt: now.toISOString(),
    summary,
    owners,
    breaches
  });
}


async function getTaxAccountingReconciliation(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const query = req.url.includes('?') ? new URL(req.url, 'http://localhost').searchParams : new URLSearchParams();
  const year = Number(query.get('year') || new Date().getFullYear());
  const month = Number(query.get('month') || (new Date().getMonth() + 1));

  let cfg; let yearMovs;
  if (isPostgresMode()) {
    cfg = await withPgClient(async (client) => {
      const rs = await client.query(
        `SELECT anio AS year, regimen AS regime, ppm_rate AS "ppmRate", iva_rate AS "ivaRate", ret_rate AS "retentionRate"
         FROM tax_config
         WHERE anio = $1
         ORDER BY id DESC
         LIMIT 1`,
        [year]
      );
      if (rs.rows.length) return rs.rows[0];
      const cat = getCatalog(year, '14D8');
      return { year, regime: '14D8', ppmRate: cat.ppmRate, ivaRate: cat.ivaRate, retentionRate: cat.retentionRate };
    });

    yearMovs = await withPgClient(async (client) => {
      const rs = await client.query(
        `SELECT fecha, tipo, total, neto, iva,
                COALESCE(retention, 0) AS retention,
                COALESCE(comision, 0) AS comision,
                COALESCE(costo_mercaderia, 0) AS "costoMercaderia",
                COALESCE(accepted, TRUE) AS accepted,
                document_ref AS "documentRef"
         FROM movimientos
         WHERE EXTRACT(YEAR FROM fecha) = $1`,
        [year]
      );
      return rs.rows;
    });
  } else {
    const state = await readStore();
    cfg = ensureTaxConfig(state);
    yearMovs = (state.movimientos || []).filter((m) => new Date(m.fecha).getFullYear() === year);
  }

  const catalog = getCatalog(cfg.year || year, cfg.regime || '14D8');
  const monthMovs = yearMovs.filter((m) => (new Date(m.fecha).getMonth() + 1) === month);

  const f29 = computeMonthlyF29(monthMovs, cfg, catalog);
  const rli = computeYearlyRli(yearMovs, catalog);
  const f22 = computeF22ByRegime(rli.components.rli, cfg.regime, catalog);

  const ledger = {
    ivaDebitoVentas: Math.round(monthMovs
      .filter((m) => String(m.tipo).toUpperCase() === 'VENTA')
      .reduce((a, b) => a + Number(b.iva || 0), 0)),
    ivaCreditoCompras: Math.round(monthMovs
      .filter((m) => ['GASTO_LOCAL', 'IMPORTACION'].includes(String(m.tipo).toUpperCase()) && isAcceptedForTax(m))
      .reduce((a, b) => a + Number(b.iva || 0), 0)),
    retencionHonorarios: Math.round(monthMovs
      .filter((m) => String(m.tipo).toUpperCase() === 'HONORARIOS' && isAcceptedForTax(m))
      .reduce((a, b) => a + Number(b.retention || 0), 0)),
    rliAnual: Math.round(rli.components.rli),
    ddjjBase: Math.round(rli.ddjjBase.provisionalBase)
  };

  const checks = [
    { key: 'ledger_vs_f29_debito', expected: ledger.ivaDebitoVentas, actual: f29.casillas.casilla_538_debitoFiscal },
    { key: 'ledger_vs_f29_credito', expected: ledger.ivaCreditoCompras, actual: f29.casillas.casilla_511_creditoFiscal },
    { key: 'ledger_vs_f29_retencion', expected: ledger.retencionHonorarios, actual: f29.casillas.casilla_151_retHonorarios },
    { key: 'rli_vs_f22', expected: ledger.rliAnual, actual: rli.components.rli },
    { key: 'ddjj_base_vs_rli_non_negative', expected: Math.max(0, ledger.rliAnual), actual: ledger.ddjjBase }
  ].map((it) => {
    const delta = Math.round(Number(it.expected || 0) - Number(it.actual || 0));
    return { ...it, delta, status: Math.abs(delta) <= 1 ? 'ok' : 'observed' };
  });

  const summary = {
    total: checks.length,
    ok: checks.filter((c) => c.status === 'ok').length,
    observed: checks.filter((c) => c.status === 'observed').length,
    metaB5Reached: checks.every((c) => c.status === 'ok')
  };

  await appendAudit('reconciliation.tax_ledger', { year, month, observed: summary.observed }, auth.user.email);
  if (isPostgresMode()) await appendAuditLog('reconciliation.tax_ledger', { year, month, observed: summary.observed }, auth.user.email);

  return sendJson(res, 200, {
    ok: true,
    generatedAt: new Date().toISOString(),
    year,
    month,
    regime: cfg.regime,
    normativeVersion: catalog.version,
    ledger,
    tax: { f29, f22: { rli, selectedRegime: f22 } },
    checks,
    summary
  });
}

module.exports = {
  getReconciliationSummary,
  getCrossValidationReport,
  getTaxAccountingReconciliation,
  importCartola,
  importRCVVentas,
  importMarketplaceOrders,
  listReconciliationDocuments,
  updateReconciliationStatus
};
