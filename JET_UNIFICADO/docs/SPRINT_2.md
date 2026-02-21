# Sprint 2 - Coherencia + Seguridad inicial + Esquema DB ampliado

## Objetivo del sprint
1. Verificar coherencia lógica antes de iniciar Sprint 2.
2. Agregar autenticación básica y roles.
3. Endurecer reglas de cierre/reapertura por permisos.
4. Ampliar esquema de base de datos para operación contable-tributaria.

## Verificación previa (obligatoria antes de cada sprint)
Antes de implementar Sprint 2 se ejecutó:
- validación sintáctica de todos los archivos `*.js` de la API (`node --check`),
- smoke test de API Sprint 1 (`health`, `periods/close`, bloqueo de `movements`).

## Cambios implementados

### 1) Seguridad mínima por roles
Nuevas rutas:
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`

Roles soportados:
- `dueno`
- `contador_admin`
- `operador`
- `auditor`

### 2) Permisos en operaciones críticas
- `POST /periods/close`: permitido a `dueno`, `contador_admin`.
- `POST /periods/reopen`: permitido solo a `contador_admin`.
- `POST /migration/import-json`: permitido a `dueno`, `contador_admin`.
- `GET /migration/summary`: permitido a `dueno`, `contador_admin`, `auditor`.
- `GET/POST /products` y `GET/POST /movements`: protegidos por rol.

### 3) Coherence check de sistema
Nueva ruta:
- `GET /system/coherence-check`

Valida presencia de archivos críticos de backend para evitar iniciar un sprint con estructura incompleta.

### 4) Esquema DB contable-tributario ampliado
`db/schema.sql` ahora contempla tablas clave para:
- usuarios/sesiones,
- terceros/cuentas/flujo de caja,
- inventario (lotes + kardex),
- movimientos y documentos fiscales,
- periodos contables,
- asientos y líneas,
- conciliaciones,
- configuración tributaria,
- bitácora y backups.

## Ejemplo de uso rápido

1) Registrar usuario dueño
```bash
curl -s -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Dueño","email":"dueno@jet.cl","password":"123456","rol":"dueno"}'
```

2) Login
```bash
curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dueno@jet.cl","password":"123456"}'
```

3) Cerrar período con token Bearer
```bash
curl -s -X POST http://localhost:4000/periods/close \
  -H "Authorization: Bearer TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"anio":2026,"mes":6}'
```

## Pendiente para Sprint 3
- Persistencia real en PostgreSQL para runtime (hoy runtime sigue en archivo JSON local para velocidad de entrega).
- Migración asistida desde backup JSON hacia tablas SQL de producción.
