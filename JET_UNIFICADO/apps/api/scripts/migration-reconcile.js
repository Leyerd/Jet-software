#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'store.json');
const OUTPUT_FILE = path.join(__dirname, '..', '..', 'docs', 'MIGRATION_RECONCILIATION_REPORT.json');

const asArray = (v) => (Array.isArray(v) ? v : []);
const sum = (arr, field) => asArray(arr).reduce((a, b) => a + Number(b?.[field] || 0), 0);

function readStore() {
  if (!fs.existsSync(DATA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Falta DATABASE_URL');

  const src = readStore();
  const source = {
    usuarios: asArray(src.usuarios).length,
    sesiones: asArray(src.sesiones).length,
    cuentas: asArray(src.cuentas).length,
    terceros: asArray(src.terceros).length,
    productos: asArray(src.productos).length,
    movimientos: asArray(src.movimientos).length,
    flujoCaja: asArray(src.flujoCaja).length,
    periodos: asArray(src.periodos).length,
    asientos: asArray(src.asientos).length,
    asientoLineas: asArray(src.asientoLineas).length,
    inventoryLots: asArray(src.inventoryLots).length,
    kardexMovements: asArray(src.kardexMovements).length,
    documentosFiscales: asArray(src.rcvVentas).length + asArray(src.rcvCompras).length + asArray(src.documentosFiscales).length,
    conciliaciones: asArray(src.conciliaciones).length,
    controls: {
      movimientosTotal: sum(src.movimientos, 'total'),
      flujoCajaMonto: sum(src.flujoCaja, 'monto')
    }
  };

  const { Client } = require('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const [
      usuarios, sesiones, cuentas, terceros, productos, movimientos, flujoCaja, periodos,
      asientos, asientoLineas, lots, kardex, docs, concs,
      movTotal, flujoTotal
    ] = await Promise.all([
      client.query('SELECT COUNT(*)::int AS n FROM usuarios'),
      client.query('SELECT COUNT(*)::int AS n FROM sesiones'),
      client.query('SELECT COUNT(*)::int AS n FROM cuentas'),
      client.query('SELECT COUNT(*)::int AS n FROM terceros'),
      client.query('SELECT COUNT(*)::int AS n FROM productos'),
      client.query('SELECT COUNT(*)::int AS n FROM movimientos'),
      client.query('SELECT COUNT(*)::int AS n FROM flujo_caja'),
      client.query('SELECT COUNT(*)::int AS n FROM periodos_contables'),
      client.query('SELECT COUNT(*)::int AS n FROM asientos_contables'),
      client.query('SELECT COUNT(*)::int AS n FROM asiento_lineas'),
      client.query('SELECT COUNT(*)::int AS n FROM lotes_inventario'),
      client.query('SELECT COUNT(*)::int AS n FROM kardex_movimientos'),
      client.query('SELECT COUNT(*)::int AS n FROM documentos_fiscales'),
      client.query('SELECT COUNT(*)::int AS n FROM conciliaciones'),
      client.query('SELECT COALESCE(SUM(total),0)::numeric AS v FROM movimientos'),
      client.query('SELECT COALESCE(SUM(monto),0)::numeric AS v FROM flujo_caja')
    ]);

    const target = {
      usuarios: usuarios.rows[0].n,
      sesiones: sesiones.rows[0].n,
      cuentas: cuentas.rows[0].n,
      terceros: terceros.rows[0].n,
      productos: productos.rows[0].n,
      movimientos: movimientos.rows[0].n,
      flujoCaja: flujoCaja.rows[0].n,
      periodos: periodos.rows[0].n,
      asientos: asientos.rows[0].n,
      asientoLineas: asientoLineas.rows[0].n,
      inventoryLots: lots.rows[0].n,
      kardexMovements: kardex.rows[0].n,
      documentosFiscales: docs.rows[0].n,
      conciliaciones: concs.rows[0].n,
      controls: {
        movimientosTotal: Number(movTotal.rows[0].v || 0),
        flujoCajaMonto: Number(flujoTotal.rows[0].v || 0)
      }
    };

    const diff = {};
    for (const k of Object.keys(source)) {
      if (k === 'controls') continue;
      diff[k] = Number(target[k] || 0) - Number(source[k] || 0);
    }
    diff.controls = {
      movimientosTotal: Number((target.controls.movimientosTotal - source.controls.movimientosTotal).toFixed(2)),
      flujoCajaMonto: Number((target.controls.flujoCajaMonto - source.controls.flujoCajaMonto).toFixed(2))
    };

    const allZero = Object.values(diff).filter(v => typeof v === 'number').every(v => v === 0)
      && Object.values(diff.controls).every(v => v === 0);

    const report = {
      generatedAt: new Date().toISOString(),
      source,
      target,
      diff,
      integrity: {
        zeroDiff: allZero,
        message: allZero ? 'Diferencias 0 en conteos y sumas control.' : 'Existen diferencias distintas de 0.'
      }
    };

    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (!allZero) process.exitCode = 2;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Error en reconciliación post-migración:', err.message);
  process.exit(1);
});
