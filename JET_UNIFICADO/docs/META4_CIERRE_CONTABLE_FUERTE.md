# Meta 4 — Cierre contable fuerte e irreversible controlado

## Estado
Implementación base completada para control fuerte de cierre mensual:
- Cierre por período con hash de integridad.
- Bloqueo transversal de mutaciones sobre períodos cerrados.
- Reapertura con workflow de aprobación y motivo.
- Bitácora de auditoría para cierre/reapertura.

## Entregables implementados
1. **Hash de cierre**
   - En cierre de período se genera snapshot contable+tributario y `cierreHash` (`sha256`).
   - Para postgres se persiste en `periodos_contables.cierre_hash` y `periodos_contables.cierre_snapshot`.

2. **Bloqueo de mutaciones**
   - Helper central: `assertPeriodOpenForDate`.
   - Aplicado en mutaciones de:
     - `movements`
     - `inventory` (import lot / consume)
     - `reconciliation` (imports)
     - `integrations` (imports con fecha)
     - `journal` (create/reverse)

3. **Reapertura con workflow**
   - `POST /periods/reopen` exige:
     - `motivo` mínimo,
     - `aprobadoPor` obligatorio,
     - `aprobadoPor` debe ser usuario con rol `dueno`.

4. **Auditoría**
   - Registro de `period.close` y `period.reopen` con metadata de hash/aprobación.

## Gate Meta 4
- Cualquier mutación sobre período cerrado debe fallar salvo reapertura autorizada.
- Se verifica mediante script:
```bash
cd JET_UNIFICADO
node scripts/verificar_meta4.js
```
