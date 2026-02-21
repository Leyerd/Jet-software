# JET UNIFICADO (Guía para principiantes absolutos)

Este proyecto junta en **un solo software** todos los objetivos: contabilidad, tributación, inventario, conciliación y proyecciones.

## Estado actual
- ✅ Base unificada (web + api + db)
- ✅ **Sprint 1 implementado** en backend:
  - migración de backup JSON,
  - cierre/reapertura de período,
  - bloqueo de movimientos en períodos cerrados,
  - auditoría básica de eventos.

Detalle técnico del sprint: `docs/SPRINT_1.md`.

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
- Base de datos (estructura siguiente fase): `db/schema.sql`
- Plan macro: `docs/PLAN_10_OBJETIVOS_IMPLEMENTACION.md`
- Avance Sprint 1: `docs/SPRINT_1.md`

## 5) ¿Es una sola versión?

Sí. Esta carpeta (`JET_UNIFICADO`) es la **única base** para evolucionar todo.
No necesitas crear 10 apps distintas: se implementa por módulos dentro de la misma.

## 6) Flujo rápido de prueba del Sprint 1

Con el stack arriba, prueba estos pasos:

1. Ver salud de API:
```bash
curl -s http://localhost:4000/health
```

2. Cerrar período:
```bash
curl -s -X POST http://localhost:4000/periods/close -H "Content-Type: application/json" -d '{"anio":2026,"mes":4,"user":"dueno"}'
```

3. Intentar crear movimiento en ese mes (debe bloquear):
```bash
curl -s -X POST http://localhost:4000/movements -H "Content-Type: application/json" -d '{"fecha":"2026-04-10","tipo":"VENTA","total":10000}'
```
