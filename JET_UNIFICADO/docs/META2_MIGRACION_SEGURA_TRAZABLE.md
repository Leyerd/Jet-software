# Meta 2 — Migración de datos segura y trazable

## Estado
Implementado flujo de migración con:
- Script idempotente con checksum por lote.
- Informe de reconciliación post-migración con diferencias objetivo = 0.
- Rollback/reset documentado y comando operativo.

## Scripts
Desde `JET_UNIFICADO/apps/api`:

1. Dry run (sin tocar DB)
```bash
npm run migrate:store:dry
```

2. Migración real a PostgreSQL
```bash
export DATABASE_URL="postgresql://jet_user:jet_pass@localhost:5432/jet_erp"
npm run migrate:store:postgres
```

3. Reconciliación post-migración
```bash
npm run migrate:reconcile
```
Genera: `JET_UNIFICADO/docs/MIGRATION_RECONCILIATION_REPORT.json`.

4. Export de snapshot desde PostgreSQL
```bash
npm run migrate:postgres:store
```
Genera: `JET_UNIFICADO/apps/api/data/store.export.json`.

5. Rollback/reset de staging (vacía datos para repetir migración)
```bash
npm run migrate:rollback:reset
```

---

## Idempotencia y trazabilidad
La migración registra:
- `migration_batches` (batch_id, checksum, estado, resumen).
- `migration_rows` (entidad + row_key + checksum + batch_id).

Si se ejecuta nuevamente el mismo payload (mismo checksum), se marca como **skipped** sin duplicar.

---

## Reconciliación de integridad
El reporte compara origen vs destino para:
- usuarios, sesiones, cuentas, terceros, productos, movimientos,
- flujo de caja, periodos, asientos, líneas, lotes, kardex,
- documentos fiscales, conciliaciones.

Además valida sumas de control:
- `SUM(movimientos.total)`
- `SUM(flujo_caja.monto)`

Criterio de aprobación: **diferencias 0** en conteos y sumas control.

---

## Rollback documentado
Dado que hoy no hay datos críticos, el rollback recomendado para staging es:

1. Export opcional de respaldo:
```bash
npm run migrate:postgres:store
```

2. Reset de tablas operativas:
```bash
npm run migrate:rollback:reset
```

3. Re-ejecutar migración y reconciliación:
```bash
npm run migrate:store:postgres
npm run migrate:reconcile
```

4. Aceptar solo si reconciliación devuelve diferencias 0.
