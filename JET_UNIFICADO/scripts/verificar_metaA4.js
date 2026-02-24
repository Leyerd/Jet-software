#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const execModule = read('apps/api/src/modules/eirlExecutive.js');
const web = read('apps/web/index.html');
const plan = read('docs/PLAN_METAS_REEMPLAZO_CONTADOR_EIRL.md');

const checks = [
  check('Reportes ejecutivos con lenguaje no técnico', /ownerSummary/.test(execModule) && /cashStatus/.test(execModule) && /taxStatus/.test(execModule) && /businessStatus/.test(execModule)),
  check('Tablero de riesgo fiscal y salud de caja', /totalExpectedRisk/.test(execModule) && /cash/.test(execModule) && /exec-cards/.test(web)),
  check('Panel “qué hacer hoy” con prioridades', /todayPriorities/.test(execModule) && /Qué hacer hoy/.test(web) && /exec-today/.test(web)),
  check('Plan documental contiene Meta A4', /Meta A4/.test(plan) && /Reportería para decisión del dueño/.test(plan))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaA4GateReached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaA4GateReached) process.exitCode = 2;
