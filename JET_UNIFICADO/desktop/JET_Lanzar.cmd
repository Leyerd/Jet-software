@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%JET_Instalar_y_Lanzar.ps1" -ProjectRoot "%ROOT_DIR%"
if errorlevel 1 (
  echo.
  echo [JET] Error durante instalacion/arranque.
  echo [JET] Esta ventana quedara abierta para revisar mensajes.
  pause
  exit /b 1
)

echo.
echo [JET] Proceso finalizado correctamente.
echo [JET] Si no abre la pagina, revisa: docker compose ps
echo.
pause
