const { sendJson } = require('../lib/http');
const { mode } = require('../lib/store');

async function dbStatus(_req, res) {
  const persistenceMode = mode();
  const databaseUrl = process.env.DATABASE_URL || null;
  const usingPostgres = persistenceMode === 'postgres';

  let pgAvailable = false;
  let connectionOk = false;
  let connectionMessage = 'no comprobada';

  try {
    require.resolve('pg');
    pgAvailable = true;
  } catch (_) {
    pgAvailable = false;
  }

  if (usingPostgres && pgAvailable && databaseUrl) {
    try {
      const { Client } = require('pg');
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      connectionOk = true;
      connectionMessage = 'Conexión PostgreSQL OK';
    } catch (err) {
      connectionMessage = `Error conexión PostgreSQL: ${err.message}`;
    }
  } else if (usingPostgres && !pgAvailable) {
    connectionMessage = "Falta instalar dependencia 'pg'";
  }

  return sendJson(res, 200, {
    ok: true,
    sprint: '10',
    persistenceMode,
    usingPostgres,
    pgAvailable,
    databaseConfigured: Boolean(databaseUrl),
    connectionOk,
    message: usingPostgres
      ? connectionMessage
      : 'Modo archivo activo (compatibilidad Sprint 1/2)'
  });
}

module.exports = { dbStatus };
