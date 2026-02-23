# Meta 6 — Conciliación documental inmutable e incremental

## Estado
Implementada en runtime PostgreSQL para evitar sobrescritura total y mantener historial auditable por lote.

## Entregables cubiertos

- **Modelo documental por lotes**
  - `ingestion_batches`: registra lote, checksum, fuente, período y usuario.
  - `documents_raw`: conserva evidencia inmutable por documento/lote (`payload` + `payload_hash`).
  - `documents_normalized`: vista operativa versionada por `source + doc_key`.

- **Import incremental con deduplicación**
  - Cada import crea un lote nuevo.
  - Deduplicación por llave documental y hash (`UNIQUE (source, doc_key, payload_hash)`).
  - Si un documento cambia, se incrementa `version` en `documents_normalized`.

- **Estados de conciliación**
  - `pendiente`, `conciliado`, `observado`, `resuelto`.
  - Endpoint para actualización de estado documental con auditoría.

## Endpoints nuevos/relevantes

- `POST /reconciliation/import/cartola`
- `POST /reconciliation/import/rcv-ventas`
- `POST /reconciliation/import/marketplace`
- `GET /reconciliation/documents`
- `POST /reconciliation/documents/status`
- `GET /reconciliation/summary`

## Gate de salida (Meta 6)

**Gate:** nunca se reemplaza todo; siempre se agrega lote y se versiona.

Se cumple porque:
- no hay reemplazo total de datasets en modo postgres;
- cada import persiste `ingestion_batches`;
- `documents_raw` sólo agrega evidencia (inmutable por hash);
- `documents_normalized` versiona en conflicto por `source+doc_key`.

## Verificación rápida

```bash
node JET_UNIFICADO/scripts/verificar_meta6.js
```

Debe retornar `meta6GateReached: true`.
