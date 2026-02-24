const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { isPeriodClosed, isPeriodClosedInDb } = require('./accountingClose');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');
const { createAutoEntryForMovement } = require('./journal');
const { evaluateComplianceBlockers } = require('./compliance');

async function createMovement(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const fecha = body.fecha;
  const tipo = body.tipo;
  const total = Number(body.total || 0);
  const neto = Number(body.neto || 0);
  const iva = Number(body.iva || 0);
  const retention = Number(body.retention || 0);
  const comision = Number(body.comision || 0);
  const costoMercaderia = Number(body.costoMercaderia || 0);
  const accepted = body.accepted === undefined ? true : Boolean(body.accepted);
  const documentRef = body.documentRef || null;
  const desc = body.descripcion || '';

  if (!fecha || !tipo) return sendJson(res, 400, { ok: false, message: 'fecha y tipo son requeridos' });

  if (isPostgresMode()) {
    const stateForCompliance = await readStore();
    const compliance = evaluateComplianceBlockers(stateForCompliance);
    if (compliance.blocked) {
      return sendJson(res, 409, { ok: false, message: compliance.reason, blockers: compliance.blockers, code: 'COMPLIANCE_BLOCK' });
    }

    if (await isPeriodClosedInDb(fecha)) {
      return sendJson(res, 409, { ok: false, message: 'No se puede registrar: período contable cerrado' });
    }

    const movement = await withPgClient(async (client) => {
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS auto_entry_created BOOLEAN DEFAULT FALSE');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS auto_entry_id TEXT');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS retention NUMERIC(18,2) DEFAULT 0');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS comision NUMERIC(18,2) DEFAULT 0');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS costo_mercaderia NUMERIC(18,2) DEFAULT 0');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS accepted BOOLEAN DEFAULT TRUE');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS document_ref TEXT');
      const rs = await client.query(
        `INSERT INTO movimientos (fecha, tipo, descripcion, total, neto, iva, retention, comision, costo_mercaderia, accepted, document_ref, creado_en)
         VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
         RETURNING id, fecha, tipo, descripcion, total, neto, iva, retention, comision,
                   costo_mercaderia AS "costoMercaderia", accepted, document_ref AS "documentRef",
                   auto_entry_created AS "autoJournalCreated", auto_entry_id AS "autoJournalEntryId"`,
        [fecha, tipo, desc, total, neto, iva, retention, comision, costoMercaderia, accepted, documentRef]
      );
      return rs.rows[0];
    });

    await appendAuditLog('movement.create', movement, auth.user.email);
    const autoJournal = await createAutoEntryForMovement(movement, auth.user.email);
    movement.autoJournalCreated = Boolean(autoJournal?.created);
    movement.autoJournalEntryId = autoJournal?.entryId || null;
    await withPgClient(async (client) => {
      await client.query('UPDATE movimientos SET auto_entry_created = $2, auto_entry_id = $3 WHERE id = $1', [movement.id, movement.autoJournalCreated, movement.autoJournalEntryId]);
    });
    return sendJson(res, 201, { ok: true, movement, autoJournal });
  }

  const state = await readStore();
  if (isPeriodClosed(state, fecha)) return sendJson(res, 409, { ok: false, message: 'No se puede registrar: período contable cerrado' });

  const compliance = evaluateComplianceBlockers(state);
  if (compliance.blocked) {
    return sendJson(res, 409, { ok: false, message: compliance.reason, blockers: compliance.blockers, code: 'COMPLIANCE_BLOCK' });
  }

  const movement = {
    id: `MOV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    fecha,
    tipo,
    descripcion: desc,
    total,
    neto,
    iva,
    retention,
    comision,
    costoMercaderia,
    accepted,
    documentRef,
    autoJournalCreated: false,
    autoJournalEntryId: null
  };
  state.movimientos.push(movement);
  await writeStore(state);
  await appendAudit('movement.create', movement, auth.user.email);
  const autoJournal = await createAutoEntryForMovement(movement, auth.user.email);
  movement.autoJournalCreated = Boolean(autoJournal?.created);
  movement.autoJournalEntryId = autoJournal?.entryId || null;
  await writeStore(state);

  return sendJson(res, 201, { ok: true, movement, autoJournal });
}

async function listMovements(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  if (isPostgresMode()) {
    const movements = await withPgClient(async (client) => {
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS retention NUMERIC(18,2) DEFAULT 0');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS comision NUMERIC(18,2) DEFAULT 0');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS costo_mercaderia NUMERIC(18,2) DEFAULT 0');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS accepted BOOLEAN DEFAULT TRUE');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS document_ref TEXT');
      const rs = await client.query(
        'SELECT id, fecha, tipo, descripcion, total, neto, iva, retention, comision, costo_mercaderia AS "costoMercaderia", accepted, document_ref AS "documentRef", auto_entry_created AS "autoJournalCreated", auto_entry_id AS "autoJournalEntryId" FROM movimientos ORDER BY fecha ASC, id ASC'
      );
      return rs.rows;
    });
    return sendJson(res, 200, { ok: true, movements });
  }

  const state = await readStore();
  const movements = [...state.movimientos].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  return sendJson(res, 200, { ok: true, movements });
}

module.exports = { createMovement, listMovements };
