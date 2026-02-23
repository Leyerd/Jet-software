# Meta 13 — Calendario legal + semáforo tributario + evidencia automática

## Estado
Implementada en API con calendario legal por período, semáforo tributario diario, workflow de evidencia por obligación y alertas de escalamiento.

## Entregables cubiertos

- **Motor de calendario legal**
  - Obligaciones base parametrizadas para EIRL: F29, DDJJ, F22 y Patente.
  - Cálculo de due date con ajuste a día hábil (fin de semana).

- **Semáforo tributario diario**
  - Clasificación `verde | amarillo | rojo` según estado de obligación y cercanía/vencimiento.

- **Evidencia automática por obligación**
  - Lifecycle: `preparado -> validado -> enviado -> acuse`.
  - Registro de evidencia con hash reproducible (`sha256`) y trazabilidad de usuario/fecha.

- **Alertas escaladas**
  - Generación de alertas por vencimiento y hitos de escalamiento (7/3/1 días por defecto).
  - Configuración de canales (email/webhook) en runtime.

## Endpoints

- `GET /compliance/calendar?year=2026&month=3`
- `GET /compliance/semaphore?year=2026&month=3`
- `POST /compliance/evidence`
- `POST /compliance/config`

## Gate

- Todas las obligaciones críticas del período tienen fecha y estado.
- Las obligaciones enviadas pueden registrar acuse con hash y evidencia.
- El semáforo operativo y escalamiento se genera automáticamente.

## Verificación rápida

```bash
node JET_UNIFICADO/scripts/verificar_meta13.js
```

Debe retornar `meta13GateReached: true`.
