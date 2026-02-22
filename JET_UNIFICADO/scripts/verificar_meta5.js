#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const tax = read('apps/api/src/modules/tax.js');
const routes = read('apps/api/src/routes.js');

const checks = [
  check('Catálogo normativo versionado por año + régimen (14D8/14D3)', /NORMATIVE_CATALOG/.test(tax) && /2026/.test(tax) && /'14D8'/.test(tax) && /'14D3'/.test(tax)),
  check('Endpoint de catálogo tributario disponible por API', /getTaxCatalog/.test(tax) && /\/tax\/catalog/.test(routes)),
  check('Motor F29 con casillas y reglas explícitas', /computeMonthlyF29/.test(tax) && /casilla_538/.test(tax) && /rulesApplied: catalog\.rules\.f29/.test(tax)),
  check('Motor F22 + RLI + base DDJJ', /computeYearlyRli/.test(tax) && /computeF22ByRegime/.test(tax) && /ddjjBase/.test(tax)),
  check('Gate Meta5: trazabilidad por cálculo (regla, versión y fuente)', /trace:\s*\{[\s\S]*rulesApplied/.test(tax) && /version:\s*catalog\.version/.test(tax) && /source:\s*catalog\.source/.test(tax))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter(c => c.ok).length,
    total: checks.length,
    meta5GateReached: checks.every(c => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.meta5GateReached) process.exitCode = 2;
