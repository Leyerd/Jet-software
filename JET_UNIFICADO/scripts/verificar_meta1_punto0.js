#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok, evidence) => ({ desc, ok, evidence });

const compose = read('docker-compose.yml');
const web = read('apps/web/index.html');
const auth = read('apps/api/src/modules/auth.js');
const store = read('apps/api/src/lib/store.js');
const reconc = read('apps/api/src/modules/reconciliation.js');
const products = read('apps/api/src/modules/products.js');
const movements = read('apps/api/src/modules/movements.js');
const periods = read('apps/api/src/modules/accountingClose.js');
const tax = read('apps/api/src/modules/tax.js');
const inventory = read('apps/api/src/modules/inventory.js');
const integrations = read('apps/api/src/modules/integrations.js');
const finance = read('apps/api/src/modules/finance.js');
const backup = read('apps/api/src/modules/backup.js');
const routes = read('apps/api/src/routes.js');
const journal = read('apps/api/src/modules/journal.js');

const point0 = [
  check('API por defecto en postgres (compose)', /PERSISTENCE_MODE:\s*postgres/.test(compose), 'docker-compose.yml -> PERSISTENCE_MODE: postgres'),
  check('Auth no usa sha256 simple', !/sha256/.test(auth) && /scrypt/.test(auth), 'auth.js usa scrypt y no sha256'),
  check('Conciliación incremental (sin reemplazo total por asignación directa)', !/state\.cartolaMovimientos\s*=\s*rows/.test(reconc), 'reconciliation.js sin reemplazo total'),
  check('Frontend default régimen 14D8', /regimen:\s*\'14D8\'/.test(web) && /db\.config\.regimen === undefined\) db\.config\.regimen = '14D8'/.test(web), 'index.html defaults 14D8'),
  check('Frontend no pide token manual de Mercado Libre', !/prompt\([^)]*token[^)]*Mercado Libre/i.test(web), 'sin prompt token ML'),
  check('Frontend backend-first (sin localStorage como fuente principal)', !/localStorage\.getItem\(/.test(web) && !/localStorage\.setItem\(/.test(web), 'sin getItem/setItem localStorage'),
  check('Postgres runtime sin app_state JSONB global', !/app_state/.test(store) && /runtime_fragments/.test(store), 'store.js usa runtime_fragments y no app_state'),
  check('Motor de doble partida operativo con publicación validada', /\/accounting\/entries/.test(routes) && /validateBalanced/.test(journal) && /estado = 'publicado'/.test(journal), 'journal + routes con validación debe=haber')
];

const meta1 = [
  check('Productos usan tabla postgres en modo postgres', /isPostgresMode\(\)/.test(products) && /INSERT INTO productos/.test(products) && /FROM productos/.test(products), 'products postgres branch'),
  check('Movimientos usan tabla postgres en modo postgres', /isPostgresMode\(\)/.test(movements) && /INSERT INTO movimientos/.test(movements) && /FROM movimientos/.test(movements), 'movements postgres branch'),
  check('Periodos usan periodos_contables en postgres', /periodos_contables/.test(periods), 'accountingClose postgres'),
  check('Tax usa tax_config + movimientos en postgres', /FROM tax_config/.test(tax) && /FROM movimientos/.test(tax), 'tax postgres'),
  check('Inventario usa lotes_inventario + kardex_movimientos en postgres', /lotes_inventario/.test(inventory) && /kardex_movimientos/.test(inventory), 'inventory postgres'),
  check('Integraciones usan tablas postgres runtime', /integration_provider_state/.test(integrations) && /integration_sync_log/.test(integrations), 'integrations postgres'),
  check('Reconciliación usa documentos/tablas postgres', /documentos_fiscales/.test(reconc) && /reconciliation_documents/.test(reconc), 'reconciliation postgres'),
  check('Finanzas usa movimientos en postgres', /FROM movimientos/.test(finance), 'finance postgres'),
  check('Backups usan política/tables postgres', /backup_policy_runtime/.test(backup) && /INSERT INTO backups/.test(backup), 'backup postgres')
];

const summarize = (items) => ({ passed: items.filter(i => i.ok).length, total: items.length, failed: items.filter(i => !i.ok).map(i => i.desc) });
const result = {
  generatedAt: new Date().toISOString(),
  point0,
  meta1,
  summary: {
    point0: summarize(point0),
    meta1: summarize(meta1),
    point0CompletelyFixed: point0.every(i => i.ok),
    meta1GateReached: meta1.every(i => i.ok)
  }
};
console.log(JSON.stringify(result, null, 2));
