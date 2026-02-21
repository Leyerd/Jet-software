const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { isPeriodClosed } = require('./accountingClose');
const { requireRoles } = require('./auth');

async function createMovement(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const fecha = body.fecha;
  const tipo = body.tipo;
  const total = Number(body.total || 0);
  const desc = body.descripcion || '';

  if (!fecha || !tipo) return sendJson(res, 400, { ok: false, message: 'fecha y tipo son requeridos' });

  const state = await readStore();
  if (isPeriodClosed(state, fecha)) return sendJson(res, 409, { ok: false, message: 'No se puede registrar: período contable cerrado' });

  const movement = { id: `MOV-${Date.now()}-${Math.floor(Math.random() * 1000)}`, fecha, tipo, descripcion: desc, total };
  state.movimientos.push(movement);
  await writeStore(state);
  await appendAudit('movement.create', movement, auth.user.email);

  return sendJson(res, 201, { ok: true, movement });
}

async function listMovements(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const state = await readStore();
  const movements = [...state.movimientos].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  return sendJson(res, 200, { ok: true, movements });
}

module.exports = { createMovement, listMovements };
