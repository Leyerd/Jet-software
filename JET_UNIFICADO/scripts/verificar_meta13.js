#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const compliance = read('apps/api/src/modules/compliance.js');
const routes = read('apps/api/src/routes.js');

const checks = [
  check('Motor de calendario legal por obligación', /buildPeriodObligations/.test(compliance) && /adjustBusinessDay/.test(compliance)),
  check('Semáforo tributario diario', /riskStatus/.test(compliance) && /getSemaphore/.test(compliance)),
  check('Evidencia automática por obligación (preparado\/validado\/enviado\/acuse)', /registerEvidence/.test(compliance) && /preparado/.test(compliance) && /acuse/.test(compliance)),
  check('Alertas escaladas por proximidad\/vencimiento', /buildEscalations/.test(compliance) && /critical/.test(compliance)),
  check('Endpoints Meta13 expuestos', /\/compliance\/calendar/.test(routes) && /\/compliance\/semaphore/.test(routes) && /\/compliance\/evidence/.test(routes))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter(c => c.ok).length,
    total: checks.length,
    meta13GateReached: checks.every(c => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.meta13GateReached) process.exitCode = 2;
