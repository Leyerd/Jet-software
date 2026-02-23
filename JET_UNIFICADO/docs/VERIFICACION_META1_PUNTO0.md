# Verificación de Punto 0 y Meta 1

Fecha: generada con `node scripts/verificar_meta1_punto0.js`.

## Resultado ejecutivo
- **Punto 0**: **8/8 brechas corregidas**.
- **Meta 1**: **9/9 señales clave cumplidas**.
- **Gate Meta 1** (**ningún endpoint crítico de negocio depende de store.json en runtime postgres**): **CUMPLIDO**.

## Punto 0 (estado actual)

### Corregidas
1. API por defecto en PostgreSQL en `docker-compose.yml`.
2. Auth ya no usa `sha256`; usa `scrypt`.
3. Conciliación ya no reemplaza datasets completos por asignación directa.
4. Frontend alinea régimen por defecto a `14D8`.
5. UI no solicita token manual de Mercado Libre.
6. Frontend no usa `localStorage` como fuente operativa principal.
7. Runtime postgres eliminó el uso de `app_state` como bloque JSON global.
8. Motor de doble partida operativo con publicación validada (`debe = haber`).

## Meta 1 (Plataforma de datos productiva)

### Entregables verificados
- Repositorios/operación por tablas en runtime postgres para módulos críticos:
  - Auth (`usuarios`, `sesiones`)
  - Productos (`productos`)
  - Movimientos (`movimientos`)
  - Periodos (`periodos_contables`)
  - Asientos (`asientos_contables`, `asiento_lineas`)
  - Inventario (`lotes_inventario`, `kardex_movimientos`)
  - Tributario (`tax_config`)
  - Conciliación/documentos (`documentos_fiscales`, `reconciliation_documents`)
  - Integraciones (`integration_provider_state`, `integration_sync_log`)
  - Backups/política (`backups`, `backup_policy_runtime`)
- `PERSISTENCE_MODE=postgres` por defecto en compose.
- Escrituras de negocio en `app_state` removidas del runtime postgres.

## Conclusión
- **Punto 0**: corregido completamente.
- **Meta 1**: cumplida según los gates y señales verificadas automáticamente.
