# Meta 15 — Pack fiscalizador + simulador de riesgo + dashboard ejecutivo EIRL

## Estado
Implementada base operativa con generación de paquete fiscalizador, simulación de riesgo esperado por obligación y panel ejecutivo EIRL.

## Entregables cubiertos

- **Pack de auditoría exportable para fiscalización**
  - Endpoint `GET /executive/audit-package` que agrupa movimientos, obligaciones, evidencias y bitácora por período.
  - Hashes por bloque + `hashChain` para reproducibilidad e integridad.

- **Simulador de multa/riesgo**
  - Endpoint `GET /executive/risk-simulation`.
  - Cálculo de `expectedRisk` por obligación con exposición/probabilidad y orden de priorización.

- **Dashboard ejecutivo EIRL**
  - Endpoint `GET /executive/dashboard` con métricas de caja, margen, cumplimiento y riesgo esperado.
  - Vista frontend dedicada en pestaña `Ejecutivo EIRL`.

## Gate

- Sistema genera paquete fiscalizador por período con hash chain reproducible.
- Riesgo esperado queda priorizado para trabajo operativo.
- Dirección visualiza cumplimiento + financiero + riesgo en panel único.

## Verificación rápida

```bash
node JET_UNIFICADO/scripts/verificar_meta15.js
```

Debe retornar `meta15GateReached: true`.
