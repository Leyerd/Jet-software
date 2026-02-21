const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { isPeriodClosed } = require('./accountingClose');

async function createMovement(req, res) {
  const body = await parseBody(req);
  const fecha = body.fecha;
  const tipo = body.tipo;
  const total = Number(body.total || 0);
  const desc = body.descripcion || '';
  const user = body.user || 'system';

  if (!fecha || !tipo) {
    return sendJson(res, 400, { ok: false, message: 'fecha y tipo son requeridos' });
  }

  const state = readStore();
  if (isPeriodClosed(state, fecha)) {
    return sendJson(res, 409, { ok: false, message: 'No se puede registrar: período contable cerrado' });
  }

  const movement = {
    id: `MOV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    fecha,
    tipo,
    descripcion: desc,
    total
  };

  state.movimientos.push(movement);
  writeStore(state);
  appendAudit('movement.create', movement, user);

  return sendJson(res, 201, { ok: true, movement });
}

function listMovements(_req, res) {
  const state = readStore();
  const movements = [...state.movimientos].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  return sendJson(res, 200, { ok: true, movements });
}

module.exports = { createMovement, listMovements };
