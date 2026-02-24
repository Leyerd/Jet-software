#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const web = read('apps/web/index.html');
const routes = read('apps/api/src/routes.js');
const tax = read('apps/api/src/modules/tax.js');

const checks = [
  check('API tributaria disponible para frontend', /\/tax\/summary/.test(routes) && /getTaxSummary/.test(tax)),
  check('Frontend F29\/F22 consume /tax/summary', /getTaxSummaryFromApi\(year, month\)/.test(web) && /getTaxSummaryFromApi\(year, selectedMonth\)/.test(web)),
  check('Frontend impuesto dueño usa base del API tributario', /computeOwnerAnnualTax\(yearMovs, taxSummary\)/.test(web) && /f22\?\.rli\?\.components\?\.rli/.test(web)),
  check('Cache tributaria invalidada en save para evitar resultados stale', /taxSummaryCache\?\.clear/.test(web))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaB1Reached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaB1Reached) process.exitCode = 2;
