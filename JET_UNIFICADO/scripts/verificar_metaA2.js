#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const web = read('apps/web/index.html');
const plan = read('docs/PLAN_METAS_REEMPLAZO_CONTADOR_EIRL.md');

const checks = [
  check('Menú agrupado por dominios A2', /Operación diaria/.test(web) && /Impuestos y cierre/.test(web) && /Control y análisis/.test(web) && /Dirección y gobierno/.test(web) && /Sistema/.test(web)),
  check('Módulos principales con inicio guiado accionable', /Inicio guiado/.test(web) && /Reportería/.test(web) && /Cumplimiento/.test(web) && /Observabilidad/.test(web)),
  check('Demo contextual por módulo implementada', /loadModuleDemo\('reporteria'\)/.test(web) && /loadModuleDemo\('cumplimiento'\)/.test(web) && /loadModuleDemo\('observabilidad'\)/.test(web) && /async function loadModuleDemo\(/.test(web)),
  check('Plan documental contiene Meta A2 y su gate', /Meta A2/.test(plan) && /Ningún módulo principal inicia vacío sin guía accionable/.test(plan))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    metaA2GateReached: checks.every((c) => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.metaA2GateReached) process.exitCode = 2;
