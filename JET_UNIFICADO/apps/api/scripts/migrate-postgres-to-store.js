#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, '..', 'data', 'store.json');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Falta DATABASE_URL');

  const { Client } = require('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const result = await client.query('SELECT value FROM app_state WHERE key = $1 LIMIT 1', ['jet_store_runtime']);
    if (!result.rows.length) throw new Error('No existe app_state con key=jet_store_runtime');

    const store = result.rows[0].value;
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify(store, null, 2));
    console.log('Exportado postgres -> store.json correctamente');
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Error exportando postgres -> store:', err.message);
  process.exit(1);
});
