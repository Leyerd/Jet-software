#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const mod = read('apps/api/src/modules/normativeGovernance.js');
const routes = read('apps/api/src/routes.js');
const web = read('apps/web/index.html');

const checks = [
  check('Registro de cambios normativos versionado', /registerChange/.test(mod) && /normativeChanges/.test(mod)),
  check('Proceso formal de revisión y policy normativa', /normativePolicy/.test(mod) && /monthlyReviewEnabled/.test(mod)),
  check('Suite/regresión normativa ejecutable', /runRegression/.test(mod) && /normativeRegressionRuns/.test(mod)),
  check('Endpoints Meta16 expuestos', /\/normative\/changes/.test(routes) && /\/normative\/regression\/run/.test(routes)),
  check('UI de gobierno normativo visible', /tab-normativa/.test(web) && /loadNormativeChanges/.test(web))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter(c => c.ok).length,
    total: checks.length,
    meta16GateReached: checks.every(c => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.meta16GateReached) process.exitCode = 2;
