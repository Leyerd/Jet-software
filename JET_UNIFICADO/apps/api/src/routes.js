const url = require('url');
const { sendJson, notFound, methodNotAllowed } = require('./lib/http');
const { register, login, me, logout, revokeSession, mfaSetup, mfaEnable, mfaDisable } = require('./modules/auth');
const { importJson, getSummary, syncFrontendMovements } = require('./modules/migration');
const { closePeriod, reopenPeriod, listPeriods, getCloseChecklist } = require('./modules/accountingClose');
const { createMovement, listMovements } = require('./modules/movements');
const { createProduct, listProducts } = require('./modules/products');
const { coherenceCheck, getFrontendState, getDemoBackup, loadDemoData, shutdownSystem } = require('./modules/system');
const { dbStatus } = require('./modules/db');
const { getProjection } = require('./modules/finance');
const { getInventoryOverview, importLot, consumeStock, getKardex } = require('./modules/inventory');
const {
  getReconciliationSummary,
  getCrossValidationReport,
  getTaxAccountingReconciliation,
  importCartola,
  importRCVVentas,
  importMarketplaceOrders,
  listReconciliationDocuments,
  updateReconciliationStatus
} = require('./modules/reconciliation');
const { getTaxConfig, updateTaxConfig, getTaxSummary, getTaxCatalog, getTaxExplainability, getNormativeVersions } = require('./modules/tax');
const {
  updateIntegrationConfig,
  getIntegrationsStatus,
  importAlibabaCatalog,
  importMercadoLibre,
  importSii,
  runScheduledSync,
  listDeadLetter,
  updateRecurringAutomation,
  runRecurringAutomations
} = require('./modules/integrations');
const {
  getBackupPolicy,
  updateBackupPolicy,
  createBackup,
  listBackups,
  restoreBackup,
  validateRestore
} = require('./modules/backup');
const { createEntry, publishEntry, reverseEntry, listEntries } = require('./modules/journal');
const { getReports, exportReport } = require('./modules/reports');
const { getDashboard } = require('./modules/observability');
const { getCalendar, getSemaphore, getComplianceChecklist, getComplianceBlockers, registerEvidence, updateComplianceConfig } = require('./modules/compliance');
const { getChart, updateChart, getRules, updateRules, runConsistencyCheck, createApprovalRequest, approveRequest } = require('./modules/accountingGovernance');
const { getAuditPackage, getRiskSimulation, getExecutiveDashboard, getFiscalProposal, getAccountantReplacementPilot, getOperationAutonomyCertification } = require('./modules/eirlExecutive');
const { listChanges, registerChange, runRegression } = require('./modules/normativeGovernance');
const { getGuidedFlow, completeGuidedStep, getRunbooks } = require('./modules/operationsGuided');

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
  'external-connectors-sprint8',
  'auth-roles-backup-policies-sprint9',
  'quality-ci-cd-sprint10',
  'meta1-postgres-normalized-runtime-auth-products-movements-periods-tax',
  'journal-double-entry-publish-validation',
  'journal-auto-posting-reverse',
  'tax-engine-versioned-f29-f22-rli-traceability',
  'reconciliation-immutable-incremental-batches-status',
  'enterprise-security-bcrypt-rate-limit-lockout-mfa-session-rotation',
  'encrypted-backups-dr-validation-rpo-rto',
  'secure-connectors-scheduler-retry-deadletter-status',
  'frontend-backend-first-api-client-unified',
  'auditable-exportable-reporting-reproducible-hash',
  'observability-logs-metrics-alerts-dashboard',
  'compliance-calendar-semaphore-evidence-escalation',
  'governance-chart-rules-consistency-dual-approval',
  'meta15-audit-package-risk-simulator-executive-dashboard',
  'meta16-normative-governance-regression',
  'metaA8-guided-operations-blocking-checklists-runbooks',
  'metaA9-pilot-3-closing-cycles',
  'metaA10-internal-certification-autonomous-operation',
  'metaB5-tax-ledger-auto-reconciliation',
  'metaB6-tax-explainability-audit',
  'metaB7-normative-version-timeline'
];

function handle(promiseLike, res, status = 400) {
  return Promise.resolve(promiseLike).catch(err => sendJson(res, status, { ok: false, message: err.message }));
}

function route(req, res) {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;

  if (req.method === 'GET' && path === '/health') {
    return sendJson(res, 200, { ok: true, service: 'jet-api', sprint: '16', version: 'v1.16-sprint16' });
  }

  if (req.method === 'GET' && path === '/modules') {
    return sendJson(res, 200, { ok: true, modules: modulesList });
  }

  if (req.method === 'GET' && path === '/system/coherence-check') return handle(coherenceCheck(req, res), res);
  if (req.method === 'GET' && path === '/system/frontend-state') return handle(getFrontendState(req, res), res);
  if (req.method === 'POST' && path === '/system/shutdown') return handle(shutdownSystem(req, res), res);
  if (req.method === 'GET' && path === '/system/demo-backup') return handle(getDemoBackup(req, res), res);
  if (path === '/system/load-demo-data') {
    if (req.method === 'POST' || req.method === 'GET') return handle(loadDemoData(req, res), res);
    return methodNotAllowed(res);
  }
  if (path === '/system/demo/load') {
    if (req.method === 'POST' || req.method === 'GET') return handle(loadDemoData(req, res), res);
    return methodNotAllowed(res);
  }
  if (req.method === 'GET' && path === '/db/status') return handle(dbStatus(req, res), res);
  if (req.method === 'GET' && path === '/finance/projection') return handle(getProjection(req, res), res);
  if (req.method === 'GET' && path === '/inventory/overview') return handle(getInventoryOverview(req, res), res);
  if (req.method === 'GET' && path === '/inventory/kardex') return handle(getKardex(req, res), res);
  if (path === '/inventory/import-lot') return req.method === 'POST' ? handle(importLot(req, res), res) : methodNotAllowed(res);
  if (path === '/inventory/consume') return req.method === 'POST' ? handle(consumeStock(req, res), res) : methodNotAllowed(res);

  if (req.method === 'GET' && path === '/reconciliation/summary') return handle(getReconciliationSummary(req, res), res);
  if (req.method === 'GET' && path === '/reconciliation/cross-check') return handle(getCrossValidationReport(req, res), res);
  if (req.method === 'GET' && path === '/reconciliation/tax-ledger') return handle(getTaxAccountingReconciliation(req, res), res);
  if (req.method === 'GET' && path === '/reconciliation/documents') return handle(listReconciliationDocuments(req, res), res);
  if (path === '/reconciliation/import/cartola') return req.method === 'POST' ? handle(importCartola(req, res), res) : methodNotAllowed(res);
  if (path === '/reconciliation/import/rcv-ventas') return req.method === 'POST' ? handle(importRCVVentas(req, res), res) : methodNotAllowed(res);
  if (path === '/reconciliation/import/marketplace') return req.method === 'POST' ? handle(importMarketplaceOrders(req, res), res) : methodNotAllowed(res);
  if (path === '/reconciliation/documents/status') return req.method === 'POST' ? handle(updateReconciliationStatus(req, res), res) : methodNotAllowed(res);

  if (path === '/tax/config') {
    if (req.method === 'GET') return handle(getTaxConfig(req, res), res);
    if (req.method === 'POST') return handle(updateTaxConfig(req, res), res);
    return methodNotAllowed(res);
  }
  if (path === '/tax/catalog' && req.method === 'GET') return handle(getTaxCatalog(req, res), res);
  if (path === '/tax/summary' && req.method === 'GET') return handle(getTaxSummary(req, res), res);
  if (path === '/tax/explainability' && req.method === 'GET') return handle(getTaxExplainability(req, res), res);
  if (path === '/tax/normative-versions' && req.method === 'GET') return handle(getNormativeVersions(req, res), res);


  if (path === '/integrations/config') return req.method === 'POST' ? handle(updateIntegrationConfig(req, res), res) : methodNotAllowed(res);
  if (path === '/integrations/status' && req.method === 'GET') return handle(getIntegrationsStatus(req, res), res);
  if (path === '/integrations/alibaba/import-products') return req.method === 'POST' ? handle(importAlibabaCatalog(req, res), res) : methodNotAllowed(res);
  if (path === '/integrations/mercadolibre/import-orders') return req.method === 'POST' ? handle(importMercadoLibre(req, res), res) : methodNotAllowed(res);
  if (path === '/integrations/sii/import-rcv') return req.method === 'POST' ? handle(importSii(req, res), res) : methodNotAllowed(res);
  if (path === '/integrations/sync/run') return req.method === 'POST' ? handle(runScheduledSync(req, res), res) : methodNotAllowed(res);
  if (path === '/integrations/dead-letter' && req.method === 'GET') return handle(listDeadLetter(req, res), res);
  if (path === '/integrations/recurring/config' && req.method === 'POST') return handle(updateRecurringAutomation(req, res), res);
  if (path === '/integrations/recurring/run' && req.method === 'POST') return handle(runRecurringAutomations(req, res), res);


  if (path === '/backup/policy') {
    if (req.method === 'GET') return handle(getBackupPolicy(req, res), res);
    if (req.method === 'POST') return handle(updateBackupPolicy(req, res), res);
    return methodNotAllowed(res);
  }
  if (path === '/backup/create') return req.method === 'POST' ? handle(createBackup(req, res), res) : methodNotAllowed(res);
  if (path === '/backup/list' && req.method === 'GET') return handle(listBackups(req, res), res);
  if (path === '/backup/restore') return req.method === 'POST' ? handle(restoreBackup(req, res), res) : methodNotAllowed(res);
  if (path === '/backup/validate-restore') return req.method === 'POST' ? handle(validateRestore(req, res), res) : methodNotAllowed(res);

  if (path === '/auth/register') return req.method === 'POST' ? handle(register(req, res), res) : methodNotAllowed(res);
  if (path === '/auth/login') return req.method === 'POST' ? handle(login(req, res), res) : methodNotAllowed(res);
  if (path === '/auth/me') return req.method === 'GET' ? handle(me(req, res), res) : methodNotAllowed(res);
  if (path === '/auth/logout') return req.method === 'POST' ? handle(logout(req, res), res) : methodNotAllowed(res);

  if (path === '/auth/revoke-session') return req.method === 'POST' ? handle(revokeSession(req, res), res) : methodNotAllowed(res);
  if (path === '/auth/mfa/setup') return req.method === 'POST' ? handle(mfaSetup(req, res), res) : methodNotAllowed(res);
  if (path === '/auth/mfa/enable') return req.method === 'POST' ? handle(mfaEnable(req, res), res) : methodNotAllowed(res);
  if (path === '/auth/mfa/disable') return req.method === 'POST' ? handle(mfaDisable(req, res), res) : methodNotAllowed(res);

  if (path === '/migration/import-json') return req.method === 'POST' ? handle(importJson(req, res), res, 500) : methodNotAllowed(res);
  if (path === '/migration/summary') return req.method === 'GET' ? handle(getSummary(req, res), res) : methodNotAllowed(res);
  if (path === '/migration/sync-frontend-movements') return req.method === 'POST' ? handle(syncFrontendMovements(req, res), res) : methodNotAllowed(res);

  if (path === '/periods/close') return req.method === 'POST' ? handle(closePeriod(req, res), res) : methodNotAllowed(res);
  if (path === '/periods/reopen') return req.method === 'POST' ? handle(reopenPeriod(req, res), res) : methodNotAllowed(res);
  if (path === '/periods') return req.method === 'GET' ? handle(listPeriods(req, res), res) : methodNotAllowed(res);
  if (path === '/periods/close-checklist') return req.method === 'GET' ? handle(getCloseChecklist(req, res), res) : methodNotAllowed(res);

  if (path === '/movements') {
    if (req.method === 'GET') return handle(listMovements(req, res), res);
    if (req.method === 'POST') return handle(createMovement(req, res), res);
    return methodNotAllowed(res);
  }

  if (path === '/accounting/entries') {
    if (req.method === 'GET') return handle(listEntries(req, res), res);
    if (req.method === 'POST') return handle(createEntry(req, res), res);
    return methodNotAllowed(res);
  }
  if (path === '/accounting/entries/publish') return req.method === 'POST' ? handle(publishEntry(req, res), res) : methodNotAllowed(res);
  if (path === '/accounting/entries/reverse') return req.method === 'POST' ? handle(reverseEntry(req, res), res) : methodNotAllowed(res);

  if (path === '/observability/dashboard' && req.method === 'GET') return handle(getDashboard(req, res), res);

  if (path === '/accounting/chart') {
    if (req.method === 'GET') return handle(getChart(req, res), res);
    if (req.method === 'POST') return handle(updateChart(req, res), res);
    return methodNotAllowed(res);
  }
  if (path === '/accounting/rules') {
    if (req.method === 'GET') return handle(getRules(req, res), res);
    if (req.method === 'POST') return handle(updateRules(req, res), res);
    return methodNotAllowed(res);
  }
  if (path === '/accounting/consistency-check' && req.method === 'GET') return handle(runConsistencyCheck(req, res), res);
  if (path === '/accounting/approval/request' && req.method === 'POST') return handle(createApprovalRequest(req, res), res);
  if (path === '/accounting/approval/approve' && req.method === 'POST') return handle(approveRequest(req, res), res);

  if (path === '/compliance/calendar' && req.method === 'GET') return handle(getCalendar(req, res), res);
  if (path === '/compliance/semaphore' && req.method === 'GET') return handle(getSemaphore(req, res), res);
  if (path === '/compliance/checklist' && req.method === 'GET') return handle(getComplianceChecklist(req, res), res);
  if (path === '/compliance/blockers' && req.method === 'GET') return handle(getComplianceBlockers(req, res), res);
  if (path === '/compliance/evidence') return req.method === 'POST' ? handle(registerEvidence(req, res), res) : methodNotAllowed(res);
  if (path === '/compliance/config') return req.method === 'POST' ? handle(updateComplianceConfig(req, res), res) : methodNotAllowed(res);

  if (path === '/executive/audit-package' && req.method === 'GET') return handle(getAuditPackage(req, res), res);
  if (path === '/executive/risk-simulation' && req.method === 'GET') return handle(getRiskSimulation(req, res), res);
  if (path === '/executive/dashboard' && req.method === 'GET') return handle(getExecutiveDashboard(req, res), res);
  if (path === '/executive/fiscal-proposal' && req.method === 'GET') return handle(getFiscalProposal(req, res), res);
  if (path === '/executive/accountant-replacement-pilot' && req.method === 'GET') return handle(getAccountantReplacementPilot(req, res), res);
  if (path === '/executive/operation-autonomy-certification' && req.method === 'GET') return handle(getOperationAutonomyCertification(req, res), res);


  if (path === '/operations/guided-flow' && req.method === 'GET') return handle(getGuidedFlow(req, res), res);
  if (path === '/operations/guided-flow/complete-step') return req.method === 'POST' ? handle(completeGuidedStep(req, res), res) : methodNotAllowed(res);
  if (path === '/operations/runbooks' && req.method === 'GET') return handle(getRunbooks(req, res), res);

  if (path === '/normative/changes') {
    if (req.method === 'GET') return handle(listChanges(req, res), res);
    if (req.method === 'POST') return handle(registerChange(req, res), res);
    return methodNotAllowed(res);
  }
  if (path === '/normative/regression/run' && req.method === 'POST') return handle(runRegression(req, res), res);

  if (path === '/reports' && req.method === 'GET') return handle(getReports(req, res), res);
  if (path === '/reports/export' && req.method === 'GET') return handle(exportReport(req, res), res);

  if (path === '/products') {
    if (req.method === 'GET') return handle(listProducts(req, res), res);
    if (req.method === 'POST') return handle(createProduct(req, res), res);
    return methodNotAllowed(res);
  }

  return notFound(res);
}

module.exports = { route };
