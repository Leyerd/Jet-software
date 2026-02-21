# Corrección Punto 0 - Brechas de código (ajustes inmediatos)

## Cambios aplicados
1. `docker-compose.yml`
   - API cambia por defecto a `PERSISTENCE_MODE: postgres`.

2. `auth`
   - Se elimina hash simple SHA-256.
   - Se implementa hash de contraseña con `scrypt` + `salt` + comparación `timingSafeEqual`.

3. `reconciliation`
   - Importadores pasan de reemplazo total de dataset a inserción incremental con deduplicación:
     - cartola
     - RCV ventas
     - marketplace

4. `frontend`
   - Régimen por defecto alineado a `14D8`.
   - Se elimina sincronización directa con token en prompt a Mercado Libre y se envía importación vía backend.

5. `db/status`
   - Metadato de sprint actualizado.

## Pendientes (no resueltos en este ajuste)
- Migración completa de `app_state` a operación 100% relacional por tabla en runtime.
- Eliminar completamente `localStorage` como fuente primaria del frontend.
- Conectores SII/marketplace totalmente automatizados con credenciales seguras en backend.
