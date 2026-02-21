const { sendJson } = require('../lib/http');

function dbStatus(_req, res) {
  const persistenceMode = process.env.PERSISTENCE_MODE || 'file';
  const databaseUrl = process.env.DATABASE_URL || null;
  const usingPostgres = persistenceMode === 'postgres';

  let pgAvailable = false;
  try {
    require.resolve('pg');
    pgAvailable = true;
  } catch (_) {
    pgAvailable = false;
  }

  return sendJson(res, 200, {
    ok: true,
    sprint: 3,
    persistenceMode,
    usingPostgres,
    pgAvailable,
    databaseConfigured: Boolean(databaseUrl),
    message: usingPostgres
      ? (pgAvailable && databaseUrl ? 'Modo PostgreSQL listo para migración' : 'Falta instalar/configurar PostgreSQL')
      : 'Modo archivo activo (compatibilidad Sprint 1/2)'
  });
}

module.exports = { dbStatus };
