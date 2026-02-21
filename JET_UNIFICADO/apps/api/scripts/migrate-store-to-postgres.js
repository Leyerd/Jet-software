#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'store.json');
const DRY_RUN = process.argv.includes('--dry-run');

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

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta variable de entorno: ${name}`);
  return v;
}

function readStore() {
  if (!fs.existsSync(DATA_FILE)) {
    return defaultState;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

async function main() {
  const store = readStore();
  const summary = {
    usuarios: (store.usuarios || []).length,
    productos: (store.productos || []).length,
    movimientos: (store.movimientos || []).length,
    cuentas: (store.cuentas || []).length,
    terceros: (store.terceros || []).length,
    flujoCaja: (store.flujoCaja || []).length,
    periodos: (store.periodos || []).length,
    auditLog: (store.auditLog || []).length
  };

  if (DRY_RUN) {
    console.log('[DRY-RUN] Resumen de datos a migrar:', JSON.stringify(summary, null, 2));
    return;
  }

  const databaseUrl = requiredEnv('DATABASE_URL');
  const { Client } = require('pg');
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();
  await client.query('BEGIN');

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
      ['jet_store_runtime', JSON.stringify(store)]
    );

    await client.query('COMMIT');
    console.log('Migración completada en PostgreSQL. Resumen:', JSON.stringify(summary, null, 2));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Error migrando store -> postgres:', err.message);
  process.exit(1);
});
