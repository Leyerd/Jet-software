# Sprint 1 - Implementación realizada

## Objetivo del sprint
Crear una base operativa real en backend para:
1. Migrar datos desde backup JSON del sistema actual.
2. Cerrar/reabrir períodos contables.
3. Bloquear registro de movimientos en períodos cerrados.
4. Registrar auditoría básica de eventos.

## Endpoints implementados

### Salud y módulos
- `GET /health`
- `GET /modules`

### Migración
- `POST /migration/import-json`
- `GET /migration/summary`

### Cierre contable
- `POST /periods/close`
- `POST /periods/reopen`
- `GET /periods`

### Operación básica
- `GET /products`
- `POST /products`
- `GET /movements`
- `POST /movements` (bloquea si período está cerrado)

## Ejemplos para probar (copiar y pegar)

### 1) Ver salud
```bash
curl -s http://localhost:4000/health
```

### 2) Importar backup JSON
```bash
curl -s -X POST http://localhost:4000/migration/import-json \
  -H "Content-Type: application/json" \
  -d @tu_backup.json
```

### 3) Cerrar período abril 2026
```bash
curl -s -X POST http://localhost:4000/periods/close \
  -H "Content-Type: application/json" \
  -d '{"anio":2026,"mes":4,"user":"dueno"}'
```

### 4) Intentar registrar movimiento en abril 2026 (debe bloquear)
```bash
curl -s -X POST http://localhost:4000/movements \
  -H "Content-Type: application/json" \
  -d '{"fecha":"2026-04-10","tipo":"VENTA","total":10000,"descripcion":"Prueba"}'
```

### 5) Reabrir período
```bash
curl -s -X POST http://localhost:4000/periods/reopen \
  -H "Content-Type: application/json" \
  -d '{"anio":2026,"mes":4,"user":"contador","motivo":"Ajuste"}'
```

## Limitaciones conocidas
- Persistencia actual del backend en archivo local (`apps/api/data/store.json`) para acelerar Sprint 1.
- Integración real con PostgreSQL se aborda en Sprint 2.
