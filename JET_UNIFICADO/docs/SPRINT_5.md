# Sprint 5 - Inventario + Conciliación + QA Runner estable

## Objetivo del sprint
1. Entregar endpoints operativos para inventario y conciliación documental/bancaria.
2. Evitar el problema intermitente del one-liner de QA.
3. Mantener la base compatible con la UI amigable actual.

## Qué se implementó

### 1) Inventario overview
Endpoint:
- `GET /inventory/overview`

Retorna:
- total de productos,
- conteo bajo stock,
- conteo sin stock,
- valorización total de inventario,
- listado de productos en bajo stock.

### 2) Conciliación resumen
Endpoint:
- `GET /reconciliation/summary`

Retorna por período (YYYY-MM):
- ventas,
- flujo neto caja,
- diferencia,
- estado (`conciliado` u `observado`).

### 3) QA estable sin one-liner frágil
- `qa:smoke` ahora valida también inventario y conciliación.
- Nuevo script `qa:run` levanta servidor + ejecuta smoke + lo cierra automáticamente.

Comando recomendado:
```bash
cd JET_UNIFICADO/apps/api
npm run qa:run
```

## Respuesta al problema reportado de `node` intermitente
Sí, ese fallo puede ocurrir en one-liners largos con procesos en background y entornos shell variables.
Con Sprint 5 se evita ese patrón usando `qa:run`, que es más estable y reproducible.

## Nota UX
No se modificó la UI visual en este sprint para no romper experiencia existente.
