# Sprint 8 - Conectores de integraciones externas en backend único

## Objetivo del sprint
Cumplir objetivo 8 incorporando conectores externos dentro del backend unificado (`apps/api`) para:
- Alibaba (catálogo/productos),
- Mercado Libre (órdenes/liquidaciones),
- SII (RCV ventas/compras).

## Endpoints nuevos
- `POST /integrations/config`
- `GET /integrations/status`
- `POST /integrations/alibaba/import-products`
- `POST /integrations/mercadolibre/import-orders`
- `POST /integrations/sii/import-rcv`

## Lógica implementada
- Se agregó módulo `src/modules/integrations.js` con control de roles y auditoría.
- Se incorporó estado persistente para integraciones:
  - `integrationConfigs`
  - `integrationSyncLog`
  - `rcvCompras` (además de `rcvVentas` existente)
- Alibaba: upsert de productos por SKU.
- Mercado Libre: import de órdenes evitando duplicados por `orderId` + generación de movimiento de ingreso (`venta_marketplace`).
- SII: import de RCV (ventas/compras) evitando duplicados por `folio-fecha`.

## Validación
Se extendió `scripts/qa-smoke.js` para validar:
1. import Alibaba,
2. import Mercado Libre,
3. import SII,
4. consulta de estado de integraciones.

## Nota
Se mantiene la UI original sin cambios visuales en este sprint, priorizando consolidación backend.
