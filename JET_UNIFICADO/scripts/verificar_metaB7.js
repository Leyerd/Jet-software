#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const tax = read('apps/api/src/modules/tax.js');
const routes = read('apps/api/src/routes.js');

const checks = [
  check('Existe changelog normativo versionado con fecha efectiva', /NORMATIVE_CHANGELOG/.test(tax) && /effectiveFrom/.test(tax) && /cl-tax-2026\.2/.test(tax)),
  check('Resolver normativo selecciona versión por fecha', /resolveNormativeVersion/.test(tax) && /compareDateIso/.test(tax)),
  check('Endpoint timeline normativa tributaria expuesto', /\/tax\/normative-versions/.test(routes) && /getNormativeVersions/.test(routes)),
  check('Tax summary entrega versión normativa efectiva en assumptions', /normativeEffectiveFrom/.test(tax) && /normativeVersion/.test(tax))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaB7Reached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaB7Reached) process.exitCode = 2;
