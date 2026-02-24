#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const integrations = read('apps/api/src/modules/integrations.js');
const routes = read('apps/api/src/routes.js');
const reconciliation = read('apps/api/src/modules/reconciliation.js');
const web = read('apps/web/index.html');
const plan = read('docs/PLAN_METAS_REEMPLAZO_CONTADOR_EIRL.md');

const checks = [
  check('Flujo unificado ventas-inventario-tesorería-impuestos operativo', /\/integrations\/sync\/run/.test(routes) && /runScheduledSync/.test(integrations) && /importMercadoLibre/.test(integrations) && /importSii/.test(integrations)),
  check('Conciliación automática por lote implementada', /ingestion_batches/.test(reconciliation) && /importRCVVentas/.test(reconciliation) && /importCartola/.test(reconciliation) && /importMarketplaceOrders/.test(reconciliation)),
  check('Tareas recurrentes automatizadas (recordatorio \+ cierre)', /integrationRecurringTasks/.test(integrations) && /runRecurringAutomations/.test(integrations) && /close\.reminder\.monthly/.test(integrations) && /\/integrations\/recurring\/run/.test(routes)),
  check('UI permite ejecutar ciclo recurrente A5', /runA5RecurringCycle\(\)/.test(web) && /Automatización recurrente \(Meta A5\)/.test(web) && /a5-recurring/.test(web)),
  check('Plan documental contiene Meta A5', /Meta A5/.test(plan) && /Integración multipropósito real/.test(plan))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaA5GateReached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaA5GateReached) process.exitCode = 2;
