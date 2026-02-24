#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const reconciliation = read('apps/api/src/modules/reconciliation.js');
const routes = read('apps/api/src/routes.js');
const web = read('apps/web/index.html');
const plan = read('docs/PLAN_METAS_REEMPLAZO_CONTADOR_EIRL.md');

const checks = [
  check('Reglas automáticas de cruce ventas/RCV/bancos/inventario', /getCrossValidationReport/.test(reconciliation) && /ventas_vs_rcv/.test(reconciliation) && /ventas_vs_bancos/.test(reconciliation) && /ventas_vs_inventario/.test(reconciliation)),
  check('Matriz de severidad y SLA de corrección', /severityMatrix/.test(reconciliation) && /slaHours/.test(reconciliation) && /owner/.test(reconciliation)),
  check('Reporte diario de brechas con responsables', /reconciliation\.cross_check\.daily/.test(reconciliation) && /owners/.test(reconciliation) && /criticalOpenOver48h/.test(reconciliation)),
  check('Endpoint y UI de reporte diario A7', /\/reconciliation\/cross-check/.test(routes) && /loadA7CrossCheck\(\)/.test(web) && /Meta A7/.test(web)),
  check('Plan documental contiene Meta A7', /Meta A7/.test(plan) && /Validación cruzada tributaria-contable/.test(plan))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaA7GateReached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaA7GateReached) process.exitCode = 2;
