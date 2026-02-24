#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const compliance = read('apps/api/src/modules/compliance.js');
const movements = read('apps/api/src/modules/movements.js');
const routes = read('apps/api/src/routes.js');
const plan = read('docs/PLAN_METAS_REEMPLAZO_CONTADOR_EIRL.md');

const checks = [
  check('Checklist fiscal mensual empresa + dueño implementado', /buildMonthlyChecklist/.test(compliance) && /F22_DUENO/.test(compliance) && /F22_EMPRESA/.test(compliance) && /appliesThisMonth/.test(compliance)),
  check('Endpoint checklist expuesto', /\/compliance\/checklist/.test(routes)),
  check('Evidencia y acuse obligacional soportados', /registerEvidence/.test(compliance) && /ackNumber/.test(compliance)),
  check('Bloqueo operativo por vencidos críticos', /COMPLIANCE_BLOCK/.test(movements) && /evaluateComplianceBlockers/.test(compliance)),
  check('Plan documental contiene Meta A1', /Meta A1/.test(plan) && /Flujo fiscal mínimo infalible/.test(plan))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter(c => c.ok).length,
    total: checks.length,
    metaA1GateReached: checks.every(c => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaA1GateReached) process.exitCode = 2;
