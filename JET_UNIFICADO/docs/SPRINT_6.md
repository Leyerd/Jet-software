# Sprint 6 - Motor tributario versionado (EIRL, default transparente)

## Objetivo del sprint
Implementar el objetivo 6:
- motor tributario versionado por año y régimen,
- con **régimen transparente (14D8) por defecto**,
- y cálculo alternativo para régimen general (14D3).

## Endpoints nuevos
- `GET /tax/config`
- `POST /tax/config`
- `GET /tax/summary`

## Lógica aplicada

### Configuración tributaria
Por defecto se inicializa:
- `regime: 14D8` (Transparente)
- `ppmRate: 0.2`
- `ivaRate: 0.19`
- `retentionRate: 14.5`

### Resumen tributario (`/tax/summary`)
Entrega:
- **F29 mensual estimado**: débito, crédito, retenciones, PPM, IVA a pagar, total a pagar.
- **F22 anual estimado**:
  - RLI (ventas netas - costos - gastos)
  - cálculo por régimen seleccionado
  - cálculo alternativo del otro régimen para comparación.

## Notas EIRL
- Se considera contexto EIRL en el bloque de `assumptions`.
- Régimen transparente queda como predeterminado, pero puedes cambiar a general cuando quieras.

## Ejemplos rápidos
```bash
# Ver config vigente
curl -s http://localhost:4000/tax/config -H "Authorization: Bearer TU_TOKEN"

# Cambiar a regimen general
curl -s -X POST http://localhost:4000/tax/config \
  -H "Authorization: Bearer TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"regime":"14D3","ppmRate":0.25}'

# Ver resumen
curl -s http://localhost:4000/tax/summary -H "Authorization: Bearer TU_TOKEN"
```
