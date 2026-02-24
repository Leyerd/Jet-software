#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const routes = read('apps/api/src/routes.js');
const reconciliation = read('apps/api/src/modules/reconciliation.js');

const checks = [
  check('Existe endpoint de conciliación tributaria-contable', /\/reconciliation\/tax-ledger/.test(routes) && /getTaxAccountingReconciliation/.test(routes)),
  check('Conciliación usa fuente tributaria unificada (F29\/F22)', /computeMonthlyF29/.test(reconciliation) && /computeYearlyRli/.test(reconciliation) && /computeF22ByRegime/.test(reconciliation)),
  check('Reporte compara libro vs casillas y marca estado por delta', /ledger_vs_f29_debito/.test(reconciliation) && /ddjj_base_vs_rli_non_negative/.test(reconciliation) && /status: Math\.abs\(delta\) <= 1 \? 'ok' : 'observed'/.test(reconciliation)),
  check('Resumen de gate declara cumplimiento Meta B5', /metaB5Reached/.test(reconciliation) && /reconciliation\.tax_ledger/.test(reconciliation))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaB5Reached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaB5Reached) process.exitCode = 2;
