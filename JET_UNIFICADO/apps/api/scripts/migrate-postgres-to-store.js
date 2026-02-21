#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, '..', 'data', 'store.export.json');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Falta DATABASE_URL');

  const { Client } = require('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const [usuarios, sesiones, productos, movimientos, periodos, tax, lotes, kardex, docs] = await Promise.all([
      client.query('SELECT id, email, nombre, rol, password_hash AS "passwordHash", creado_en AS "creadoEn" FROM usuarios ORDER BY id'),
      client.query('SELECT token, usuario_id AS "userId", creado_en AS "creadoEn", expira_en AS "expiraEn" FROM sesiones ORDER BY id'),
      client.query('SELECT id, sku, nombre, stock, costo_promedio AS "costoPromedio" FROM productos ORDER BY id'),
      client.query('SELECT id, fecha, tipo, descripcion, neto, iva, total, n_doc AS "nDoc", estado FROM movimientos ORDER BY id'),
      client.query('SELECT anio, mes, estado, cerrado_por AS "cerradoPor", cerrado_en AS "cerradoEn", reabierto_por AS "reabiertoPor", reabierto_en AS "reabiertoEn", motivo_reapertura AS "motivoReapertura" FROM periodos_contables ORDER BY anio, mes'),
      client.query('SELECT anio AS year, regimen AS regime, ppm_rate AS "ppmRate", iva_rate AS "ivaRate", ret_rate AS "retentionRate" FROM tax_config ORDER BY id DESC LIMIT 1'),
      client.query('SELECT id, producto_id AS "productId", fecha_ingreso AS "fechaIngreso", cantidad AS qty, costo_unitario AS "unitCost", origen AS source FROM lotes_inventario ORDER BY id'),
      client.query('SELECT id, producto_id AS "productId", lote_id AS "lotId", fecha, tipo AS type, cantidad AS qty, costo_unitario AS "unitCost", referencia AS reference FROM kardex_movimientos ORDER BY id'),
      client.query('SELECT id, tipo_dte AS "tipoDte", folio, fecha_emision AS "fechaEmision", neto, iva, total, metadata FROM documentos_fiscales ORDER BY id')
    ]);

    const snapshot = {
      migratedAt: new Date().toISOString(),
      source: 'postgres_export',
      usuarios: usuarios.rows,
      sesiones: sesiones.rows,
      productos: productos.rows,
      movimientos: movimientos.rows,
      periodos: periodos.rows,
      taxConfig: tax.rows[0] || null,
      inventoryLots: lotes.rows,
      kardexMovements: kardex.rows,
      documentosFiscales: docs.rows
    };

    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify(snapshot, null, 2));
    console.log(JSON.stringify({ ok: true, output: OUTPUT, totals: {
      usuarios: snapshot.usuarios.length,
      sesiones: snapshot.sesiones.length,
      productos: snapshot.productos.length,
      movimientos: snapshot.movimientos.length,
      periodos: snapshot.periodos.length,
      inventoryLots: snapshot.inventoryLots.length,
      kardexMovements: snapshot.kardexMovements.length,
      documentosFiscales: snapshot.documentosFiscales.length
    } }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Error exportando postgres -> store:', err.message);
  process.exit(1);
});
