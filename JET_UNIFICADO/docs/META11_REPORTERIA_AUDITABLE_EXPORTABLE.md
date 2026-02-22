# Meta 11 — Reportería auditable y exportable

## Estado
Implementada en API con reportes contables/tributarios, exportación multi-formato y hash reproducible.

## Entregables cubiertos

- **Reportes profesionales**
  - Libro Diario, Mayor, Balance, Estado de Resultados, IVA compras/ventas y anexos.

- **Exportación CSV/XLSX/PDF con metadata**
  - Export en `GET /reports/export` con formatos `csv|xlsx|pdf`.
  - Metadata embebida: `hash`, `generatedBy`, `generatedAt`, período.

- **Trazabilidad al origen**
  - Cada línea de Diario referencia origen (`movimientos.id`).
  - Anexos incluyen `sourceTables` y `sourceIds`.

## Gate

- Reportes reproducibles: misma data => mismo hash (`hashObject` sobre canonical JSON).

## Endpoints

- `GET /reports?year=2026&month=1`
- `GET /reports/export?report=diario&format=csv&year=2026&month=1`

## Verificación rápida

```bash
node JET_UNIFICADO/scripts/verificar_meta11.js
```

Debe retornar `meta11GateReached: true`.
