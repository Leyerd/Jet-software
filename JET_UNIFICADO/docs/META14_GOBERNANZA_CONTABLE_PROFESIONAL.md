# Meta 14 — Gobernanza contable profesional

## Estado
Implementada base operativa con plan de cuentas parametrizable, reglas contables por operación, consistencia cruzada y flujo de aprobación crítica.

## Entregables cubiertos

- **Plan de cuentas profesional parametrizable**
  - Endpoint para consultar/actualizar catálogo de cuentas y centros de costo.

- **Reglas contables por operación real**
  - Endpoint para consultar/actualizar reglas de asiento por tipo de evento.

- **Validadores de consistencia cruzada**
  - Check automático de diferencias: ventas vs RCV, ventas vs flujo, inventario vs costo.

- **Aprobación dual para acciones críticas**
  - Solicitud/aprobación de requests críticos (`period.close`, `period.reopen`, rectificación).
  - `accountingClose` exige `approvalRequestId` aprobado para cerrar/reabrir período.

## Endpoints

- `GET/POST /accounting/chart`
- `GET/POST /accounting/rules`
- `GET /accounting/consistency-check`
- `POST /accounting/approval/request`
- `POST /accounting/approval/approve`

## Gate

- Cierres/reaperturas requieren request aprobado.
- Validadores cruzados operativos y visibles por API/UI.

## Verificación rápida

```bash
node JET_UNIFICADO/scripts/verificar_meta14.js
```

Debe retornar `meta14GateReached: true`.
