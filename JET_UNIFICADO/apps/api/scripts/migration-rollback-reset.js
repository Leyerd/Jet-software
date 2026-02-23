#!/usr/bin/env node

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Falta DATABASE_URL');

  const { Client } = require('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE sesiones RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE asiento_lineas RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE asientos_contables RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE kardex_movimientos RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE lotes_inventario RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE flujo_caja RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE movimientos RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE productos RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE cuentas RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE terceros RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE periodos_contables RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE documentos_fiscales RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE conciliaciones RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE tax_config RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE audit_log RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE backups RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE migration_rows RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE migration_batches RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE reconciliation_documents RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE integration_sync_log RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE integration_provider_state RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE backup_policy_runtime RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE usuarios RESTART IDENTITY CASCADE');
    await client.query('COMMIT');
    console.log(JSON.stringify({ ok: true, message: 'Reset de datos completado. Listo para remigrar.' }, null, 2));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Error en rollback/reset:', err.message);
  process.exit(1);
});
