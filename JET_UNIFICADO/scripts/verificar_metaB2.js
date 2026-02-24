#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const movements = read('apps/api/src/modules/movements.js');

const checks = [
  check('createMovement captura campos tributarios críticos', /costoMercaderia/.test(movements) && /accepted/.test(movements) && /documentRef/.test(movements)),
  check('Persistencia file incluye accepted y costoMercaderia', /state\.movimientos\.push\(movement\)/.test(movements) && /costoMercaderia,\n\s+accepted,\n\s+documentRef/.test(movements)),
  check('Persistencia postgres incluye columnas tributarias', /ADD COLUMN IF NOT EXISTS costo_mercaderia/.test(movements) && /ADD COLUMN IF NOT EXISTS accepted/.test(movements) && /ADD COLUMN IF NOT EXISTS document_ref/.test(movements)),
  check('listMovements expone campos tributarios en postgres', /costo_mercaderia AS "costoMercaderia"/.test(movements) && /document_ref AS "documentRef"/.test(movements))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaB2Reached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaB2Reached) process.exitCode = 2;
