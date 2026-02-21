# JET UNIFICADO (Guía para principiantes absolutos)

Este proyecto junta en **un solo software** todos los objetivos: contabilidad, tributación, inventario, conciliación y proyecciones.

## Estado actual
- ✅ Base unificada (web + api + db)
- ✅ Sprint 1 implementado (migración JSON + cierre contable + bloqueo)
- ✅ Sprint 2 implementado (auth+roles inicial, coherencia del backend y esquema DB ampliado)

Documentos de avance:
- `docs/SPRINT_1.md`
- `docs/SPRINT_2.md`

## Regla de trabajo acordada (importante)
Antes de cada sprint nuevo se debe ejecutar una verificación de coherencia del código completo.
En Sprint 2 ya existe endpoint para apoyo:
- `GET /system/coherence-check`

## 1) ¿Qué necesitas instalar?

1. Docker Desktop
2. GitHub Desktop (opcional, más fácil que terminal)

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
- Esquema SQL base: `db/schema.sql`
- Plan macro: `docs/PLAN_10_OBJETIVOS_IMPLEMENTACION.md`

## 5) ¿Es una sola versión?

Sí. Esta carpeta (`JET_UNIFICADO`) es la **única base** para evolucionar todo.
No necesitas crear 10 apps distintas: se implementa por módulos dentro de la misma.

## 6) Flujo rápido de prueba del Sprint 2

1) Registrar usuario dueño
```bash
curl -s -X POST http://localhost:4000/auth/register -H "Content-Type: application/json" -d '{"nombre":"Dueño","email":"dueno@jet.cl","password":"123456","rol":"dueno"}'
```

2) Hacer login
```bash
curl -s -X POST http://localhost:4000/auth/login -H "Content-Type: application/json" -d '{"email":"dueno@jet.cl","password":"123456"}'
```

3) Revisar coherencia backend
```bash
curl -s http://localhost:4000/system/coherence-check
```
