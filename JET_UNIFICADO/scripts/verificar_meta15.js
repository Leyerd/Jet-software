#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const execMod = read('apps/api/src/modules/eirlExecutive.js');
const routes = read('apps/api/src/routes.js');
const web = read('apps/web/index.html');

const checks = [
  check('Pack de auditoría exportable implementado', /buildAuditPackage/.test(execMod) && /hashChain/.test(execMod)),
  check('Simulador de multa/riesgo implementado', /runRiskSimulation/.test(execMod) && /expectedRisk/.test(execMod)),
  check('Dashboard ejecutivo EIRL implementado', /buildExecutiveDashboard/.test(execMod) && /compliance/.test(execMod)),
  check('Endpoints Meta15 expuestos', /\/executive\/audit-package/.test(routes) && /\/executive\/risk-simulation/.test(routes) && /\/executive\/dashboard/.test(routes)),
  check('UI sin fricción para Meta15 visible', /tab-ejecutivo/.test(web) && /loadExecutivePanel/.test(web))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter(c => c.ok).length,
    total: checks.length,
    meta15GateReached: checks.every(c => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.meta15GateReached) process.exitCode = 2;
