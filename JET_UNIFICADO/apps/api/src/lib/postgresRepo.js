const { mode } = require('./store');

function isPostgresMode() {
  return mode() === 'postgres';
}

async function withPgClient(fn) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL no configurada para modo postgres');
  const { Client } = require('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function appendAuditLog(action, detail, user = 'system') {
  if (!isPostgresMode()) return false;
  await withPgClient(async (client) => {
    await client.query(
      `INSERT INTO audit_log (entidad, entidad_id, accion, detalle, usuario, fecha)
       VALUES ($1, $2, $3, $4::jsonb, $5, NOW())`,
      ['system', null, action, JSON.stringify(detail || {}), user]
    );
  });
  return true;
}

module.exports = {
  isPostgresMode,
  withPgClient,
  appendAuditLog
};
