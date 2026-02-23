#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const gov = read('apps/api/src/modules/accountingGovernance.js');
const close = read('apps/api/src/modules/accountingClose.js');
const routes = read('apps/api/src/routes.js');
const web = read('apps/web/index.html');

const checks = [
  check('Plan de cuentas parametrizable implementado', /chartOfAccounts/.test(gov) && /updateChart/.test(gov)),
  check('Reglas contables por operación implementadas', /accountingRules/.test(gov) && /updateRules/.test(gov)),
  check('Validadores de consistencia cruzada implementados', /consistencyCheck/.test(gov) && /ventas-vs-rcv/.test(gov)),
  check('Flujo de aprobación dual para acciones críticas', /createApprovalRequest/.test(gov) && /approveRequest/.test(gov) && /assertApprovedRequest/.test(close)),
  check('Endpoints Meta14 expuestos + UI visible', /\/accounting\/chart/.test(routes) && /\/accounting\/consistency-check/.test(routes) && /tab-gobernanza/.test(web))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter(c => c.ok).length,
    total: checks.length,
    meta14GateReached: checks.every(c => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.meta14GateReached) process.exitCode = 2;
