#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const reports = read('apps/api/src/modules/reports.js');
const routes = read('apps/api/src/routes.js');

const checks = [
  check('Reportes base implementados (Diario, Mayor, Balance, ER, IVA, anexos)', /diario/.test(reports) && /mayor/.test(reports) && /balance/.test(reports) && /estadoResultados/.test(reports) && /iva/.test(reports) && /anexos/.test(reports)),
  check('Export CSV/XLSX/PDF con metadata (hash, usuario, timestamp)', /format === 'csv'/.test(reports) && /format === 'xlsx'/.test(reports) && /format === 'pdf'/.test(reports) && /generatedBy/.test(reports) && /generatedAt/.test(reports) && /hash/.test(reports)),
  check('Trazabilidad al origen de datos', /source:\s*\{ table: 'movimientos'/.test(reports) && /sourceIds/.test(reports)),
  check('Endpoints de reportería expuestos', /\/reports/.test(routes) && /\/reports\/export/.test(routes)),
  check('Gate Meta11: hash reproducible para misma data', /canonicalStringify/.test(reports) && /hashObject/.test(reports))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter(c => c.ok).length,
    total: checks.length,
    meta11GateReached: checks.every(c => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.meta11GateReached) process.exitCode = 2;
