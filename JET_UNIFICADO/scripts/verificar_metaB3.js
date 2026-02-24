#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const tax = read('apps/api/src/modules/tax.js');

const checks = [
  check('Tax summary postgres agrega columnas tributarias faltantes', /ADD COLUMN IF NOT EXISTS retention/.test(tax) && /ADD COLUMN IF NOT EXISTS costo_mercaderia/.test(tax) && /ADD COLUMN IF NOT EXISTS accepted/.test(tax)),
  check('SELECT postgres para tax summary trae campos completos', /COALESCE\(retention, 0\) AS retention/.test(tax) && /COALESCE\(comision, 0\) AS comision/.test(tax) && /COALESCE\(costo_mercaderia, 0\) AS "costoMercaderia"/.test(tax)),
  check('SELECT postgres preserva bandera de aceptacion y referencia documental', /COALESCE\(accepted, TRUE\) AS accepted/.test(tax) && /document_ref AS "documentRef"/.test(tax)),
  check('Tax summary mantiene cálculo unificado en misma función', /const f29 = computeMonthlyF29/.test(tax) && /const rli = computeYearlyRli/.test(tax))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaB3Reached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaB3Reached) process.exitCode = 2;
