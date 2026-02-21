const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'store.json');

const defaultState = {
  migratedAt: null,
  source: null,
  usuarios: [],
  sesiones: [],
  productos: [],
  movimientos: [],
  cuentas: [],
  terceros: [],
  flujoCaja: [],
  periodos: [],
  auditLog: []
};

function ensureArrays(state) {
  const keys = ['usuarios', 'sesiones', 'productos', 'movimientos', 'cuentas', 'terceros', 'flujoCaja', 'periodos', 'auditLog'];
  for (const k of keys) {
    if (!Array.isArray(state[k])) state[k] = [];
  }
  if (state.migratedAt === undefined) state.migratedAt = null;
  if (state.source === undefined) state.source = null;
  return state;
}

function ensureFileStore() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultState, null, 2));
    return;
  }
  const state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  fs.writeFileSync(DATA_FILE, JSON.stringify(ensureArrays(state), null, 2));
}

function readFileStore() {
  ensureFileStore();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return ensureArrays(JSON.parse(raw));
}

function writeFileStore(next) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(ensureArrays(next), null, 2));
}

async function getPgClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL no configurada para modo postgres');
  let Client;
  try {
    ({ Client } = require('pg'));
  } catch (_) {
    throw new Error("Dependencia 'pg' no instalada. Ejecuta npm install en apps/api.");
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

async function readPostgresStore() {
  const client = await getPgClient();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    const result = await client.query('SELECT value FROM app_state WHERE key = $1 LIMIT 1', ['jet_store_runtime']);
    if (!result.rows.length) {
      const base = { ...defaultState };
      await client.query(
        `INSERT INTO app_state (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())`,
        ['jet_store_runtime', JSON.stringify(base)]
      );
      return base;
    }
    return ensureArrays(result.rows[0].value || {});
  } finally {
    await client.end();
  }
}

async function writePostgresStore(next) {
  const client = await getPgClient();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(
      `INSERT INTO app_state (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      ['jet_store_runtime', JSON.stringify(ensureArrays(next))]
    );
  } finally {
    await client.end();
  }
}

function mode() {
  return process.env.PERSISTENCE_MODE || 'file';
}

async function readStore() {
  return mode() === 'postgres' ? readPostgresStore() : readFileStore();
}

async function writeStore(next) {
  return mode() === 'postgres' ? writePostgresStore(next) : writeFileStore(next);
}

async function appendAudit(action, detail, user = 'system') {
  const state = await readStore();
  state.auditLog.push({
    id: `AUD-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    action,
    detail,
    user,
    createdAt: new Date().toISOString()
  });
  await writeStore(state);
}

module.exports = { readStore, writeStore, appendAudit, mode };
