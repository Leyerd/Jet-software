# Meta 9 — Integraciones empresariales seguras (SII y marketplaces)

## Estado
Implementada con conectores backend-first, scheduler con retries/dead-letter y estado operativo por conector.

## Entregables cubiertos

- **Conectores backend con credenciales seguras (secrets/env)**
  - Credenciales resueltas en backend (`ML_ACCESS_TOKEN`, `SII_API_KEY`, `ALIBABA_API_KEY`).
  - UI no transporta ni solicita token manual.

- **Scheduler de sincronización + retries + dead-letter**
  - Ejecución de sync por job con reintentos (`runSyncWithRetry`).
  - Registro de jobs (`integration_sync_jobs`) y cola de fallos (`integration_dead_letter`).

- **Registro de estado por conector**
  - Estado en `integration_provider_state`: `last_sync_at`, `last_error`, `last_latency_ms`, `last_volume`, `enabled`.
  - Logs recientes en `integration_sync_log`.

## Gate

- UI no solicita token manual de ML/SII en prompt.

## Endpoints relevantes

- `POST /integrations/config`
- `GET /integrations/status`
- `POST /integrations/sync/run`
- `GET /integrations/dead-letter`
- `POST /integrations/mercadolibre/import-orders`
- `POST /integrations/sii/import-rcv`

## Verificación rápida

```bash
node JET_UNIFICADO/scripts/verificar_meta9.js
```

Debe retornar `meta9GateReached: true`.
