# Sprint 9 - Autenticación, roles y políticas de respaldo

## Objetivo del sprint
Cumplir objetivo 9 fortaleciendo seguridad operacional:
- autenticación y sesiones,
- control por roles,
- políticas de respaldo y restauración auditada.

## Implementación

### 1) Endurecimiento de autenticación
- Política de contraseña mínima en registro:
  - al menos 8 caracteres,
  - mayúscula,
  - minúscula,
  - número.
- Expiración de sesión por TTL (`SESSION_TTL_HOURS`, por defecto 12h).
- Nuevo endpoint de cierre de sesión:
  - `POST /auth/logout`

### 2) Módulo de respaldos
Nuevo módulo `src/modules/backup.js` con endpoints:
- `GET /backup/policy`
- `POST /backup/policy`
- `POST /backup/create`
- `GET /backup/list`
- `POST /backup/restore` (solo `dueno`)

Características:
- respaldo snapshot en `apps/api/data/backups/*.json`,
- retención configurable (`retentionMaxFiles`),
- limpieza automática de backups antiguos,
- trazabilidad en `auditLog` para cambios de política, creación y restore.

## Validación
Se extendió QA smoke para validar:
1. flujo auth con contraseña robusta,
2. consulta política de backup,
3. creación de backup,
4. listado de backups,
5. logout.

## Nota
La interfaz visual amigable se mantiene intacta; este sprint prioriza robustez backend y cumplimiento.
