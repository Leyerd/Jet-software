const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { sendJson } = require('../lib/http');
const { readStore, writeStore } = require('../lib/store');
const { isPostgresMode, withPgClient } = require('../lib/postgresRepo');
const { ensureTaxConfig, getCatalog } = require('./tax');
const { buildDemoState } = require('../lib/demoData');

function generateDemoToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function ensureDemoSessionInPostgres() {
  return withPgClient(async (client) => {
    await client.query(`CREATE TABLE IF NOT EXISTS usuarios (
      id BIGSERIAL PRIMARY KEY,
      nombre TEXT,
      email TEXT UNIQUE,
      rol TEXT,
      password_hash TEXT,
      activo BOOLEAN DEFAULT TRUE,
      creado_en TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS sesiones (
      id BIGSERIAL PRIMARY KEY,
      usuario_id BIGINT,
      token TEXT UNIQUE,
      creado_en TIMESTAMP DEFAULT NOW(),
      expira_en TIMESTAMP,
      revocada BOOLEAN DEFAULT FALSE,
      revocada_en TIMESTAMP,
      revocada_por TEXT
    )`);

    let userId;
    const existing = await client.query('SELECT id FROM usuarios WHERE email = $1 LIMIT 1', ['dueno@demo.cl']);
    if (existing.rows.length) {
      userId = Number(existing.rows[0].id);
    } else {
      const created = await client.query(
        `INSERT INTO usuarios (nombre, email, rol, password_hash, activo)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING id`,
        ['Dueño Demo', 'dueno@demo.cl', 'dueno', '']
      );
      userId = Number(created.rows[0].id);
    }

    await client.query('UPDATE sesiones SET revocada = TRUE, revocada_en = NOW(), revocada_por = $2 WHERE usuario_id = $1 AND revocada IS DISTINCT FROM TRUE', [userId, 'demo-refresh']);
    const token = generateDemoToken();
    await client.query("INSERT INTO sesiones (usuario_id, token, creado_en, expira_en, revocada) VALUES ($1, $2, NOW(), NOW() + INTERVAL '12 hour', FALSE)", [userId, token]);
    return token;
  });
}

function ensureDemoSessionInFileStore(store) {
  if (!Array.isArray(store.usuarios)) store.usuarios = [];
  if (!Array.isArray(store.sesiones)) store.sesiones = [];

  let user = store.usuarios.find((u) => u.email === 'dueno@demo.cl');
  if (!user) {
    const nextId = store.usuarios.reduce((max, u) => Math.max(max, Number(u.id || 0)), 0) + 1;
    user = { id: nextId, email: 'dueno@demo.cl', nombre: 'Dueño Demo', rol: 'dueno', activo: true, passwordHash: '' };
    store.usuarios.push(user);
  }

  store.sesiones = store.sesiones.map((s) => (s.userId === user.id && !s.revocada
    ? { ...s, revocada: true, revocadaEn: new Date().toISOString(), revocadaPor: 'demo-refresh' }
    : s));

  const token = generateDemoToken();
  store.sesiones.push({ token, userId: user.id, creadoEn: new Date().toISOString(), revocada: false });
  return token;
}


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
      await client.query("CREATE TABLE IF NOT EXISTS usuarios (id BIGSERIAL PRIMARY KEY, nombre TEXT, email TEXT UNIQUE, rol TEXT, password_hash TEXT, activo BOOLEAN DEFAULT TRUE, creado_en TIMESTAMP DEFAULT NOW())");
      await client.query("CREATE TABLE IF NOT EXISTS sesiones (id BIGSERIAL PRIMARY KEY, usuario_id BIGINT, token TEXT UNIQUE, creado_en TIMESTAMP DEFAULT NOW(), expira_en TIMESTAMP, revocada BOOLEAN DEFAULT FALSE, revocada_en TIMESTAMP, revocada_por TEXT)");
      const [productsRs, movementsRs, taxRs, sessionRs] = await Promise.all([
        client.query('SELECT id, sku, nombre, categoria, costo_promedio AS "costoPromedio", stock FROM productos ORDER BY id ASC LIMIT 5000'),
        client.query('SELECT id, fecha, tipo, descripcion, total, neto, iva FROM movimientos ORDER BY fecha ASC, id ASC LIMIT 10000'),
        client.query('SELECT anio AS year, regimen AS regime, ppm_rate AS "ppmRate", iva_rate AS "ivaRate", ret_rate AS "retentionRate" FROM tax_config ORDER BY id DESC LIMIT 1'),
        client.query("SELECT s.token FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE u.email = 'dueno@demo.cl' AND s.revocada IS DISTINCT FROM TRUE ORDER BY s.creado_en DESC LIMIT 1")
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
        taxCatalog: { version: catalog.version, source: catalog.source },
        demoAuthToken: sessionRs.rows[0] ? sessionRs.rows[0].token : null
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
      taxCatalog: { version: catalog.version, source: catalog.source },
      demoAuthToken: (store.sesiones || []).find((s) => s && !s.revocada && s.userId === ((store.usuarios || []).find((u) => u.email === 'dueno@demo.cl') || {}).id)?.token || null
    }
  });
}

async function loadDemoData(_req, res) {
  const demo = buildDemoState();
  let demoAuthToken = null;

  if (isPostgresMode()) {
    await writeStore(demo.state);
    demoAuthToken = await ensureDemoSessionInPostgres();
  } else {
    demoAuthToken = ensureDemoSessionInFileStore(demo.state);
    await writeStore(demo.state);
  }

  return sendJson(res, 200, {
    ok: true,
    message: 'Base demo 2024-2026 cargada correctamente',
    demoAuthToken,
    summary: { totalsByYear: demo.totalsByYear, products: demo.products, movements: demo.movements }
  });
}

module.exports = { coherenceCheck, getFrontendState, loadDemoData };
