#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const guided = read('apps/api/src/modules/operationsGuided.js');
const routes = read('apps/api/src/routes.js');
const web = read('apps/web/index.html');
const plan = read('docs/PLAN_METAS_REEMPLAZO_CONTADOR_EIRL.md');

const checks = [
  check('Asistentes paso a paso para tareas críticas (cierre, F29, F22, DDJJ)', /CRITICAL_TASKS/.test(guided) && /cierre/.test(guided) && /f29/.test(guided) && /f22/.test(guided) && /ddjj/.test(guided)),
  check('Checklists bloqueantes con confirmación de evidencia', /Paso bloqueado/.test(guided) && /evidenceConfirmed/.test(guided) && /evidenceRef requerido/.test(guided)),
  check('Biblioteca de runbooks operativos disponible', /getRunbooks/.test(guided) && /runbookId/.test(guided) && /controls/.test(guided)),
  check('Endpoints y UI Meta A8 conectados', /\/operations\/guided-flow/.test(routes) && /\/operations\/runbooks/.test(routes) && /Meta A8/.test(web) && /loadA8GuidedFlow\(\)/.test(web) && /loadA8Runbooks\(\)/.test(web)),
  check('Plan documental contiene Meta A8', /Meta A8/.test(plan) && /Operación guiada anti-error humano/.test(plan))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaA8GateReached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaA8GateReached) process.exitCode = 2;
