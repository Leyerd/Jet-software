# Sprint 3.1 - Runtime PostgreSQL opcional (sin romper modo archivo)

## Qué cambia
Sprint 3.1 deja la API lista para correr en dos modos:

1. **Modo archivo** (actual por defecto)
2. **Modo PostgreSQL** (nuevo)

## Cambios técnicos
- `src/lib/store.js` ahora soporta persistencia por `PERSISTENCE_MODE`:
  - `file` -> usa `apps/api/data/store.json`
  - `postgres` -> usa tabla `app_state` en PostgreSQL
- `src/modules/db.js` ahora prueba conexión real cuando estás en modo postgres.
- `src/routes.js` se actualizó para manejo seguro de funciones async en todas las rutas.
- `apps/api/Dockerfile` instala dependencias para soportar `pg` dentro del contenedor.

## Cómo activar PostgreSQL runtime

En `docker-compose.yml`, servicio `api`, cambia:

```yaml
PERSISTENCE_MODE: file
```

por:

```yaml
PERSISTENCE_MODE: postgres
```

Luego reconstruye:

```bash
docker compose down
docker compose up -d --build
```

## Cómo verificar

```bash
curl -s http://localhost:4000/db/status
```

Debes ver:
- `"usingPostgres": true`
- `"connectionOk": true`

## Si vas a empezar desde cero
No necesitas migrar nada. Puedes usar modo postgres limpio directamente.
La tabla `app_state` se crea automáticamente en el primer acceso.
