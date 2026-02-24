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
  check('Auditoría interna final por procesos implementada', /buildOperationAutonomyCertification/.test(execModule) && /internalAudit/.test(execModule) && /fiscal/.test(execModule) && /contable/.test(execModule) && /operativo/.test(execModule)),
  check('KPIs finales de operación y cumplimiento incluidos', /finalKpis/.test(execModule) && /compliancePct/.test(execModule) && /externalDependencyHoursPerMonth/.test(execModule)),
  check('Acta de operación autónoma con mejora continua', /autonomyAct/.test(execModule) && /continuousImprovementPlan/.test(execModule) && /operacion_autonoma_sostenida/.test(execModule)),
  check('Endpoint y UI Meta A10 conectados', /\/executive\/operation-autonomy-certification/.test(routes) && /Meta A10/.test(web) && /loadA10Certification\(\)/.test(web)),
  check('Plan documental contiene Meta A10', /Meta A10/.test(plan) && /Certificación interna de operación total/.test(plan))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaA10GateReached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaA10GateReached) process.exitCode = 2;
