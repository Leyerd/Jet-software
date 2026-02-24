#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const tax = read('apps/api/src/modules/tax.js');
const regression = read('apps/api/scripts/tax-regression.js');
const ci = read('apps/api/scripts/ci-check.js');

const checks = [
  check('RLI y crédito fiscal consideran campo accepted para excluir rechazados', /isAcceptedForTax/.test(tax) && /filter\(isAcceptedForTax\)/.test(tax) && /isAcceptedForTax\(m\)/.test(tax)),
  check('Existe suite tributaria determinística con casos base y pérdida', /base-accepted-rejected/.test(regression) && /loss-floor-at-zero/.test(regression)),
  check('Suite valida montos esperados de F29/F22 con aserciones estrictas', /assertEqual\('F29 total a pagar'/.test(regression) && /assertEqual\('F22 14D3 IDPC'/.test(regression)),
  check('CI ejecuta regresión tributaria determinística', /node scripts\/tax-regression\.js/.test(ci))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaB4Reached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaB4Reached) process.exitCode = 2;
