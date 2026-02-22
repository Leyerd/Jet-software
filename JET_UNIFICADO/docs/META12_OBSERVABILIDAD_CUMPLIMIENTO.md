# Meta 12 — Observabilidad + cumplimiento operativo

## Estado
Implementada en API con logs estructurados, métricas de runtime, correlación por request y dashboard con alertas operativas.

## Entregables cubiertos

- **Logs estructurados (auditoría + app logs) con correlación por request**
  - Middleware de contexto con `AsyncLocalStorage` (`requestId`, `path`).
  - Header `X-Request-Id` en respuestas.
  - `logStructured(level,event,payload)` para eventos de aplicación y request.

- **Métricas operativas**
  - Conteo de requests, errores 5xx, rechazos 4xx, latencia promedio y p95.
  - Dashboard operacional expuesto por API.

- **Alertas operativas**
  - Fallos de sync (dead-letter).
  - Conciliación observada.
  - Intentos de mutación post-cierre.
  - Fallos de validación de restore de backup.

## Gate

- Dashboard mínimo operativo + alertas activas en staging/prod mediante `GET /observability/dashboard`.

## Endpoint

- `GET /observability/dashboard`

## Verificación rápida

```bash
node JET_UNIFICADO/scripts/verificar_meta12.js
```

Debe retornar `meta12GateReached: true`.
