# Meta 3 — Motor contable formal de doble partida

## Estado
Implementado baseline operativo:
- Asientos automáticos por evento desde `movements`.
- Publicación bloqueada si `debe != haber`.
- Estados contables: `borrador`, `publicado`, `reversado`.
- Reversa por API con trazabilidad.

## Endpoints
- `POST /accounting/entries`
- `POST /accounting/entries/publish`
- `POST /accounting/entries/reverse`
- `GET /accounting/entries`

## Reglas implementadas
- Reglas automáticas para tipos de movimiento: `VENTA`, `GASTO_LOCAL`, `IMPORTACION`, `COMPRA`, `HONORARIOS`, `COMISION_MARKETPLACE`.
- Al crear movimiento (`POST /movements`), se intenta generar asiento automático publicado con validación contable.
- Si un asiento no cuadra, la publicación responde `409` y no se publica.

## Gate Meta 3
- "Imposible publicar asiento descuadrado por API": implementado en `publishEntry` con validación estricta y rechazo `409`.

## Verificación rápida
```bash
cd JET_UNIFICADO
node scripts/verificar_meta3.js
```
