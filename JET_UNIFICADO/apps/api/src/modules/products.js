const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');

async function createProduct(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const nombre = body.nombre;
  const sku = body.sku || null;
  const stock = Number(body.stock || 0);
  const costoPromedio = Number(body.costoPromedio || 0);

  if (!nombre) return sendJson(res, 400, { ok: false, message: 'nombre es requerido' });

  const state = await readStore();
  const product = { id: `PROD-${Date.now()}-${Math.floor(Math.random() * 1000)}`, nombre, sku, stock, costoPromedio };
  state.productos.push(product);
  await writeStore(state);
  await appendAudit('product.create', product, auth.user.email);
  return sendJson(res, 201, { ok: true, product });
}

async function listProducts(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const state = await readStore();
  return sendJson(res, 200, { ok: true, products: state.productos });
}

module.exports = { createProduct, listProducts };
