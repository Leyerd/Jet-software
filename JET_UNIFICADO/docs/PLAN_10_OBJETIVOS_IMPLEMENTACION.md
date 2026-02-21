# Plan de implementación único (10 objetivos en un solo software)

Este documento explica cómo ejecutar en paralelo los 10 objetivos sin crear versiones separadas.

## Enfoque único
- **Un solo frontend** (`apps/web`) para toda la experiencia visual.
- **Un solo backend** (`apps/api`) con módulos internos por dominio.
- **Una sola base de datos** (`db`) para toda la operación.
- **Una sola ruta de despliegue** (`docker-compose.yml`).

## Mapa de módulos dentro de la misma app
1. Arquitectura base: `apps/web`, `apps/api`, `db`
2. Migración de datos: módulo `api/migration`
3. Cierre contable: módulo `api/accounting-close`
4. Conciliación documental: módulo `api/reconciliation`
5. Motor tributario: módulo `api/tax-engine`
6. Inventario/kardex: módulo `api/inventory`
7. Integraciones: módulo `api/integrations`
8. Seguridad/backups: módulo `api/security`
9. Proyecciones: módulo `api/finance`
10. QA/CI-CD: `.github/workflows` + tests

## Fases de ejecución (paralelo controlado)

### Fase 0 - Fundaciones (semana 1)
- Levantar stack con Docker.
- Migrar `Contabilidad` a `apps/web/index.html` para mantener UX.
- Crear esquema SQL inicial.

### Fase 1 - Núcleo de datos y seguridad (semanas 2-4)
- Usuarios/roles, tablas principales, bitácora, backups.
- API CRUD para productos/movimientos/cuentas.

### Fase 2 - Tributario + cierre + conciliación (semanas 5-8)
- Motor F29/F22/DDJJ versionado.
- Cierre mensual con bloqueo.
- Conciliación bancaria y documental.

### Fase 3 - Integraciones + inventario avanzado (semanas 9-12)
- Sync Mercado Libre.
- Kardex y costeo por lote.

### Fase 4 - Proyecciones + QA + producción (semanas 13-16)
- Escenarios financieros.
- Pipeline CI/CD y despliegue final.

## Criterio para evitar "múltiples versiones"
- No crear otro proyecto nuevo por cada objetivo.
- Cada objetivo se implementa como **módulo** dentro del mismo backend/frontend.
- Todo se valida en un único ambiente staging y luego producción.
