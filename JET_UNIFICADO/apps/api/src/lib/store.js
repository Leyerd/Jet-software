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
  auditLog: [],
  asientos: [],
  asientoLineas: [],
  taxConfig: {
    regime: '14D8',
    year: new Date().getFullYear(),
    ppmRate: 0.2,
    ivaRate: 0.19,
    retentionRate: 14.5
  },
  cartolaMovimientos: [],
  rcvVentas: [],
  marketplaceOrders: [],
  rcvCompras: [],
  integrationConfigs: {
    alibaba: { enabled: false, lastSyncAt: null },
    mercadolibre: { enabled: false, lastSyncAt: null },
    sii: { enabled: false, lastSyncAt: null }
  },
  integrationSyncLog: [],
  backups: [],
  backupPolicy: {
    retentionMaxFiles: 20,
    frequency: 'daily',
    encryptionPlanned: true,
    offsitePlanned: true
  }
};

const POSTGRES_FRAGMENT_KEYS = [
  'migratedAt',
  'source',
  'usuarios',
  'sesiones',
  'productos',
  'movimientos',
  'cuentas',
  'terceros',
  'flujoCaja',
  'periodos',
  'auditLog',
  'asientos',
  'asientoLineas',
  'taxConfig',
  'cartolaMovimientos',
  'rcvVentas',
  'marketplaceOrders',
  'rcvCompras',
  'integrationConfigs',
  'integrationSyncLog',
  'backups',
  'backupPolicy'
];

function ensureArrays(state) {
  const keys = [
    'usuarios', 'sesiones', 'productos', 'movimientos', 'cuentas', 'terceros', 'flujoCaja', 'periodos', 'auditLog',
    'asientos', 'asientoLineas', 'cartolaMovimientos', 'rcvVentas', 'rcvCompras', 'marketplaceOrders', 'integrationSyncLog', 'backups'
  ];
  for (const k of keys) {
    if (!Array.isArray(state[k])) state[k] = [];
  }
  if (state.migratedAt === undefined) state.migratedAt = null;
  if (state.source === undefined) state.source = null;
  if (!state.taxConfig || typeof state.taxConfig !== 'object') {
    state.taxConfig = { regime: '14D8', year: new Date().getFullYear(), ppmRate: 0.2, ivaRate: 0.19, retentionRate: 14.5 };
  }

  if (!state.integrationConfigs || typeof state.integrationConfigs !== 'object') {
    state.integrationConfigs = {
      alibaba: { enabled: false, lastSyncAt: null },
      mercadolibre: { enabled: false, lastSyncAt: null },
      sii: { enabled: false, lastSyncAt: null }
    };
  }

  if (!state.backupPolicy || typeof state.backupPolicy !== 'object') {
    state.backupPolicy = {
      retentionMaxFiles: 20,
      frequency: 'daily',
      encryptionPlanned: true,
      offsitePlanned: true
    };
  }
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

async function ensureRuntimeFragmentsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS runtime_fragments (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function readPostgresStore() {
  const client = await getPgClient();
  try {
    await ensureRuntimeFragmentsTable(client);
    const rs = await client.query('SELECT key, value FROM runtime_fragments');
    const next = { ...defaultState };
    for (const row of rs.rows) {
      if (POSTGRES_FRAGMENT_KEYS.includes(row.key)) next[row.key] = row.value;
    }
    return ensureArrays(next);
  } finally {
    await client.end();
  }
}

async function writePostgresStore(next) {
  const safe = ensureArrays(next);
  const client = await getPgClient();
  try {
    await ensureRuntimeFragmentsTable(client);
    await client.query('BEGIN');
    for (const key of POSTGRES_FRAGMENT_KEYS) {
      await client.query(
        `INSERT INTO runtime_fragments (key, value, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, JSON.stringify(safe[key])]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
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
