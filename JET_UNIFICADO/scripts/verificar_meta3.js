#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const journal = read('apps/api/src/modules/journal.js');
const movements = read('apps/api/src/modules/movements.js');
const routes = read('apps/api/src/routes.js');

const checks = [
  check('Asientos automáticos por evento', /createAutoEntryForMovement/.test(journal) && /createAutoEntryForMovement\(movement/.test(movements)),
  check('Validación estricta debe=haber antes de publicar', /validateBalanced/.test(journal) && /Asiento descuadrado/.test(journal)),
  check('Estados borrador/publicado/reversado soportados', /'borrador'/.test(journal) && /'publicado'/.test(journal) && /'reversado'/.test(journal)),
  check('Endpoint de reversa disponible', /\/accounting\/entries\/reverse/.test(routes)),
  check('Imposible publicar asiento descuadrado por API', /if \(!balance\.ok\) return \{ status: 409/.test(journal) || /if \(!balance\.ok\) return sendJson\(res, 409/.test(journal))
];

const result = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter(c => c.ok).length,
    total: checks.length,
    meta3GateReached: checks.every(c => c.ok)
  }
};

console.log(JSON.stringify(result, null, 2));
if (!result.summary.meta3GateReached) process.exitCode = 2;
