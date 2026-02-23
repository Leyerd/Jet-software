# Meta 10 — Frontend desacoplado de localStorage como fuente primaria

## Estado
Implementada con bootstrap de estado principal desde backend y API client unificado en frontend.

## Entregables cubiertos

- **Capa API client unificada**
  - Frontend usa `apiClient` central (`request/get/post`) para llamadas backend.

- **Estado principal desde backend**
  - Arranque de UI con `bootstrapFromBackend()` consumiendo `GET /system/frontend-state`.
  - `localStorage` no se usa como fuente de verdad operacional.

- **Unificación régimen por defecto 14D8**
  - Frontend mantiene default `14D8`.
  - Backend expone default `14D8` en estado inicial para frontend.

## Gate

- Operación completa funciona aunque localStorage esté vacío.

## Endpoints relevantes

- `GET /system/frontend-state`
- `POST /integrations/sync/run`

## Verificación rápida

```bash
node JET_UNIFICADO/scripts/verificar_meta10.js
```

Debe retornar `meta10GateReached: true`.
