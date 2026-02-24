#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const execModule = read('apps/api/src/modules/eirlExecutive.js');
const routes = read('apps/api/src/routes.js');
const web = read('apps/web/index.html');
const compliance = read('apps/api/src/modules/compliance.js');
const plan = read('docs/PLAN_METAS_REEMPLAZO_CONTADOR_EIRL.md');

const checks = [
  check('Propuesta anual consolidada dueño + empresa por régimen', /buildAnnualFiscalProposal/.test(execModule) && /proposal:\s*\{\s*company/.test(execModule) && /owner:/.test(execModule) && /regime/.test(execModule)),
  check('Soporte de crédito y trazabilidad por fuente', /creditSupport/.test(execModule) && /sourceTrace/.test(execModule) && /source: 'rcv\+movements'/.test(execModule)),
  check('Control de evidencia y acuse por actor', /declarationEvidence/.test(execModule) && /empresa/.test(execModule) && /dueno/.test(execModule) && /ownerScope/.test(compliance)),
  check('Endpoint y UI para propuesta fiscal A6', /\/executive\/fiscal-proposal/.test(routes) && /loadFiscalProposal\(\)/.test(web) && /Meta A6/.test(web)),
  check('Plan documental contiene Meta A6', /Meta A6/.test(plan) && /Fiscal dueño avanzado/.test(plan))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaA6GateReached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaA6GateReached) process.exitCode = 2;
