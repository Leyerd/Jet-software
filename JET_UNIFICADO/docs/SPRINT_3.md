# Sprint 3 - Preparación PostgreSQL + migración guiada

## Objetivo del sprint
1. Mantener coherencia del backend antes de avanzar.
2. Preparar transición de persistencia desde archivo local hacia PostgreSQL.
3. Entregar herramientas de migración simples para no técnicos (con comandos listos).

## Qué se implementó

### 1) Endpoint de estado de base de datos
- `GET /db/status`
- Informa:
  - modo de persistencia (`PERSISTENCE_MODE`),
  - si `pg` está disponible,
  - si `DATABASE_URL` está configurada.

### 2) Scripts de migración de datos
Ubicación: `apps/api/scripts`

- `migrate-store-to-postgres.js`
  - `--dry-run`: muestra cuántos registros migrará.
  - modo normal: escribe el estado runtime en PostgreSQL (`app_state.key = jet_store_runtime`).

- `migrate-postgres-to-store.js`
  - exporta desde PostgreSQL hacia `apps/api/data/store.json`.

### 3) Schema SQL preparado para runtime state
Se agregó en `db/schema.sql`:
- tabla `app_state (key, value jsonb, updated_at)`

Esto permite transición segura sin romper compatibilidad con módulos existentes.

## Cómo usarlo (paso a paso)

### Paso 1: instalar dependencias API
```bash
cd JET_UNIFICADO/apps/api
npm install
```

### Paso 2: prueba de migración sin riesgo
```bash
npm run migrate:store:dry
```

### Paso 3: migrar a PostgreSQL real
```bash
export DATABASE_URL='postgresql://jet_user:jet_pass@localhost:5432/jet_erp'
npm run migrate:store:postgres
```

### Paso 4 (opcional): volver a archivo local
```bash
export DATABASE_URL='postgresql://jet_user:jet_pass@localhost:5432/jet_erp'
npm run migrate:postgres:store
```

## Nota sobre UI amigable
Tu interfaz original sigue intacta en:
- `apps/web/index.html`

En Sprint 3 no se tocó UI para priorizar persistencia y migración. El objetivo de mantener diseño moderno, iconos claros y botones amigables se mantiene para los sprints de frontend.
