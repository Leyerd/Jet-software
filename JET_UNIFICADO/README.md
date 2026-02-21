# JET UNIFICADO (Guía para principiantes absolutos)

Este proyecto junta en **un solo software** todos los objetivos: contabilidad, tributación, inventario, conciliación y proyecciones.

## Estado actual
- ✅ Base unificada (web + api + db)
- ✅ Sprint 1 implementado (migración JSON + cierre contable + bloqueo)
- ✅ Sprint 2 implementado (auth+roles inicial, coherencia del backend y esquema DB ampliado)
- ✅ Sprint 3 iniciado (preparación PostgreSQL + scripts de migración)

- ✅ Sprint 3.1 iniciado (runtime PostgreSQL opcional + health DB real)
- ✅ Sprint 4 ejecutado (proyecciones financieras + QA smoke)
- ✅ Sprint 5 ejecutado (inventario + conciliación + QA runner estable)
- ✅ Sprint 6 ejecutado (motor tributario versionado, default 14D8 transparente)
- ✅ Sprint 7 ejecutado (kardex FIFO + costeo trazable por lotes)
- ✅ Sprint 8 ejecutado (conectores externos Alibaba, Mercado Libre y SII)

Documentos de avance:
- `docs/SPRINT_1.md`
- `docs/SPRINT_2.md`
- `docs/SPRINT_3.md`
- `docs/SPRINT_3_1.md`
- `docs/SPRINT_4.md`
- `docs/SPRINT_5.md`
- `docs/SPRINT_6.md`
- `docs/SPRINT_7.md`
- `docs/SPRINT_8.md`
- `docs/OBJETIVOS_1_AL_5_VALIDACION.md`

## Regla de trabajo acordada (importante)
Antes de cada sprint nuevo se debe ejecutar una verificación de coherencia del código completo.
Endpoints de apoyo:
- `GET /system/coherence-check`
- `GET /db/status`

## 1) ¿Qué necesitas instalar?

1. Docker Desktop
2. GitHub Desktop (opcional, más fácil que terminal)
3. Node.js (para ejecutar scripts locales de migración)

## 2) ¿Cómo iniciarlo por primera vez?

1. Abre una terminal en la carpeta `JET_UNIFICADO`.
2. Ejecuta:

```bash
docker compose up -d --build
```

3. Espera 1-3 minutos.
4. Abre en tu navegador:
   - Web (interfaz): `http://localhost:3000`
   - API (estado): `http://localhost:4000/health`

## 3) ¿Cómo apagarlo?

```bash
docker compose down
```

## 4) ¿Dónde está cada parte?

- Interfaz visual: `apps/web/index.html`
- API: `apps/api/server.js` y `apps/api/src/*`
- Persistencia temporal backend: `apps/api/data/store.json`
- Scripts de migración: `apps/api/scripts/*`
- Esquema SQL base: `db/schema.sql`
- Plan macro: `docs/PLAN_10_OBJETIVOS_IMPLEMENTACION.md`

## 5) ¿Es una sola versión?

Sí. Esta carpeta (`JET_UNIFICADO`) es la **única base** para evolucionar todo.
No necesitas crear 10 apps distintas: se implementa por módulos dentro de la misma.

## 6) Flujo rápido de prueba del Sprint 3

1) Estado de DB
```bash
curl -s http://localhost:4000/db/status
```

2) Verificación de coherencia
```bash
curl -s http://localhost:4000/system/coherence-check
```

3) Dry-run de migración a postgres
```bash
cd apps/api
npm install
npm run migrate:store:dry
```


## Problema reportado: `http://localhost:4000/health` rechazaba conexión

Causa corregida en el código: el contenedor API antes no incluía carpeta `src/` en la imagen Docker.

### Si te vuelve a pasar
1. Reconstruye contenedores:
```bash
docker compose down
docker compose up -d --build
```
2. Revisa estado:
```bash
docker compose ps
docker compose logs api --tail=100
```
3. Prueba salud API:
```bash
curl -s http://localhost:4000/health
```

## Sobre `npm run migrate:store:dry` en 0

Si te mostró todo en 0 y no tienes datos históricos, **está bien**.
Puedes partir desde base limpia sin problema y no necesitas migrar nada.


## Sprint 3.1: modo PostgreSQL real (opcional)

Si quieres guardar datos directo en PostgreSQL (en vez de archivo local):

1. Edita `docker-compose.yml` y cambia en `api.environment`:
```yaml
PERSISTENCE_MODE: postgres
```
2. Reconstruye:
```bash
docker compose down
docker compose up -d --build
```
3. Verifica:
```bash
curl -s http://localhost:4000/db/status
```

Si prefieres empezar simple, puedes dejar `PERSISTENCE_MODE: file` por ahora.


## Sprint 4: proyecciones financieras

Nuevo endpoint protegido:
```bash
GET /finance/projection
```

Para validar rápido:
```bash
cd apps/api
npm run qa:smoke
```


## Sprint 5: endpoints nuevos

- `GET /inventory/overview`
- `GET /reconciliation/summary`

QA recomendado (más estable):
```bash
cd apps/api
npm run qa:run
```


## Sprint 6: tributario (EIRL)

Endpoints:
- `GET /tax/config`
- `POST /tax/config`
- `GET /tax/summary`

Por defecto el sistema inicia en régimen transparente (`14D8`).


## Sprint 7: inventario profesional

Endpoints nuevos:
- `POST /inventory/import-lot`
- `POST /inventory/consume`
- `GET /inventory/kardex`

Estos endpoints implementan trazabilidad por lote y costeo FIFO.


## Sprint 8: conectores externos

Endpoints nuevos:
- `POST /integrations/config`
- `GET /integrations/status`
- `POST /integrations/alibaba/import-products`
- `POST /integrations/mercadolibre/import-orders`
- `POST /integrations/sii/import-rcv`

Con esto el backend único ya integra fuentes externas críticas para operación (Alibaba, Mercado Libre y SII).
