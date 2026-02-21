#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', 'data', 'store.json');
const DRY_RUN = process.argv.includes('--dry-run');

const asArray = (v) => (Array.isArray(v) ? v : []);
const sha = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rowId = (prefix, row) => String(row.id || row.key || `${prefix}-${sha(row).slice(0, 16)}`);

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta variable de entorno: ${name}`);
  return v;
}

function readStore() {
  if (!fs.existsSync(DATA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function buildPayload(store) {
  return {
    usuarios: asArray(store.usuarios),
    sesiones: asArray(store.sesiones),
    cuentas: asArray(store.cuentas),
    terceros: asArray(store.terceros),
    productos: asArray(store.productos),
    movimientos: asArray(store.movimientos),
    flujoCaja: asArray(store.flujoCaja),
    periodos: asArray(store.periodos),
    asientos: asArray(store.asientos),
    asientoLineas: asArray(store.asientoLineas),
    inventoryLots: asArray(store.inventoryLots),
    kardexMovements: asArray(store.kardexMovements),
    cartolaMovimientos: asArray(store.cartolaMovimientos),
    rcvVentas: asArray(store.rcvVentas),
    rcvCompras: asArray(store.rcvCompras),
    marketplaceOrders: asArray(store.marketplaceOrders),
    taxConfig: store.taxConfig || null,
    conciliaciones: asArray(store.conciliaciones)
  };
}

function summaryOf(payload) {
  return Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, Array.isArray(v) ? v.length : (v ? 1 : 0)]));
}

async function ensureMigrationTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migration_batches (
      id TEXT PRIMARY KEY,
      checksum TEXT UNIQUE NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      finished_at TIMESTAMP,
      summary JSONB
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS migration_rows (
      entity TEXT NOT NULL,
      row_key TEXT NOT NULL,
      checksum TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY(entity, row_key)
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS reconciliation_documents (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      period TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS integration_provider_state (
      provider TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT false,
      last_sync_at TIMESTAMP,
      account_alias TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS integration_sync_log (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      imported_at TIMESTAMP NOT NULL,
      result JSONB NOT NULL
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS backup_policy_runtime (
      id INT PRIMARY KEY DEFAULT 1,
      retention_max_files INT NOT NULL DEFAULT 20,
      frequency TEXT NOT NULL DEFAULT 'daily',
      encryption_planned BOOLEAN NOT NULL DEFAULT true,
      offsite_planned BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function shouldApply(client, entity, rowKey, checksum, batchId) {
  const existing = await client.query('SELECT checksum FROM migration_rows WHERE entity = $1 AND row_key = $2 LIMIT 1', [entity, rowKey]);
  if (existing.rows.length && existing.rows[0].checksum === checksum) return false;
  await client.query(
    `INSERT INTO migration_rows (entity, row_key, checksum, batch_id, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (entity, row_key)
     DO UPDATE SET checksum = EXCLUDED.checksum, batch_id = EXCLUDED.batch_id, updated_at = NOW()`,
    [entity, rowKey, checksum, batchId]
  );
  return true;
}

function monthKey(fecha) {
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return 'sin-periodo';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  const source = readStore();
  const payload = buildPayload(source);
  const summary = summaryOf(payload);
  const checksum = sha(payload);
  const batchId = `BATCH-${Date.now()}`;

  if (DRY_RUN) {
    console.log(JSON.stringify({ ok: true, dryRun: true, batchId, checksum, summary }, null, 2));
    return;
  }

  const databaseUrl = requiredEnv('DATABASE_URL');
  const { Client } = require('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('BEGIN');
    await ensureMigrationTables(client);

    const already = await client.query('SELECT id FROM migration_batches WHERE checksum = $1 AND status = $2 LIMIT 1', [checksum, 'completed']);
    if (already.rows.length) {
      await client.query('ROLLBACK');
      console.log(JSON.stringify({ ok: true, skipped: true, reason: 'checksum already migrated', checksum, previousBatchId: already.rows[0].id, summary }, null, 2));
      return;
    }

    await client.query('INSERT INTO migration_batches (id, checksum, source, status, created_at, summary) VALUES ($1, $2, $3, $4, NOW(), $5::jsonb)', [batchId, checksum, 'store.json', 'running', JSON.stringify(summary)]);

    const userMap = new Map();
    for (const u of payload.usuarios) {
      const key = rowId('usr', u);
      if (!await shouldApply(client, 'usuarios', key, sha(u), batchId)) continue;
      const rs = await client.query(
        `INSERT INTO usuarios (email, nombre, rol, password_hash, creado_en)
         VALUES ($1, $2, $3, $4, COALESCE($5::timestamp, NOW()))
         ON CONFLICT (email)
         DO UPDATE SET nombre=EXCLUDED.nombre, rol=EXCLUDED.rol, password_hash=EXCLUDED.password_hash
         RETURNING id`,
        [String(u.email || '').toLowerCase(), u.nombre || 'Sin nombre', u.rol || 'operador', u.passwordHash || u.password_hash || null, u.creadoEn || u.creado_en || null]
      );
      userMap.set(key, rs.rows[0].id);
    }

    const accountMap = new Map();
    for (const c of payload.cuentas) {
      const key = rowId('cta', c);
      if (!await shouldApply(client, 'cuentas', key, sha(c), batchId)) continue;
      const codigo = String(c.codigo || key);
      const rs = await client.query(
        `INSERT INTO cuentas (codigo, nombre, tipo, saldo, creado_en)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (codigo)
         DO UPDATE SET nombre=EXCLUDED.nombre, tipo=EXCLUDED.tipo, saldo=EXCLUDED.saldo
         RETURNING id`,
        [codigo, c.nombre || 'Cuenta migrada', c.tipo || 'activo', Number(c.saldo || 0)]
      );
      accountMap.set(key, rs.rows[0].id);
    }

    const thirdMap = new Map();
    for (const t of payload.terceros) {
      const key = rowId('ter', t);
      if (!await shouldApply(client, 'terceros', key, sha(t), batchId)) continue;
      const rut = t.rut || null;
      const rs = await client.query(
        `INSERT INTO terceros (rut, nombre, tipo, creado_en)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (rut)
         DO UPDATE SET nombre=EXCLUDED.nombre, tipo=EXCLUDED.tipo
         RETURNING id`,
        [rut, t.nombre || 'Tercero migrado', t.tipo || null]
      );
      thirdMap.set(key, rs.rows[0].id);
    }

    const productMap = new Map();
    for (const p of payload.productos) {
      const key = rowId('prd', p);
      if (!await shouldApply(client, 'productos', key, sha(p), batchId)) continue;
      const sku = p.sku || `MIG-${key}`;
      const rs = await client.query(
        `INSERT INTO productos (sku, nombre, stock, costo_promedio, creado_en)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (sku)
         DO UPDATE SET nombre=EXCLUDED.nombre, stock=EXCLUDED.stock, costo_promedio=EXCLUDED.costo_promedio
         RETURNING id`,
        [sku, p.nombre || 'Producto migrado', Number(p.stock || 0), Number(p.costoPromedio || p.costo_promedio || 0)]
      );
      productMap.set(key, rs.rows[0].id);
    }

    for (const s of payload.sesiones) {
      const key = String(s.token || rowId('ses', s));
      if (!await shouldApply(client, 'sesiones', key, sha(s), batchId)) continue;
      const userRef = String(s.userId || s.usuario_id || '');
      const userId = userMap.get(userRef) || null;
      if (!userId) continue;
      await client.query(
        `INSERT INTO sesiones (usuario_id, token, creado_en, expira_en)
         VALUES ($1, $2, COALESCE($3::timestamp, NOW()), $4::timestamp)
         ON CONFLICT (token) DO NOTHING`,
        [userId, key, s.creadoEn || s.creado_en || null, s.expiraEn || s.expira_en || null]
      );
    }

    for (const m of payload.movimientos) {
      const key = rowId('mov', m);
      if (!await shouldApply(client, 'movimientos', key, sha(m), batchId)) continue;
      const productId = productMap.get(String(m.productId || m.producto_id || '')) || null;
      const terceroId = thirdMap.get(String(m.terceroId || m.tercero_id || '')) || null;
      await client.query(
        `INSERT INTO movimientos (fecha, tipo, descripcion, neto, iva, total, producto_id, tercero_id, n_doc, estado, creado_en)
         VALUES (COALESCE($1::date, NOW()::date), $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 'vigente'), NOW())`,
        [m.fecha || null, m.tipo || 'MIGRADO', m.descripcion || '', Number(m.neto || 0), Number(m.iva || 0), Number(m.total || 0), productId, terceroId, m.nDoc || m.n_doc || null, m.estado || 'vigente']
      );
    }

    for (const fc of payload.flujoCaja) {
      const key = rowId('fc', fc);
      if (!await shouldApply(client, 'flujo_caja', key, sha(fc), batchId)) continue;
      const cuentaId = accountMap.get(String(fc.cuentaId || fc.cuenta_id || '')) || null;
      await client.query(
        `INSERT INTO flujo_caja (fecha, cuenta_id, tipo_movimiento, descripcion, monto, creado_en)
         VALUES (COALESCE($1::date, NOW()::date), $2, $3, $4, $5, NOW())`,
        [fc.fecha || null, cuentaId, fc.tipoMovimiento || fc.tipo_movimiento || 'INGRESO', fc.descripcion || '', Number(fc.monto || 0)]
      );
    }

    for (const p of payload.periodos) {
      const key = rowId('per', p);
      if (!await shouldApply(client, 'periodos_contables', key, sha(p), batchId)) continue;
      const anio = Number(p.anio || String(p.key || '').split('-')[0] || new Date().getFullYear());
      const mes = Number(p.mes || String(p.key || '').split('-')[1] || 1);
      await client.query(
        `INSERT INTO periodos_contables (anio, mes, estado, cerrado_por, cerrado_en, reabierto_por, reabierto_en, motivo_reapertura)
         VALUES ($1, $2, COALESCE($3, 'abierto'), $4, $5::timestamp, $6, $7::timestamp, $8)
         ON CONFLICT (anio, mes)
         DO UPDATE SET estado=EXCLUDED.estado, cerrado_por=EXCLUDED.cerrado_por, cerrado_en=EXCLUDED.cerrado_en,
                       reabierto_por=EXCLUDED.reabierto_por, reabierto_en=EXCLUDED.reabierto_en, motivo_reapertura=EXCLUDED.motivo_reapertura`,
        [anio, mes, p.estado || 'abierto', p.cerradoPor || null, p.cerradoEn || null, p.reabiertoPor || null, p.reabiertoEn || null, p.motivoReapertura || null]
      );
    }

    const seatMap = new Map();
    for (const a of payload.asientos) {
      const key = rowId('ast', a);
      if (!await shouldApply(client, 'asientos_contables', key, sha(a), batchId)) continue;
      const rs = await client.query(
        `INSERT INTO asientos_contables (fecha, glosa, origen, estado, creado_por, creado_en)
         VALUES (COALESCE($1::date, NOW()::date), $2, $3, COALESCE($4, 'borrador'), $5, COALESCE($6::timestamp, NOW()))
         RETURNING id`,
        [a.fecha || null, a.glosa || '', a.origen || null, a.estado || 'borrador', a.creadoPor || a.creado_por || null, a.creadoEn || a.creado_en || null]
      );
      seatMap.set(key, rs.rows[0].id);
    }

    for (const l of payload.asientoLineas) {
      const key = rowId('lin', l);
      if (!await shouldApply(client, 'asiento_lineas', key, sha(l), batchId)) continue;
      const seatId = seatMap.get(String(l.asientoId || l.asiento_id || '')) || null;
      if (!seatId) continue;
      const cuentaId = accountMap.get(String(l.cuentaId || l.cuenta_id || '')) || null;
      if (!cuentaId) continue;
      await client.query('INSERT INTO asiento_lineas (asiento_id, cuenta_id, debe, haber, descripcion) VALUES ($1, $2, $3, $4, $5)', [seatId, cuentaId, Number(l.debe || 0), Number(l.haber || 0), l.descripcion || '']);
    }

    for (const l of payload.inventoryLots) {
      const key = rowId('lot', l);
      if (!await shouldApply(client, 'lotes_inventario', key, sha(l), batchId)) continue;
      const productId = productMap.get(String(l.productId || l.producto_id || '')) || null;
      if (!productId) continue;
      await client.query(
        `INSERT INTO lotes_inventario (producto_id, fecha_ingreso, cantidad, costo_unitario, origen, creado_en)
         VALUES ($1, COALESCE($2::date, NOW()::date), $3, $4, $5, NOW())`,
        [productId, l.fechaIngreso || l.fecha_ingreso || null, Number(l.qty || l.cantidad || 0), Number(l.unitCost || l.costo_unitario || 0), l.source || l.origen || null]
      );
    }

    for (const k of payload.kardexMovements) {
      const key = rowId('kdx', k);
      if (!await shouldApply(client, 'kardex_movimientos', key, sha(k), batchId)) continue;
      const productId = productMap.get(String(k.productId || k.producto_id || '')) || null;
      if (!productId) continue;
      await client.query(
        `INSERT INTO kardex_movimientos (producto_id, fecha, tipo, cantidad, costo_unitario, referencia, creado_en)
         VALUES ($1, COALESCE($2::date, NOW()::date), $3, $4, $5, $6, NOW())`,
        [productId, k.fecha || null, k.type || k.tipo || 'MIG', Number(k.qty || k.cantidad || 0), Number(k.unitCost || k.costo_unitario || 0), k.reference || k.referencia || null]
      );
    }

    for (const d of payload.cartolaMovimientos) {
      const key = rowId('cart', d);
      if (!await shouldApply(client, 'reconciliation_documents.cartola', key, sha(d), batchId)) continue;
      await client.query('INSERT INTO reconciliation_documents (id, source, period, payload, created_at) VALUES ($1, $2, $3, $4::jsonb, NOW()) ON CONFLICT (id) DO NOTHING', [key, 'cartola', monthKey(d.fecha), JSON.stringify(d)]);
    }

    for (const d of payload.marketplaceOrders) {
      const key = rowId('mkt', d);
      if (!await shouldApply(client, 'reconciliation_documents.marketplace', key, sha(d), batchId)) continue;
      await client.query('INSERT INTO reconciliation_documents (id, source, period, payload, created_at) VALUES ($1, $2, $3, $4::jsonb, NOW()) ON CONFLICT (id) DO NOTHING', [key, 'marketplace', monthKey(d.fecha), JSON.stringify(d)]);
    }

    for (const d of payload.rcvVentas) {
      const key = String(d.folio || rowId('rcvv', d));
      if (!await shouldApply(client, 'documentos_fiscales.ventas', key, sha(d), batchId)) continue;
      await client.query(
        `INSERT INTO documentos_fiscales (tipo_dte, folio, fecha_emision, neto, iva, total, metadata, creado_en)
         VALUES ('RCV_VENTA', $1, COALESCE($2::date, NOW()::date), $3, $4, $5, $6::jsonb, NOW())`,
        [key, d.fecha || null, Number(d.neto || 0), Number(d.iva || 0), Number(d.total || 0), JSON.stringify({ source: 'migration.rcvVentas' })]
      );
    }

    for (const d of payload.rcvCompras) {
      const key = String(d.folio || rowId('rcvc', d));
      if (!await shouldApply(client, 'documentos_fiscales.compras', key, sha(d), batchId)) continue;
      await client.query(
        `INSERT INTO documentos_fiscales (tipo_dte, folio, fecha_emision, neto, iva, total, metadata, creado_en)
         VALUES ('RCV_COMPRA', $1, COALESCE($2::date, NOW()::date), $3, $4, $5, $6::jsonb, NOW())`,
        [key, d.fecha || null, Number(d.neto || 0), Number(d.iva || 0), Number(d.total || 0), JSON.stringify({ source: 'migration.rcvCompras' })]
      );
    }

    for (const c of payload.conciliaciones) {
      const key = rowId('cnc', c);
      if (!await shouldApply(client, 'conciliaciones', key, sha(c), batchId)) continue;
      await client.query(
        `INSERT INTO conciliaciones (periodo, tipo, estado, resumen, creado_en)
         VALUES ($1, $2, COALESCE($3, 'pendiente'), $4::jsonb, NOW())`,
        [c.periodo || monthKey(new Date()), c.tipo || 'general', c.estado || 'pendiente', JSON.stringify(c.resumen || {})]
      );
    }

    if (payload.taxConfig) {
      const tc = payload.taxConfig;
      const key = `${tc.year || new Date().getFullYear()}-${tc.regime || '14D8'}`;
      if (await shouldApply(client, 'tax_config', key, sha(tc), batchId)) {
        await client.query(
          `INSERT INTO tax_config (anio, regimen, ppm_rate, ret_rate, iva_rate)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (anio, regimen)
           DO UPDATE SET ppm_rate=EXCLUDED.ppm_rate, ret_rate=EXCLUDED.ret_rate, iva_rate=EXCLUDED.iva_rate`,
          [Number(tc.year || new Date().getFullYear()), tc.regime || '14D8', Number(tc.ppmRate || 0.2), Number(tc.retentionRate || 14.5), Number(tc.ivaRate || 0.19)]
        );
      }
    }

    await client.query('UPDATE migration_batches SET status = $2, finished_at = NOW(), summary = $3::jsonb WHERE id = $1', [batchId, 'completed', JSON.stringify({ ...summary, checksum })]);
    await client.query('COMMIT');

    console.log(JSON.stringify({ ok: true, batchId, checksum, summary }, null, 2));
  } catch (err) {
    await client.query('ROLLBACK');
    try {
      await client.query('UPDATE migration_batches SET status = $2, finished_at = NOW() WHERE id = $1', [batchId, 'failed']);
    } catch (_) {}
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Error migrando store -> postgres:', err.message);
  process.exit(1);
});
