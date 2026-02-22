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
   - inicia API (`http://localhost:4000`) y Web (`http://localhost:3000`);
   - abre el navegador automáticamente.

## Operación diaria
- Para abrir JET: usa el acceso directo **JET UNIFICADO** del escritorio.
- Para cerrar JET: cerrar la ventana de consola del launcher (o `Ctrl+C`).

## Requisitos
- Windows 10/11.
- Permisos para ejecutar PowerShell con `ExecutionPolicy Bypass` (ya aplicado por `.cmd`).
- `winget` disponible para instalación automática de Node.js (si no existe, instalar Node LTS manualmente).

## Nota importante sobre Docker
- Este launcher **no levanta Docker**: ejecuta API y Web en modo local con Node.js para simplificar el doble clic.
- Si quieres modo Docker, usa `docker compose up -d --build` desde la carpeta `JET_UNIFICADO`.
