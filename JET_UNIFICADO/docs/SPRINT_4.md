# Sprint 4 - Proyecciones financieras + QA base

## Objetivo del sprint
1. Agregar un módulo financiero útil para gestión (escenarios de proyección).
2. Añadir una validación QA ejecutable para no romper lo básico en cada cambio.
3. Mantener compatibilidad con UI amigable existente.

## Qué se implementó

### 1) Nuevo endpoint de proyecciones
- `GET /finance/projection`
- Requiere autenticación (roles: dueño, contador, operador, auditor).
- Calcula escenarios desde movimientos del mes actual:
  - conservador,
  - base,
  - optimista.

### 2) Coherencia actualizada a Sprint 4
- `GET /system/coherence-check` ahora valida también:
  - `src/modules/finance.js`
  - `scripts/qa-smoke.js`

### 3) QA smoke automatizable
Script:
- `npm run qa:smoke`

Valida flujo mínimo:
- `/health`
- `register/login`
- `/finance/projection`
- `/system/coherence-check`

## Uso rápido

1) Levantar API
```bash
docker compose up -d --build
```

2) Ejecutar QA smoke (desde apps/api)
```bash
npm run qa:smoke
```

3) Consumir proyección con token Bearer
```bash
curl -s http://localhost:4000/finance/projection -H "Authorization: Bearer TU_TOKEN"
```

## Nota UX
En Sprint 4 se priorizó backend y calidad. La UI amigable actual se mantiene intacta y se reforzará en sprints frontend dedicados.
