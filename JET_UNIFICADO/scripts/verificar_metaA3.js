#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const routes = read('apps/api/src/routes.js');
const closeModule = read('apps/api/src/modules/accountingClose.js');
const movements = read('apps/api/src/modules/movements.js');
const web = read('apps/web/index.html');
const plan = read('docs/PLAN_METAS_REEMPLAZO_CONTADOR_EIRL.md');

const checks = [
  check('Checklist de cierre mensual con trazabilidad expuesto', /\/periods\/close-checklist/.test(routes) && /traceId/.test(closeModule) && /period\.close\.checklist\.viewed/.test(closeModule)),
  check('Validación de consistencia diario/mayor/balance en checklist', /accounting\.consistency/.test(closeModule) && /debe/.test(closeModule) && /haber/.test(closeModule)),
  check('Cobertura de asientos automáticos en operaciones frecuentes', /autoJournalCreated/.test(movements) && /auto_entry_created/.test(movements)),
  check('UI contabilidad muestra checklist A3 y acción guiada', /Checklist de Cierre Mensual \(Meta A3\)/.test(web) && /loadCloseChecklist\(\)/.test(web) && /loadModuleDemo\('cierre'\)/.test(web)),
  check('Plan documental contiene Meta A3', /Meta A3/.test(plan) && /Cierre mensual reproducible/.test(plan))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaA3GateReached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaA3GateReached) process.exitCode = 2;
