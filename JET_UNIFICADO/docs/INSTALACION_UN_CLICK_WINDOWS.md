# Instalación/arranque en 1 clic (Windows)

## Objetivo
Permitir que JET UNIFICADO se instale/inicie con doble clic, sin abrir terminal manualmente.

## Archivos entregados
- `desktop/JET_Lanzar.cmd`
- `desktop/JET_Instalar_y_Lanzar.ps1`
- `scripts/start-local.js`

## Cómo usar
1. Doble clic en `desktop/JET_Lanzar.cmd`.
2. El launcher:
   - verifica Node.js y npm;
   - si falta Node.js, intenta instalarlo con `winget`;
   - crea acceso directo de escritorio `JET UNIFICADO.lnk`;
   - instala dependencias de API (`apps/api/node_modules`) si faltan;
   - inicia **Docker Compose** (`docker compose up -d --build`) en modo recomendado;
   - valida disponibilidad de API (`http://localhost:4000/health`) y Web (`http://localhost:3000`);
   - abre la Web automáticamente.

## Operación diaria
- Para abrir JET: usa el acceso directo **JET UNIFICADO** del escritorio.
- Para cerrar JET: cerrar la ventana de consola del launcher (o `Ctrl+C`).

## Requisitos
- Windows 10/11.
- Permisos para ejecutar PowerShell con `ExecutionPolicy Bypass` (ya aplicado por `.cmd`).
- `winget` disponible para instalación automática de Node.js (si no existe, instalar Node LTS manualmente).

## Nota importante sobre Docker
- Este launcher **sí levanta Docker por defecto** (modo recomendado y equivalente a tu flujo histórico).
- Si Docker no está disponible, usa fallback local con Node.js.

## Solución de problemas rápida
- Ver estado contenedores: `docker compose ps`
- Ver logs API: `docker compose logs api --tail=120`
- Ver logs Web: `docker compose logs web --tail=120`
- Reinicio limpio: `docker compose down && docker compose up -d --build`
