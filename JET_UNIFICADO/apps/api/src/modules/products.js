const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');

async function createProduct(req, res) {
  const body = await parseBody(req);
  const nombre = body.nombre;
  const sku = body.sku || null;
  const stock = Number(body.stock || 0);
  const costoPromedio = Number(body.costoPromedio || 0);
  const user = body.user || 'system';

  if (!nombre) return sendJson(res, 400, { ok: false, message: 'nombre es requerido' });

  const state = readStore();
  const product = {
    id: `PROD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    nombre,
    sku,
    stock,
    costoPromedio
  };
  state.productos.push(product);
  writeStore(state);
  appendAudit('product.create', product, user);
  return sendJson(res, 201, { ok: true, product });
}

function listProducts(_req, res) {
  const state = readStore();
  return sendJson(res, 200, { ok: true, products: state.productos });
}

module.exports = { createProduct, listProducts };
