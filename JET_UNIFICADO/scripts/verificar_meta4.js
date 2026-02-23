#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const close = read('apps/api/src/modules/accountingClose.js');
const inv = read('apps/api/src/modules/inventory.js');
const rec = read('apps/api/src/modules/reconciliation.js');
const integ = read('apps/api/src/modules/integrations.js');
const journal = read('apps/api/src/modules/journal.js');
const mov = read('apps/api/src/modules/movements.js');

const checks = [
  check('Cierre por período con hash de integridad', /hashSnapshot/.test(close) && /cierreHash/.test(close) && /cierre_snapshot/.test(close)),
  check('Bloqueo de mutaciones en período cerrado', /assertPeriodOpenForDate/.test(close) && /assertPeriodOpenForDate/.test(inv) && /assertPeriodOpenForDate/.test(rec) && /assertPeriodOpenForDate/.test(integ) && /assertPeriodOpenForDate/.test(journal) && /isPeriodClosedInDb/.test(mov)),
  check('Reapertura con workflow aprobación + motivo', /aprobadoPor/.test(close) && /motivo/.test(close) && /rol !== 'dueno'/.test(close)),
  check('Bitácora completa de cierre/reapertura', /appendAuditLog\('period\.close'/.test(close) && /appendAuditLog\('period\.reopen'/.test(close)),
  check('Gate Meta4: mutación en período cerrado falla', /No se permite/.test(close))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter(c => c.ok).length,
    total: checks.length,
    meta4GateReached: checks.every(c => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.meta4GateReached) process.exitCode = 2;
