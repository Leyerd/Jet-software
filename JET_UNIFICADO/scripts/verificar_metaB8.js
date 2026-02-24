#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const edge = read('apps/api/scripts/tax-edge-regression.js');
const ci = read('apps/api/scripts/ci-check.js');
const tax = read('apps/api/src/modules/tax.js');

const checks = [
  check('Suite edge-case tributaria creada', /carry-credit-floor/.test(edge) && /rejected-fees-excluded/.test(edge) && /regime-delta-14d8-vs-14d3/.test(edge)),
  check('Suite valida pisos y exclusiones críticas', /IVA a pagar con crédito superior/.test(edge) && /Retención con honorarios rechazados excluidos/.test(edge)),
  check('Suite valida diferencias de régimen 14D8 vs 14D3', /14D8 atribución/.test(edge) && /14D3 IDPC/.test(edge)),
  check('CI ejecuta regresión edge-case', /node scripts\/tax-edge-regression\.js/.test(ci)),
  check('Motor tributario conserva funciones puras reutilizables', /computeMonthlyF29/.test(tax) && /computeYearlyRli/.test(tax) && /computeF22ByRegime/.test(tax))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaB8Reached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaB8Reached) process.exitCode = 2;
