#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const integrations = read('apps/api/src/modules/integrations.js');
const routes = read('apps/api/src/routes.js');
const web = read('apps/web/index.html');

const checks = [
  check('Conectores backend con credenciales seguras por secrets/env', /resolveConnectorSecret/.test(integrations) && /ML_ACCESS_TOKEN/.test(integrations) && /SII_API_KEY/.test(integrations)),
  check('Scheduler de sincronización + retries + dead-letter', /runSyncWithRetry/.test(integrations) && /integration_sync_jobs/.test(integrations) && /integration_dead_letter/.test(integrations)),
  check('Registro de estado por conector (última sync, errores, latencia, volumen)', /last_sync_at/.test(integrations) && /last_error/.test(integrations) && /last_latency_ms/.test(integrations) && /last_volume/.test(integrations)),
  check('Endpoints operativos meta9 expuestos', /\/integrations\/sync\/run/.test(routes) && /\/integrations\/dead-letter/.test(routes)),
  check('Gate Meta9: UI no solicita token/manual prompt ML\/SII', !/prompt\(/.test(web) && /\/integrations\/sync\/run/.test(web))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter(c => c.ok).length,
    total: checks.length,
    meta9GateReached: checks.every(c => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.meta9GateReached) process.exitCode = 2;
