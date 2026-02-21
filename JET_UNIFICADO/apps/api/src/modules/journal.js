const { parseBody, sendJson } = require('../lib/http');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');
const { readStore, writeStore, appendAudit } = require('../lib/store');

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
  if (Math.round(debe * 100) !== Math.round(haber * 100)) {
    return { ok: false, message: `Asiento descuadrado: debe=${debe} haber=${haber}` };
  }
  return { ok: true, debe, haber };
}

async function createEntry(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const fecha = body.fecha;
  const glosa = body.glosa || '';
  const origen = body.origen || 'manual';
  const lines = normalizeLines(Array.isArray(body.lines) ? body.lines : []);

  if (!fecha) return sendJson(res, 400, { ok: false, message: 'fecha es requerida' });
  if (!lines.length) return sendJson(res, 400, { ok: false, message: 'lines es requerido (array no vacío)' });

  if (isPostgresMode()) {
    const created = await withPgClient(async (client) => {
      await client.query('BEGIN');
      try {
        const rs = await client.query(
          `INSERT INTO asientos_contables (fecha, glosa, origen, estado, creado_por, creado_en)
           VALUES ($1::date, $2, $3, 'borrador', $4, NOW())
           RETURNING id, fecha, glosa, origen, estado, creado_por AS "creadoPor", creado_en AS "creadoEn"`,
          [fecha, glosa, origen, auth.user.email]
        );
        const entry = rs.rows[0];

        for (const line of lines) {
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

    await appendAuditLog('journal.entry.create', { entryId: created.id, lines: lines.length }, auth.user.email);
    return sendJson(res, 201, { ok: true, entry: created });
  }

  const state = await readStore();
  const entry = {
    id: `AST-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    fecha,
    glosa,
    origen,
    estado: 'borrador',
    creadoPor: auth.user.email,
    creadoEn: new Date().toISOString()
  };
  state.asientos.push(entry);
  for (const line of lines) {
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
  await appendAudit('journal.entry.create', { entryId: entry.id, lines: lines.length }, auth.user.email);
  return sendJson(res, 201, { ok: true, entry });
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
  const entries = state.asientos.map((a) => {
    const lines = state.asientoLineas.filter(l => l.asientoId === a.id);
    const debe = lines.reduce((s, l) => s + Number(l.debe || 0), 0);
    const haber = lines.reduce((s, l) => s + Number(l.haber || 0), 0);
    return { ...a, debe, haber };
  });
  return sendJson(res, 200, { ok: true, entries, count: entries.length });
}

module.exports = { createEntry, publishEntry, listEntries };
