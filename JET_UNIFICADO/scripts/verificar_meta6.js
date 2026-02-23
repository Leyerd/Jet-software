#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const reconciliation = read('apps/api/src/modules/reconciliation.js');
const routes = read('apps/api/src/routes.js');

const checks = [
  check('Modelo ingestion_batches + documents_raw + documents_normalized', /CREATE TABLE IF NOT EXISTS ingestion_batches/.test(reconciliation) && /CREATE TABLE IF NOT EXISTS documents_raw/.test(reconciliation) && /CREATE TABLE IF NOT EXISTS documents_normalized/.test(reconciliation)),
  check('Import incremental con deduplicación por llave documental', /UNIQUE \(source, doc_key, payload_hash\)/.test(reconciliation) && /ON CONFLICT \(source, doc_key, payload_hash\) DO NOTHING/.test(reconciliation) && /ON CONFLICT \(source, doc_key\)/.test(reconciliation)),
  check('Conciliación por estado pendiente\/conciliado\/observado\/resuelto', /ALLOWED_RECONCILIATION_STATUS/.test(reconciliation) && /pendiente/.test(reconciliation) && /conciliado/.test(reconciliation) && /observado/.test(reconciliation) && /resuelto/.test(reconciliation)),
  check('Endpoints para listar documentos y actualizar estado', /\/reconciliation\/documents/.test(routes) && /\/reconciliation\/documents\/status/.test(routes) && /listReconciliationDocuments/.test(reconciliation) && /updateReconciliationStatus/.test(reconciliation)),
  check('Gate Meta6: nunca reemplaza todo, siempre agrega lote y versiona', /INSERT INTO ingestion_batches/.test(reconciliation) && /version = documents_normalized.version \+ 1/.test(reconciliation) && !/state\.cartolaMovimientos\s*=\s*rows/.test(reconciliation))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter(c => c.ok).length,
    total: checks.length,
    meta6GateReached: checks.every(c => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.meta6GateReached) process.exitCode = 2;
