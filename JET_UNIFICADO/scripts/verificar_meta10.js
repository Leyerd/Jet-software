#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const web = read('apps/web/index.html');
const routes = read('apps/api/src/routes.js');
const system = read('apps/api/src/modules/system.js');

const checks = [
  check('Capa API client unificada en frontend', /const apiClient\s*=\s*\{/.test(web) && /request\(path/.test(web) && /\.post\('/.test(web)),
  check('Estado principal inicial cargado desde backend', /bootstrapFromBackend/.test(web) && /\/system\/frontend-state/.test(web) && /getFrontendState/.test(system)),
  check('Régimen por defecto unificado a 14D8', /regimen:\s*'14D8'/.test(web) && /defaults:[\s\S]*regime:\s*'14D8'/.test(system)),
  check('Endpoint backend para estado frontend expuesto', /\/system\/frontend-state/.test(routes) && /getFrontendState/.test(routes)),
  check('Gate Meta10: operación sin localStorage como fuente primaria', !/localStorage\./.test(web) && /backend-first/.test(web))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter(c => c.ok).length,
    total: checks.length,
    meta10GateReached: checks.every(c => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.meta10GateReached) process.exitCode = 2;
