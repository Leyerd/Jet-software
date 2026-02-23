#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const observability = read('apps/api/src/modules/observability.js');
const routes = read('apps/api/src/routes.js');
const server = read('apps/api/server.js');
const requestCtx = read('apps/api/src/lib/requestContext.js');

const checks = [
  check('Logs estructurados implementados', /logStructured/.test(observability) && /JSON\.stringify\(entry\)/.test(observability)),
  check('Métricas de request y latencia implementadas', /recordRequest/.test(observability) && /latencies/.test(observability) && /p95Ms/.test(observability)),
  check('Alertas operativas implementadas (sync, conciliación, post-cierre, backup)', /sync-failures/.test(observability) && /reconciliation-observed/.test(observability) && /post-close-attempt/.test(observability) && /backup-failed/.test(observability)),
  check('Correlación por requestId implementada', /AsyncLocalStorage/.test(requestCtx) && /runWithRequestContext/.test(server) && /X-Request-Id/.test(server)),
  check('Dashboard operativo expuesto por API', /\/observability\/dashboard/.test(routes) && /getDashboard/.test(routes))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter(c => c.ok).length,
    total: checks.length,
    meta12GateReached: checks.every(c => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.meta12GateReached) process.exitCode = 2;
