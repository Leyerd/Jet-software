const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');

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
  const body = await parseBody(req);
  const payload = body.payload || body;

  const validation = validateBackupShape(payload);
  if (!validation.valid) {
    return sendJson(res, 400, {
      ok: false,
      message: 'Backup inválido: faltan arreglos requeridos',
      missing: validation.missing
    });
  }

  const now = new Date().toISOString();
  const source = body.source || 'backup_json_manual';
  const current = readStore();

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

  writeStore(next);
  appendAudit('migration.import_json', {
    source,
    migratedAt: now,
    totals: {
      productos: payload.productos.length,
      movimientos: payload.movimientos.length,
      cuentas: payload.cuentas.length,
      terceros: payload.terceros.length,
      flujoCaja: payload.flujoCaja.length
    }
  }, body.user || 'system');

  return sendJson(res, 200, { ok: true, summary: buildSummary(readStore()) });
}

function getSummary(_req, res) {
  const store = readStore();
  return sendJson(res, 200, { ok: true, summary: buildSummary(store) });
}

module.exports = { importJson, getSummary };
