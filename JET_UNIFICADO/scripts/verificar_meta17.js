#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const compliance = read('apps/api/src/modules/compliance.js');
const movements = read('apps/api/src/modules/movements.js');
const routes = read('apps/api/src/routes.js');
const web = read('apps/web/index.html');

const checks = [
  check('Motor de vencimientos por régimen/tipo base', /OBLIGATION_TEMPLATES/.test(compliance) && /buildPeriodObligations/.test(compliance)),
  check('Alertas escaladas con SLA y canales', /buildEscalations/.test(compliance) && /escalationDaysBefore/.test(compliance)),
  check('Bloqueo operativo por vencidos críticos sin acuse', /evaluateComplianceBlockers/.test(compliance) && /COMPLIANCE_BLOCK/.test(movements)),
  check('Evidencia con hash y acuse', /hashEvidence/.test(compliance) && /ackNumber/.test(compliance)),
  check('Endpoint de bloqueos expuesto', /\/compliance\/blockers/.test(routes)),
  check('UI de cumplimiento disponible', /tab-cumplimiento/.test(web) && /loadComplianceStatus/.test(web))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter(c => c.ok).length,
    total: checks.length,
    meta17GateReached: checks.every(c => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.meta17GateReached) process.exitCode = 2;
