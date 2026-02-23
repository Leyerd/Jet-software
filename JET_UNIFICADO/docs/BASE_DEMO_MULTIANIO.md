# Base de datos ficticia multianual (2024-2026)

Se añadió un script para cargar datos de prueba coherentes en `apps/api/data/store.json`.

## Script
- `scripts/seed_demo_multiyear.js`

## Qué carga
- Productos de ejemplo (textil/calzado).
- Movimientos de `VENTA`, `GASTO` e `IMPORTACION` para 2024, 2025 y 2026.
- Cuentas, terceros, periodos y configuración tributaria base.

## Uso
```bash
node JET_UNIFICADO/scripts/seed_demo_multiyear.js
```

Luego inicia JET (launcher o Docker) y revisa dashboard, libro diario, reportes y panel ejecutivo.

## Nota
- Es una base de pruebas para inspección funcional.
- Puedes volver al estado limpio reemplazando `apps/api/data/store.json` por tu backup.

## Botón directo en UI
En `Backup` ahora existe el botón **Cargar Demo 2024-2026**, que llama al endpoint `POST /system/load-demo-data` y refresca la UI backend-first automáticamente.


## Si aparece HTTP 404 al cargar demo
Normalmente significa que el contenedor API aún está con imagen antigua. Ejecuta:

```bash
docker compose down
docker compose up -d --build
```
