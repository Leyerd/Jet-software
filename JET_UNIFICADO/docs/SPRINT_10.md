# Sprint 10 - Pipeline de calidad y despliegue continuo

## Objetivo del sprint
Cumplir objetivo 10 configurando pipeline de calidad y base de despliegue continuo para el backend unificado.

## Implementación

### 1) Quality Gate automatizado
Se agregó script `apps/api/scripts/ci-check.js` que ejecuta:
1. validación sintáctica de todos los `.js` (`node --check`),
2. smoke end-to-end (`node scripts/qa-runner.js`).

Se incorporó script npm:
- `npm run ci:check`

### 2) CI en GitHub Actions
Nuevo workflow:
- `.github/workflows/ci.yml`

Acciones:
- checkout,
- setup Node 20,
- `npm install` en `JET_UNIFICADO/apps/api`,
- `npm run ci:check`.

### 3) CD base en GitHub Actions
Nuevo workflow:
- `.github/workflows/cd.yml`

Acciones:
- build de imágenes Docker (`apps/api`, `apps/web`),
- despliegue opcional por SSH + docker compose (requiere secrets):
  - `DEPLOY_HOST`
  - `DEPLOY_USER`
  - `DEPLOY_SSH_KEY`
  - `DEPLOY_PATH`

## Resultado
Queda establecida una tubería repetible para control de calidad automático y despliegue continuo controlado.

## Nota
La UI amigable se conserva sin cambios visuales; Sprint 10 se enfocó en operación y calidad de entrega.
