const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');

function validateBackupShape(payload) {
  const requiredArrays = ['productos', 'movimientos', 'cuentas', 'terceros', 'flujoCaja'];
  const missing = requiredArrays.filter(k => !Array.isArray(payload[k]));
  return { valid: missing.length === 0, missing };
}

function buildSummary(store) {
  return {
    migratedAt: store.migratedAt,
    source: store.source,
    totals: {
      usuarios: store.usuarios.length,
      productos: store.productos.length,
      movimientos: store.movimientos.length,
      cuentas: store.cuentas.length,
      terceros: store.terceros.length,
      flujoCaja: store.flujoCaja.length,
      periodos: store.periodos.length,
      auditLog: store.auditLog.length
    }
  };
}

async function importJson(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const payload = body.payload || body;

  const validation = validateBackupShape(payload);
  if (!validation.valid) return sendJson(res, 400, { ok: false, message: 'Backup inválido: faltan arreglos requeridos', missing: validation.missing });

  const now = new Date().toISOString();
  const source = body.source || 'backup_json_manual';
  const current = await readStore();

  const next = {
    ...current,
    productos: payload.productos,
    movimientos: payload.movimientos,
    cuentas: payload.cuentas,
    terceros: payload.terceros,
    flujoCaja: payload.flujoCaja,
    migratedAt: now,
    source
  };

  await writeStore(next);
  await appendAudit('migration.import_json', {
    source, migratedAt: now,
    totals: {
      productos: payload.productos.length,
      movimientos: payload.movimientos.length,
      cuentas: payload.cuentas.length,
      terceros: payload.terceros.length,
      flujoCaja: payload.flujoCaja.length
    }
  }, auth.user.email);

  return sendJson(res, 200, { ok: true, summary: buildSummary(await readStore()) });
}

async function getSummary(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const store = await readStore();
  return sendJson(res, 200, { ok: true, summary: buildSummary(store) });
}


function normalizeFechaIso(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString().slice(0, 10);
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, d, m, y] = slash;
    const f = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    if (!Number.isNaN(f.getTime())) return f.toISOString().slice(0, 10);
  }
  const dash = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dash) {
    const [, d, m, y] = dash;
    const f = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    if (!Number.isNaN(f.getTime())) return f.toISOString().slice(0, 10);
  }
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    const [, y, m, d] = compact;
    const f = new Date(`${y}-${m}-${d}`);
    if (!Number.isNaN(f.getTime())) return f.toISOString().slice(0, 10);
  }
  return null;
}

function movementKey(m) {
  const fecha = normalizeFechaIso(m?.fecha) || '';
  const tipo = String(m?.tipo || '').trim().toUpperCase();
  const total = Math.round(Number(m?.total ?? m?.monto ?? 0));
  const neto = Math.round(Number(m?.neto || 0));
  const desc = String(m?.descripcion || m?.desc || '').trim().toUpperCase();
  return `${fecha}|${tipo}|${total}|${neto}|${desc}`;
}

function normalizeMovementPayload(m) {
  return {
    fecha: normalizeFechaIso(m?.fecha),
    tipo: String(m?.tipo || '').trim().toUpperCase(),
    descripcion: String(m?.descripcion || m?.desc || 'Migración automática frontend→backend').trim(),
    total: Number(m?.total ?? m?.monto ?? 0),
    neto: Number(m?.neto || 0),
    iva: Number(m?.iva || 0),
    retention: Number(m?.retention || 0),
    comision: Number(m?.comision || 0),
    costoMercaderia: Number(m?.costoMercaderia || 0),
    accepted: m?.accepted !== undefined ? Boolean(m.accepted) : true,
    documentRef: m?.documentRef || m?.nDoc || null
  };
}

async function syncFrontendMovements(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const year = Number(body?.year || new Date().getFullYear());
  const incoming = Array.isArray(body?.movements) ? body.movements : [];
  const incomingCashflows = Array.isArray(body?.cashflows) ? body.cashflows : [];
  const incomingAccounts = Array.isArray(body?.accounts) ? body.accounts : [];
  const normalized = incoming
    .map(normalizeMovementPayload)
    .filter((m) => m.fecha && m.tipo && new Date(m.fecha).getFullYear() === year);

  if (isPostgresMode()) {
    const result = await withPgClient(async (client) => {
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS retention NUMERIC(18,2) DEFAULT 0');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS comision NUMERIC(18,2) DEFAULT 0');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS costo_mercaderia NUMERIC(18,2) DEFAULT 0');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS accepted BOOLEAN DEFAULT TRUE');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS document_ref TEXT');
      await client.query('CREATE TABLE IF NOT EXISTS runtime_fragments (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMP DEFAULT NOW())');
      const rs = await client.query(`SELECT fecha, tipo, descripcion, total, neto FROM movimientos WHERE EXTRACT(YEAR FROM fecha) = $1`, [year]);
      const existing = new Set((rs.rows || []).map(movementKey));
      let imported = 0;
      let skipped = 0;
      for (const m of normalized) {
        const key = movementKey(m);
        if (existing.has(key)) { skipped += 1; continue; }
        await client.query(
          `INSERT INTO movimientos (fecha, tipo, descripcion, total, neto, iva, retention, comision, costo_mercaderia, accepted, document_ref, creado_en)
           VALUES ($1::date,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
          [m.fecha, m.tipo, m.descripcion, m.total, m.neto, m.iva, m.retention, m.comision, m.costoMercaderia, m.accepted, m.documentRef]
        );
        existing.add(key);
        imported += 1;
      }
      if (incomingCashflows.length) {
        await client.query(
          `INSERT INTO runtime_fragments (key, value, updated_at)
           VALUES ('flujoCaja', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [JSON.stringify(incomingCashflows)]
        );
      }
      if (incomingAccounts.length) {
        await client.query(
          `INSERT INTO runtime_fragments (key, value, updated_at)
           VALUES ('cuentas', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [JSON.stringify(incomingAccounts)]
        );
      }
      return { imported, skipped, received: normalized.length, syncedCashflows: incomingCashflows.length, syncedAccounts: incomingAccounts.length };
    });
    await appendAuditLog('migration.frontend_movements.sync', { year, ...result }, auth.user.email);
    return sendJson(res, 200, { ok: true, year, mode: 'postgres', ...result });
  }

  const state = await readStore();
  const existing = new Set((state.movimientos || []).map(movementKey));
  let imported = 0;
  let skipped = 0;
  for (const m of normalized) {
    const key = movementKey(m);
    if (existing.has(key)) { skipped += 1; continue; }
    state.movimientos.push({ id: `MIG-${Date.now()}-${Math.floor(Math.random()*100000)}`, ...m });
    existing.add(key);
    imported += 1;
  }
  if (incomingCashflows.length) state.flujoCaja = incomingCashflows;
  if (incomingAccounts.length) state.cuentas = incomingAccounts;
  await writeStore(state);
  await appendAudit('migration.frontend_movements.sync', { year, received: normalized.length, imported, skipped, syncedCashflows: incomingCashflows.length, syncedAccounts: incomingAccounts.length }, auth.user.email);
  return sendJson(res, 200, { ok: true, year, mode: 'file', received: normalized.length, imported, skipped, syncedCashflows: incomingCashflows.length, syncedAccounts: incomingAccounts.length });
}

module.exports = { importJson, getSummary, syncFrontendMovements };
