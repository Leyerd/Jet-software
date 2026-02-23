# Meta 5 — Motor tributario Chile versionado (régimen/año/formulario)

## Estado
Implementado en API con catálogo normativo versionado, cálculo F29/F22 y trazabilidad por regla aplicada.

## Entregables cubiertos

- **Catálogo normativo versionado** por año/régimen en `apps/api/src/modules/tax.js`:
  - Año de referencia: `2026`.
  - Regímenes: `14D8` (default) y `14D3` (alterno).
  - Versionado explícito (`version`) y fuente (`source`).
- **Motor F29/F22** con reglas explícitas y casillas:
  - F29: débito, crédito, PPM y retenciones (casillas trazables).
  - F22: RLI + resolución por régimen (atribución transparente 14D8 / IDPC 14D3).
- **RLI + base DDJJ**:
  - Cálculo de componentes (`ventasNetas`, `costos`, `gastos`, `rli`).
  - Base referencial DDJJ según régimen.

## Endpoints relevantes

- `GET /tax/catalog?year=2026&regime=14D8`
- `GET /tax/config`
- `POST /tax/config`
- `GET /tax/summary?year=2026&month=1`

## Gate de salida (Meta 5)

**Gate:** cada cálculo tributario retorna trazabilidad con regla aplicada + versión normativa + fuente.

Se cumple en `GET /tax/summary` mediante:

- `f29.trace.rulesApplied`, `version`, `source`
- `f22.rli.trace.rulesApplied`, `version`, `source`
- `f22.selectedRegime.trace.rulesApplied`, `version`, `source`
- `trace.appliedRules`, `version`, `source`

## Verificación rápida

Desde la raíz del repo:

```bash
node JET_UNIFICADO/scripts/verificar_meta5.js
```

El check retorna `meta5GateReached: true` cuando todos los criterios están presentes.
