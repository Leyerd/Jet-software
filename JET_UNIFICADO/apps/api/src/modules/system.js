const fs = require('fs');
const path = require('path');
const { sendJson } = require('../lib/http');
const { readStore } = require('../lib/store');
const { isPostgresMode, withPgClient } = require('../lib/postgresRepo');
const { ensureTaxConfig, getCatalog } = require('./tax');

async function coherenceCheck(_req, res) {
  const requiredFiles = [
    'src/routes.js',
    'src/modules/auth.js',
    'src/modules/migration.js',
    'src/modules/accountingClose.js',
    'src/modules/movements.js',
    'src/modules/products.js',
    'src/modules/db.js',
    'src/modules/finance.js',
    'src/modules/inventory.js',
    'src/modules/reconciliation.js',
    'src/modules/tax.js',
    'src/modules/integrations.js',
    'src/modules/backup.js',
    'src/modules/journal.js',
    'src/modules/reports.js',
    'src/modules/observability.js',
    'src/modules/compliance.js',
    'src/modules/accountingGovernance.js',
    'src/modules/eirlExecutive.js',
    'src/modules/normativeGovernance.js',
    'src/modules/eirlExecutive.js',
    'src/modules/normativeGovernance.js',
    'src/lib/http.js',
    'src/lib/store.js',
    'src/lib/postgresRepo.js',
    'src/lib/requestContext.js',
    'scripts/migrate-store-to-postgres.js',
    'scripts/qa-smoke.js',
    'scripts/qa-runner.js',
    'scripts/ci-check.js'
  ];

  const root = path.join(__dirname, '..', '..');
  const checks = requiredFiles.map(rel => ({ file: rel, exists: fs.existsSync(path.join(root, rel)) }));
  const missing = checks.filter(c => !c.exists).map(c => c.file);

  return sendJson(res, 200, {
    ok: missing.length === 0,
    sprint: 16,
    message: missing.length === 0 ? 'Coherencia básica OK' : 'Faltan archivos críticos',
    checks,
    missing
  });
}

async function getFrontendState(_req, res) {
  if (isPostgresMode()) {
    const state = await withPgClient(async (client) => {
      const [productsRs, movementsRs, taxRs] = await Promise.all([
        client.query('SELECT id, sku, nombre, categoria, costo_promedio AS "costoPromedio", stock FROM productos ORDER BY id ASC LIMIT 5000'),
        client.query('SELECT id, fecha, tipo, descripcion, total, neto, iva FROM movimientos ORDER BY fecha ASC, id ASC LIMIT 10000'),
        client.query('SELECT anio AS year, regimen AS regime, ppm_rate AS "ppmRate", iva_rate AS "ivaRate", ret_rate AS "retentionRate" FROM tax_config ORDER BY id DESC LIMIT 1')
      ]);
      const taxConfig = taxRs.rows[0] || { year: new Date().getFullYear(), regime: '14D8', ppmRate: 0.2, ivaRate: 0.19, retentionRate: 14.5 };
      const catalog = getCatalog(taxConfig.year, taxConfig.regime);
      return {
        backendFirst: true,
        products: productsRs.rows,
        movements: movementsRs.rows,
        taxConfig,
        defaults: {
          regime: '14D8',
          year: taxConfig.year,
          ppmRate: taxConfig.ppmRate,
          retentionRate: taxConfig.retentionRate
        },
        taxCatalog: { version: catalog.version, source: catalog.source }
      };
    });
    return sendJson(res, 200, { ok: true, state });
  }

  const store = await readStore();
  const taxConfig = ensureTaxConfig(store);
  const catalog = getCatalog(taxConfig.year, taxConfig.regime);
  return sendJson(res, 200, {
    ok: true,
    state: {
      backendFirst: true,
      products: store.productos || [],
      movements: store.movimientos || [],
      taxConfig,
      defaults: {
        regime: '14D8',
        year: taxConfig.year,
        ppmRate: taxConfig.ppmRate,
        retentionRate: taxConfig.retentionRate
      },
      taxCatalog: { version: catalog.version, source: catalog.source }
    }
  });
}

module.exports = { coherenceCheck, getFrontendState };
