const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { route } = require('./src/routes');
const { mode, readStore, writeStore } = require('./src/lib/store');
const { withPgClient } = require('./src/lib/postgresRepo');
const { runWithRequestContext } = require('./src/lib/requestContext');
const { recordRequest } = require('./src/modules/observability');

const PORT = process.env.PORT || 4000;
const BOOT_EMPTY_MARKER_FILE = path.join(__dirname, 'data', '.startup-empty-initialized');
const BOOT_EMPTY_MARKER_KEY = 'startupEmptyInitialized';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const requestId = req.headers['x-request-id'] || `req-${crypto.randomUUID()}`;
  const startedAt = Date.now();
  const path = (req.url || '').split('?')[0] || '/';

  res.setHeader('X-Request-Id', requestId);
  res.on('finish', () => {
    recordRequest({
      requestId,
      method: req.method,
      path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });

  runWithRequestContext({ requestId, path }, () => route(req, res));
});

async function forceEmptyRuntimeAtBoot() {
  const policy = String(process.env.JET_START_EMPTY_ON_BOOT || 'once').trim().toLowerCase();
  if (policy === '0' || policy === 'false' || policy === 'off' || policy === 'disabled') return;
  const runAlways = policy === 'always';

  if (!runAlways) {
    if (mode() === 'postgres') {
      const alreadyInitialized = await withPgClient(async (client) => {
        await client.query('CREATE TABLE IF NOT EXISTS runtime_fragments (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMP DEFAULT NOW())');
        const rs = await client.query('SELECT value FROM runtime_fragments WHERE key = $1 LIMIT 1', [BOOT_EMPTY_MARKER_KEY]);
        return rs.rows.length && rs.rows[0].value === true;
      });
      if (alreadyInitialized) return;
    } else if (fs.existsSync(BOOT_EMPTY_MARKER_FILE)) {
      return;
    }
  }

  if (mode() === 'postgres') {
    await withPgClient(async (client) => {
      await client.query('CREATE TABLE IF NOT EXISTS movimientos (id BIGSERIAL PRIMARY KEY, fecha TEXT, tipo TEXT, descripcion TEXT, total NUMERIC(18,2) DEFAULT 0, neto NUMERIC(18,2) DEFAULT 0, iva NUMERIC(18,2) DEFAULT 0)');
      await client.query('CREATE TABLE IF NOT EXISTS productos (id BIGSERIAL PRIMARY KEY, sku TEXT, nombre TEXT, categoria TEXT, costo_promedio NUMERIC(18,2) DEFAULT 0, stock NUMERIC(18,2) DEFAULT 0)');
      await client.query('CREATE TABLE IF NOT EXISTS terceros (id BIGSERIAL PRIMARY KEY, rut TEXT, nombre TEXT, tipo TEXT)');
      await client.query('CREATE TABLE IF NOT EXISTS cuentas (id BIGSERIAL PRIMARY KEY, codigo TEXT, nombre TEXT, tipo TEXT, saldo NUMERIC(18,2) DEFAULT 0)');
      await client.query('CREATE TABLE IF NOT EXISTS runtime_fragments (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMP DEFAULT NOW())');
      await client.query('TRUNCATE TABLE movimientos, productos, terceros, cuentas RESTART IDENTITY CASCADE');
      await client.query("DELETE FROM runtime_fragments WHERE key IN ('movimientos','productos','terceros','cuentas','flujoCaja','asientos','asientoLineas','auditLog','source','migratedAt')");
      await client.query("INSERT INTO runtime_fragments (key, value, updated_at) VALUES ('movimientos','[]'::jsonb,NOW()),('productos','[]'::jsonb,NOW()),('terceros','[]'::jsonb,NOW()),('cuentas','[]'::jsonb,NOW()),('flujoCaja','[]'::jsonb,NOW()),('asientos','[]'::jsonb,NOW()),('asientoLineas','[]'::jsonb,NOW()),('auditLog','[]'::jsonb,NOW()),('source','null'::jsonb,NOW()),('migratedAt','null'::jsonb,NOW()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()");
      await client.query(
        `INSERT INTO runtime_fragments (key, value, updated_at)
         VALUES ($1, 'true'::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb, updated_at = NOW()`,
        [BOOT_EMPTY_MARKER_KEY]
      );
    });
    console.log('[JET] Runtime backend vaciado al arranque (Postgres).');
    return;
  }

  const state = await readStore();
  state.productos = [];
  state.movimientos = [];
  state.cuentas = [];
  state.terceros = [];
  state.flujoCaja = [];
  state.asientos = [];
  state.asientoLineas = [];
  state.auditLog = [];
  state.source = null;
  state.migratedAt = null;
  await writeStore(state);
  fs.mkdirSync(path.dirname(BOOT_EMPTY_MARKER_FILE), { recursive: true });
  fs.writeFileSync(BOOT_EMPTY_MARKER_FILE, new Date().toISOString());
  console.log('[JET] Runtime backend vaciado al arranque (file-store).');
}

(async () => {
  try {
    await forceEmptyRuntimeAtBoot();
  } catch (err) {
    console.warn('[JET] No se pudo vaciar runtime al arranque:', err?.message || err);
  }
  server.listen(PORT, () => {
    console.log(`JET API (Sprint 16) escuchando en puerto ${PORT}`);
  });
})();
