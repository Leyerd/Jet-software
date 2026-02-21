const url = require('url');
const { sendJson, notFound, methodNotAllowed } = require('./lib/http');
const { register, login, me } = require('./modules/auth');
const { importJson, getSummary } = require('./modules/migration');
const { closePeriod, reopenPeriod, listPeriods } = require('./modules/accountingClose');
const { createMovement, listMovements } = require('./modules/movements');
const { createProduct, listProducts } = require('./modules/products');
const { coherenceCheck } = require('./modules/system');
const { dbStatus } = require('./modules/db');

const modulesList = [
  'arquitectura-unificada',
  'auth-roles-basico',
  'migracion-datos',
  'cierre-contable-con-permisos',
  'movimientos-con-bloqueo-periodo',
  'productos-base',
  'auditoria-eventos',
  'coherence-check',
  'postgres-migration-tooling'
];

function route(req, res) {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;

  if (req.method === 'GET' && path === '/health') {
    return sendJson(res, 200, { ok: true, service: 'jet-api', sprint: 3, version: 'v1.3-sprint3' });
  }

  if (req.method === 'GET' && path === '/modules') {
    return sendJson(res, 200, { ok: true, modules: modulesList });
  }

  if (req.method === 'GET' && path === '/system/coherence-check') {
    return coherenceCheck(req, res);
  }

  if (req.method === 'GET' && path === '/db/status') {
    return dbStatus(req, res);
  }

  if (path === '/auth/register') {
    if (req.method !== 'POST') return methodNotAllowed(res);
    return register(req, res).catch(err => sendJson(res, 400, { ok: false, message: err.message }));
  }

  if (path === '/auth/login') {
    if (req.method !== 'POST') return methodNotAllowed(res);
    return login(req, res).catch(err => sendJson(res, 400, { ok: false, message: err.message }));
  }

  if (path === '/auth/me') {
    if (req.method !== 'GET') return methodNotAllowed(res);
    return me(req, res);
  }

  if (path === '/migration/import-json') {
    if (req.method !== 'POST') return methodNotAllowed(res);
    return importJson(req, res).catch(err => sendJson(res, 500, { ok: false, message: err.message }));
  }

  if (path === '/migration/summary') {
    if (req.method !== 'GET') return methodNotAllowed(res);
    return getSummary(req, res);
  }

  if (path === '/periods/close') {
    if (req.method !== 'POST') return methodNotAllowed(res);
    return closePeriod(req, res).catch(err => sendJson(res, 400, { ok: false, message: err.message }));
  }

  if (path === '/periods/reopen') {
    if (req.method !== 'POST') return methodNotAllowed(res);
    return reopenPeriod(req, res).catch(err => sendJson(res, 400, { ok: false, message: err.message }));
  }

  if (path === '/periods') {
    if (req.method !== 'GET') return methodNotAllowed(res);
    return listPeriods(req, res);
  }

  if (path === '/movements') {
    if (req.method === 'GET') return listMovements(req, res);
    if (req.method === 'POST') {
      return createMovement(req, res).catch(err => sendJson(res, 400, { ok: false, message: err.message }));
    }
    return methodNotAllowed(res);
  }

  if (path === '/products') {
    if (req.method === 'GET') return listProducts(req, res);
    if (req.method === 'POST') {
      return createProduct(req, res).catch(err => sendJson(res, 400, { ok: false, message: err.message }));
    }
    return methodNotAllowed(res);
  }

  return notFound(res);
}

module.exports = { route };
