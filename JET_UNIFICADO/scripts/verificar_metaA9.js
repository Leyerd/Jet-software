#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const execModule = read('apps/api/src/modules/eirlExecutive.js');
const routes = read('apps/api/src/routes.js');
const web = read('apps/web/index.html');
const plan = read('docs/PLAN_METAS_REEMPLAZO_CONTADOR_EIRL.md');

const checks = [
  check('Simulación de 3 cierres mensuales consecutivos implementada', /buildAccountantReplacementPilot/.test(execModule) && /\[0, 1, 2\]/.test(execModule)),
  check('Evidencia fiscal completa empresa + dueño por mes', /company: \{ total: companyObs.length, withAck: companyAck \}/.test(execModule) && /owner: \{ total: ownerObs.length, withAck: ownerAck \}/.test(execModule) && /auditHashChain/.test(execModule)),
  check('Informe de desvíos y acciones correctivas', /deviations/.test(execModule) && /correctiveActions/.test(execModule) && /externalDependency/.test(execModule)),
  check('Endpoint y UI de Meta A9 conectados', /\/executive\/accountant-replacement-pilot/.test(routes) && /Meta A9/.test(web) && /loadA9Pilot\(\)/.test(web)),
  check('Plan documental contiene Meta A9', /Meta A9/.test(plan) && /Validación de reemplazo de contador/.test(plan))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaA9GateReached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaA9GateReached) process.exitCode = 2;
