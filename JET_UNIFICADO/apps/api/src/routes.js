const url = require('url');
const { sendJson, notFound, methodNotAllowed } = require('./lib/http');
const { register, login, me } = require('./modules/auth');
const { importJson, getSummary } = require('./modules/migration');
const { closePeriod, reopenPeriod, listPeriods } = require('./modules/accountingClose');
const { createMovement, listMovements } = require('./modules/movements');
const { createProduct, listProducts } = require('./modules/products');
const { coherenceCheck } = require('./modules/system');
const { dbStatus } = require('./modules/db');
const { getProjection } = require('./modules/finance');
const { getInventoryOverview, importLot, consumeStock, getKardex } = require('./modules/inventory');
const {
  getReconciliationSummary,
  importCartola,
  importRCVVentas,
  importMarketplaceOrders
} = require('./modules/reconciliation');
const { getTaxConfig, updateTaxConfig, getTaxSummary } = require('./modules/tax');
const {
  updateIntegrationConfig,
  getIntegrationsStatus,
  importAlibabaCatalog,
  importMercadoLibre,
  importSii
} = require('./modules/integrations');

const modulesList = [
  'arquitectura-unificada',
  'auth-roles-basico',
  'migracion-datos',
  'cierre-contable-con-permisos',
  'movimientos-con-bloqueo-periodo',
  'productos-base',
  'auditoria-eventos',
  'coherence-check',
  'postgres-runtime-ready-3.1',
  'finance-projections-sprint4',
  'inventory-overview-sprint5',
  'reconciliation-summary-sprint5',
  'reconciliation-imports-cartola-rcv-marketplace',
  'tax-engine-sprint6-default-14d8',
  'inventory-kardex-fifo-sprint7',
  'external-connectors-sprint8'
];

function handle(promiseLike, res, status = 400) {
  return Promise.resolve(promiseLike).catch(err => sendJson(res, status, { ok: false, message: err.message }));
}

function route(req, res) {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;

  if (req.method === 'GET' && path === '/health') {
    return sendJson(res, 200, { ok: true, service: 'jet-api', sprint: '8', version: 'v1.8-sprint8' });
  }

  if (req.method === 'GET' && path === '/modules') {
    return sendJson(res, 200, { ok: true, modules: modulesList });
  }

  if (req.method === 'GET' && path === '/system/coherence-check') return handle(coherenceCheck(req, res), res);
  if (req.method === 'GET' && path === '/db/status') return handle(dbStatus(req, res), res);
  if (req.method === 'GET' && path === '/finance/projection') return handle(getProjection(req, res), res);
  if (req.method === 'GET' && path === '/inventory/overview') return handle(getInventoryOverview(req, res), res);
  if (req.method === 'GET' && path === '/inventory/kardex') return handle(getKardex(req, res), res);
  if (path === '/inventory/import-lot') return req.method === 'POST' ? handle(importLot(req, res), res) : methodNotAllowed(res);
  if (path === '/inventory/consume') return req.method === 'POST' ? handle(consumeStock(req, res), res) : methodNotAllowed(res);

  if (req.method === 'GET' && path === '/reconciliation/summary') return handle(getReconciliationSummary(req, res), res);
  if (path === '/reconciliation/import/cartola') return req.method === 'POST' ? handle(importCartola(req, res), res) : methodNotAllowed(res);
  if (path === '/reconciliation/import/rcv-ventas') return req.method === 'POST' ? handle(importRCVVentas(req, res), res) : methodNotAllowed(res);
  if (path === '/reconciliation/import/marketplace') return req.method === 'POST' ? handle(importMarketplaceOrders(req, res), res) : methodNotAllowed(res);

  if (path === '/tax/config') {
    if (req.method === 'GET') return handle(getTaxConfig(req, res), res);
    if (req.method === 'POST') return handle(updateTaxConfig(req, res), res);
    return methodNotAllowed(res);
  }
  if (path === '/tax/summary' && req.method === 'GET') return handle(getTaxSummary(req, res), res);


  if (path === '/integrations/config') return req.method === 'POST' ? handle(updateIntegrationConfig(req, res), res) : methodNotAllowed(res);
  if (path === '/integrations/status' && req.method === 'GET') return handle(getIntegrationsStatus(req, res), res);
  if (path === '/integrations/alibaba/import-products') return req.method === 'POST' ? handle(importAlibabaCatalog(req, res), res) : methodNotAllowed(res);
  if (path === '/integrations/mercadolibre/import-orders') return req.method === 'POST' ? handle(importMercadoLibre(req, res), res) : methodNotAllowed(res);
  if (path === '/integrations/sii/import-rcv') return req.method === 'POST' ? handle(importSii(req, res), res) : methodNotAllowed(res);

  if (path === '/auth/register') return req.method === 'POST' ? handle(register(req, res), res) : methodNotAllowed(res);
  if (path === '/auth/login') return req.method === 'POST' ? handle(login(req, res), res) : methodNotAllowed(res);
  if (path === '/auth/me') return req.method === 'GET' ? handle(me(req, res), res) : methodNotAllowed(res);

  if (path === '/migration/import-json') return req.method === 'POST' ? handle(importJson(req, res), res, 500) : methodNotAllowed(res);
  if (path === '/migration/summary') return req.method === 'GET' ? handle(getSummary(req, res), res) : methodNotAllowed(res);

  if (path === '/periods/close') return req.method === 'POST' ? handle(closePeriod(req, res), res) : methodNotAllowed(res);
  if (path === '/periods/reopen') return req.method === 'POST' ? handle(reopenPeriod(req, res), res) : methodNotAllowed(res);
  if (path === '/periods') return req.method === 'GET' ? handle(listPeriods(req, res), res) : methodNotAllowed(res);

  if (path === '/movements') {
    if (req.method === 'GET') return handle(listMovements(req, res), res);
    if (req.method === 'POST') return handle(createMovement(req, res), res);
    return methodNotAllowed(res);
  }

  if (path === '/products') {
    if (req.method === 'GET') return handle(listProducts(req, res), res);
    if (req.method === 'POST') return handle(createProduct(req, res), res);
    return methodNotAllowed(res);
  }

  return notFound(res);
}

module.exports = { route };
