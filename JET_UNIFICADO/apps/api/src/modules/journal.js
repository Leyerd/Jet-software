const { parseBody, sendJson } = require('../lib/http');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');
const { readStore, writeStore, appendAudit } = require('../lib/store');

const DEFAULT_ACCOUNTS = {
  caja: { codigo: '1101', nombre: 'Caja y Bancos', tipo: 'activo' },
  ivaDebito: { codigo: '2101', nombre: 'IVA Débito Fiscal', tipo: 'pasivo' },
  ivaCredito: { codigo: '1102', nombre: 'IVA Crédito Fiscal', tipo: 'activo' },
  ventas: { codigo: '4101', nombre: 'Ventas', tipo: 'ingreso' },
  compras: { codigo: '5101', nombre: 'Compras y Gastos', tipo: 'gasto' },
  honorarios: { codigo: '5102', nombre: 'Gasto Honorarios', tipo: 'gasto' },
  retenciones: { codigo: '2102', nombre: 'Retenciones por Pagar', tipo: 'pasivo' },
  comisiones: { codigo: '5103', nombre: 'Comisiones Marketplace', tipo: 'gasto' },
  proveedores: { codigo: '2103', nombre: 'Proveedores', tipo: 'pasivo' }
};

function normalizeLines(lines = []) {
  return lines.map((l) => ({
    cuentaId: Number(l.cuentaId),
    debe: Number(l.debe || 0),
    haber: Number(l.haber || 0),
    descripcion: l.descripcion || ''
  }));
}

function validateBalanced(lines) {
  const debe = lines.reduce((a, b) => a + Number(b.debe || 0), 0);
  const haber = lines.reduce((a, b) => a + Number(b.haber || 0), 0);
  if (debe <= 0 && haber <= 0) return { ok: false, message: 'El asiento debe tener montos > 0' };
  if (Math.round(debe * 100) !== Math.round(haber * 100)) return { ok: false, message: `Asiento descuadrado: debe=${debe} haber=${haber}` };
  return { ok: true, debe, haber };
}

async function ensureAccount(codeDef, state) {
  if (isPostgresMode()) {
    return withPgClient(async (client) => {
      const rs = await client.query(
        `INSERT INTO cuentas (codigo, nombre, tipo, saldo, creado_en)
         VALUES ($1, $2, $3, 0, NOW())
         ON CONFLICT (codigo)
         DO UPDATE SET nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo
         RETURNING id`,
        [codeDef.codigo, codeDef.nombre, codeDef.tipo]
      );
      return rs.rows[0].id;
    });
  }

  const existing = (state.cuentas || []).find(c => String(c.codigo) === String(codeDef.codigo));
  if (existing) return existing.id;
  const created = { id: `CTA-${Date.now()}-${Math.floor(Math.random() * 10000)}`, codigo: codeDef.codigo, nombre: codeDef.nombre, tipo: codeDef.tipo, saldo: 0 };
  state.cuentas.push(created);
  return created.id;
}

async function createEntryInternal({ fecha, glosa, origen, lines, userEmail, initialStatus = 'borrador', skipValidation = false }) {
  const normalized = normalizeLines(lines);
  if (!skipValidation) {
    const balance = validateBalanced(normalized);
    if (!balance.ok) throw new Error(balance.message);
  }

  if (isPostgresMode()) {
    return withPgClient(async (client) => {
      await client.query('BEGIN');
      try {
        const rs = await client.query(
          `INSERT INTO asientos_contables (fecha, glosa, origen, estado, creado_por, creado_en)
           VALUES ($1::date, $2, $3, $4, $5, NOW())
           RETURNING id, fecha, glosa, origen, estado, creado_por AS "creadoPor", creado_en AS "creadoEn"`,
          [fecha, glosa, origen, initialStatus, userEmail]
        );
        const entry = rs.rows[0];
        for (const line of normalized) {
          await client.query(
            `INSERT INTO asiento_lineas (asiento_id, cuenta_id, debe, haber, descripcion)
             VALUES ($1, $2, $3, $4, $5)`,
            [entry.id, line.cuentaId, line.debe, line.haber, line.descripcion]
          );
        }
        await client.query('COMMIT');
        return entry;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  }

  const state = await readStore();
  if (!Array.isArray(state.asientos)) state.asientos = [];
  if (!Array.isArray(state.asientoLineas)) state.asientoLineas = [];
  const entry = {
    id: `AST-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    fecha,
    glosa,
    origen,
    estado: initialStatus,
    creadoPor: userEmail,
    creadoEn: new Date().toISOString()
  };
  state.asientos.push(entry);
  for (const line of normalized) {
    state.asientoLineas.push({
      id: `ALN-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      asientoId: entry.id,
      cuentaId: line.cuentaId,
      debe: line.debe,
      haber: line.haber,
      descripcion: line.descripcion
    });
  }
  await writeStore(state);
  return entry;
}

async function buildAutoLinesForMovement(movement) {
  const tipo = String(movement.tipo || '').toUpperCase();
  const total = Number(movement.total || 0);
  const neto = Number(movement.neto || 0);
  const iva = Number(movement.iva || 0);
  const retention = Number(movement.retention || 0);
  const comision = Number(movement.comision || 0);

  const state = isPostgresMode() ? null : await readStore();
  if (state && !Array.isArray(state.cuentas)) state.cuentas = [];

  const ids = {
    caja: await ensureAccount(DEFAULT_ACCOUNTS.caja, state),
    ivaDebito: await ensureAccount(DEFAULT_ACCOUNTS.ivaDebito, state),
    ivaCredito: await ensureAccount(DEFAULT_ACCOUNTS.ivaCredito, state),
    ventas: await ensureAccount(DEFAULT_ACCOUNTS.ventas, state),
    compras: await ensureAccount(DEFAULT_ACCOUNTS.compras, state),
    honorarios: await ensureAccount(DEFAULT_ACCOUNTS.honorarios, state),
    retenciones: await ensureAccount(DEFAULT_ACCOUNTS.retenciones, state),
    comisiones: await ensureAccount(DEFAULT_ACCOUNTS.comisiones, state),
    proveedores: await ensureAccount(DEFAULT_ACCOUNTS.proveedores, state)
  };

  if (state) await writeStore(state);

  if (tipo === 'VENTA') {
    const n = neto > 0 ? neto : Math.max(0, total - iva);
    const v = iva > 0 ? iva : Math.max(0, total - n);
    const t = total > 0 ? total : n + v;
    return [
      { cuentaId: ids.caja, debe: t, haber: 0, descripcion: 'Cobro venta' },
      { cuentaId: ids.ventas, debe: 0, haber: n, descripcion: 'Ingreso por venta' },
      { cuentaId: ids.ivaDebito, debe: 0, haber: v, descripcion: 'IVA débito' }
    ];
  }

  if (tipo === 'GASTO_LOCAL' || tipo === 'IMPORTACION' || tipo === 'COMPRA') {
    const n = neto > 0 ? neto : Math.max(0, total - iva);
    const v = iva > 0 ? iva : Math.max(0, total - n);
    const t = total > 0 ? total : n + v;
    return [
      { cuentaId: ids.compras, debe: n, haber: 0, descripcion: 'Gasto/compra' },
      { cuentaId: ids.ivaCredito, debe: v, haber: 0, descripcion: 'IVA crédito' },
      { cuentaId: ids.caja, debe: 0, haber: t, descripcion: 'Pago de gasto/compra' }
    ];
  }

  if (tipo === 'HONORARIOS') {
    const n = neto > 0 ? neto : total;
    const r = retention > 0 ? retention : 0;
    const pago = Math.max(0, n - r);
    return [
      { cuentaId: ids.honorarios, debe: n, haber: 0, descripcion: 'Gasto honorarios' },
      { cuentaId: ids.retenciones, debe: 0, haber: r, descripcion: 'Retención honorarios' },
      { cuentaId: ids.caja, debe: 0, haber: pago, descripcion: 'Pago honorarios' }
    ];
  }

  if (tipo === 'COMISION_MARKETPLACE') {
    return [
      { cuentaId: ids.comisiones, debe: comision || total, haber: 0, descripcion: 'Comisión marketplace' },
      { cuentaId: ids.caja, debe: 0, haber: comision || total, descripcion: 'Pago comisión marketplace' }
    ];
  }

  return null;
}

async function createAutoEntryForMovement(movement, userEmail = 'system') {
  const lines = await buildAutoLinesForMovement(movement);
  if (!lines || !lines.length) return { created: false, reason: 'tipo_sin_regla' };

  const entry = await createEntryInternal({
    fecha: movement.fecha || new Date().toISOString().slice(0, 10),
    glosa: `Asiento automático ${movement.tipo || 'MOV'} ${movement.id || ''}`.trim(),
    origen: `movement:${movement.id || 'sin-id'}`,
    lines,
    userEmail,
    initialStatus: 'publicado'
  });

  if (isPostgresMode()) {
    await appendAuditLog('journal.entry.auto', { movementId: movement.id, entryId: entry.id, tipo: movement.tipo }, userEmail);
  } else {
    await appendAudit('journal.entry.auto', { movementId: movement.id, entryId: entry.id, tipo: movement.tipo }, userEmail);
  }

  return { created: true, entryId: entry.id };
}

async function createEntry(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const fecha = body.fecha;
  const glosa = body.glosa || '';
  const origen = body.origen || 'manual';
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!fecha) return sendJson(res, 400, { ok: false, message: 'fecha es requerida' });
  if (!lines.length) return sendJson(res, 400, { ok: false, message: 'lines es requerido (array no vacío)' });

  try {
    const entry = await createEntryInternal({ fecha, glosa, origen, lines, userEmail: auth.user.email, initialStatus: 'borrador' });
    if (isPostgresMode()) await appendAuditLog('journal.entry.create', { entryId: entry.id, lines: lines.length }, auth.user.email);
    else await appendAudit('journal.entry.create', { entryId: entry.id, lines: lines.length }, auth.user.email);
    return sendJson(res, 201, { ok: true, entry });
  } catch (err) {
    return sendJson(res, 409, { ok: false, message: err.message });
  }
}

async function publishEntry(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const entryId = body.entryId;
  if (!entryId) return sendJson(res, 400, { ok: false, message: 'entryId es requerido' });

  if (isPostgresMode()) {
    const result = await withPgClient(async (client) => {
      const e = await client.query('SELECT id, estado FROM asientos_contables WHERE id = $1', [Number(entryId)]);
      if (!e.rows.length) return { status: 404, payload: { ok: false, message: 'Asiento no encontrado' } };
      if (e.rows[0].estado !== 'borrador') return { status: 409, payload: { ok: false, message: 'Solo se publica un borrador' } };

      const linesRs = await client.query('SELECT cuenta_id AS "cuentaId", debe, haber FROM asiento_lineas WHERE asiento_id = $1', [Number(entryId)]);
      const balance = validateBalanced(linesRs.rows);
      if (!balance.ok) return { status: 409, payload: { ok: false, message: balance.message } };

      const updated = await client.query(
        `UPDATE asientos_contables
         SET estado = 'publicado'
         WHERE id = $1
         RETURNING id, fecha, glosa, origen, estado, creado_por AS "creadoPor", creado_en AS "creadoEn"`,
        [Number(entryId)]
      );
      return { status: 200, payload: { ok: true, entry: updated.rows[0], balance } };
    });

    if (result.status === 200) await appendAuditLog('journal.entry.publish', { entryId }, auth.user.email);
    return sendJson(res, result.status, result.payload);
  }

  const state = await readStore();
  const entry = state.asientos.find(a => a.id === entryId);
  if (!entry) return sendJson(res, 404, { ok: false, message: 'Asiento no encontrado' });
  if (entry.estado !== 'borrador') return sendJson(res, 409, { ok: false, message: 'Solo se publica un borrador' });
  const lines = state.asientoLineas.filter(l => l.asientoId === entryId);
  const balance = validateBalanced(lines);
  if (!balance.ok) return sendJson(res, 409, { ok: false, message: balance.message });

  entry.estado = 'publicado';
  await writeStore(state);
  await appendAudit('journal.entry.publish', { entryId }, auth.user.email);
  return sendJson(res, 200, { ok: true, entry, balance });
}

async function reverseEntry(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const entryId = body.entryId;
  const motivo = body.motivo || 'reversion manual';
  if (!entryId) return sendJson(res, 400, { ok: false, message: 'entryId es requerido' });

  if (isPostgresMode()) {
    const result = await withPgClient(async (client) => {
      const e = await client.query('SELECT id, fecha, glosa, origen, estado FROM asientos_contables WHERE id = $1', [Number(entryId)]);
      if (!e.rows.length) return { status: 404, payload: { ok: false, message: 'Asiento no encontrado' } };
      if (e.rows[0].estado !== 'publicado') return { status: 409, payload: { ok: false, message: 'Solo se revierte un asiento publicado' } };
      const linesRs = await client.query('SELECT cuenta_id AS "cuentaId", debe, haber, descripcion FROM asiento_lineas WHERE asiento_id = $1', [Number(entryId)]);
      const reverseLines = linesRs.rows.map(l => ({ cuentaId: l.cuentaId, debe: Number(l.haber || 0), haber: Number(l.debe || 0), descripcion: `Reverso: ${l.descripcion || ''}` }));
      const created = await createEntryInternal({ fecha: new Date().toISOString().slice(0, 10), glosa: `Reverso asiento ${entryId}: ${motivo}`, origen: `reverso:${entryId}`, lines: reverseLines, userEmail: auth.user.email, initialStatus: 'publicado' });
      await client.query(`UPDATE asientos_contables SET estado = 'reversado' WHERE id = $1`, [Number(entryId)]);
      return { status: 200, payload: { ok: true, reversedEntryId: created.id, originalEntryId: Number(entryId) } };
    });
    if (result.status === 200) await appendAuditLog('journal.entry.reverse', { entryId, motivo }, auth.user.email);
    return sendJson(res, result.status, result.payload);
  }

  const state = await readStore();
  const entry = state.asientos.find(a => a.id === entryId);
  if (!entry) return sendJson(res, 404, { ok: false, message: 'Asiento no encontrado' });
  if (entry.estado !== 'publicado') return sendJson(res, 409, { ok: false, message: 'Solo se revierte un asiento publicado' });
  const lines = state.asientoLineas.filter(l => l.asientoId === entryId);
  const reverseLines = lines.map(l => ({ cuentaId: l.cuentaId, debe: Number(l.haber || 0), haber: Number(l.debe || 0), descripcion: `Reverso: ${l.descripcion || ''}` }));
  const created = await createEntryInternal({ fecha: new Date().toISOString().slice(0, 10), glosa: `Reverso asiento ${entryId}: ${motivo}`, origen: `reverso:${entryId}`, lines: reverseLines, userEmail: auth.user.email, initialStatus: 'publicado' });
  entry.estado = 'reversado';
  await appendAudit('journal.entry.reverse', { entryId, motivo, reversedEntryId: created.id }, auth.user.email);
  return sendJson(res, 200, { ok: true, reversedEntryId: created.id, originalEntryId: entryId });
}

async function listEntries(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  if (isPostgresMode()) {
    const entries = await withPgClient(async (client) => {
      const rs = await client.query(
        `SELECT a.id, a.fecha, a.glosa, a.origen, a.estado,
                a.creado_por AS "creadoPor", a.creado_en AS "creadoEn",
                COALESCE(SUM(l.debe),0) AS debe, COALESCE(SUM(l.haber),0) AS haber
         FROM asientos_contables a
         LEFT JOIN asiento_lineas l ON l.asiento_id = a.id
         GROUP BY a.id
         ORDER BY a.id DESC`
      );
      return rs.rows;
    });
    return sendJson(res, 200, { ok: true, entries, count: entries.length });
  }

  const state = await readStore();
  const entries = (state.asientos || []).map((a) => {
    const lines = (state.asientoLineas || []).filter(l => l.asientoId === a.id);
    const debe = lines.reduce((s, l) => s + Number(l.debe || 0), 0);
    const haber = lines.reduce((s, l) => s + Number(l.haber || 0), 0);
    return { ...a, debe, haber };
  });
  return sendJson(res, 200, { ok: true, entries, count: entries.length });
}

module.exports = { createEntry, publishEntry, reverseEntry, listEntries, validateBalanced, createAutoEntryForMovement };
