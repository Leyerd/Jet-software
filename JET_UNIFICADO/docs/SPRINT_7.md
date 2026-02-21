# Sprint 7 - Inventario profesional con Kardex y costeo FIFO trazable

## Objetivo del sprint
Cumplir el objetivo 7:
- lotes de inventario,
- kardex de entradas/salidas,
- costeo trazable (FIFO).

## Endpoints nuevos
- `POST /inventory/import-lot`
- `POST /inventory/consume`
- `GET /inventory/kardex?productId=...`
- `GET /inventory/overview` (mejorado con métricas de lotes/kardex)

## Lógica implementada

### Entrada por lote
`POST /inventory/import-lot`
- Crea lote con cantidad, costo unitario y fecha de ingreso.
- Actualiza stock y costo promedio del producto.
- Registra movimiento de kardex `IN` con trazabilidad de lote.

### Salida con FIFO
`POST /inventory/consume`
- Consume stock desde lotes más antiguos primero (FIFO).
- Registra movimientos `OUT` en kardex por cada lote afectado.
- Devuelve asignaciones detalladas por lote y costo total de salida.

### Kardex consultable
`GET /inventory/kardex`
- Retorna movimientos ordenados por fecha.
- Permite filtrar por producto.

## Validación
Se incorporó al QA smoke:
1. crear producto,
2. importar lote,
3. consumir stock,
4. validar kardex.

## Nota
La UI amigable original se mantiene sin cambios visuales en este sprint.
