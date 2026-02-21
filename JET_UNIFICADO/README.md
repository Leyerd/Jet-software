# JET UNIFICADO (Guía para principiantes absolutos)

Este proyecto junta en **un solo software** todos los objetivos: contabilidad, tributación, inventario, conciliación y proyecciones.

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
- API: `apps/api/server.js`
- Base de datos (estructura): `db/schema.sql`
- Plan de implementación completo: `docs/PLAN_10_OBJETIVOS_IMPLEMENTACION.md`

## 5) ¿Es una sola versión?

Sí. Esta carpeta (`JET_UNIFICADO`) es la **única base** para evolucionar todo.
No necesitas crear 10 apps distintas: se implementa por módulos dentro de la misma.

## 6) Siguiente paso recomendado

Después de levantarlo, el equipo técnico debe implementar los módulos en este orden:
1. Seguridad y usuarios
2. Migración de datos históricos
3. Cierre contable
4. Conciliación
5. Motor tributario
6. Inventario avanzado
7. Integraciones Mercado Libre
8. Proyecciones
9. QA y despliegue
