#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const tax = read('apps/api/src/modules/tax.js');
const routes = read('apps/api/src/routes.js');

const checks = [
  check('Endpoint de explicabilidad tributaria expuesto', /\/tax\/explainability/.test(routes) && /getTaxExplainability/.test(routes)),
  check('Respuesta incluye casillas F29 explicadas con fórmula y evidencia', /casilla_538_debitoFiscal/.test(tax) && /formula: 'SUM\(iva\) para VENTA'/.test(tax) && /evidenceCount/.test(tax)),
  check('Respuesta incluye trazabilidad normativa y reglas aplicadas', /normativeVersion/.test(tax) && /normativeSource/.test(tax) && /rules: \{\n\s+f29: catalog\.rules\.f29/.test(tax)),
  check('Auditoría para generación de reporte explicativo', /tax\.explainability\.generated/.test(tax))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaB6Reached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaB6Reached) process.exitCode = 2;
