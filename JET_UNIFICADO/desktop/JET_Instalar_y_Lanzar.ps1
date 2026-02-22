param(
  [string]$ProjectRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) ".")
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = $ProjectRoot.Trim().Trim('"')
if ($ProjectRoot.EndsWith('\')) {
  $ProjectRoot = $ProjectRoot.TrimEnd('\')
}
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)

function Ensure-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Host "[JET] Instalador/arranque automático" -ForegroundColor Cyan
Write-Host "[JET] Proyecto: $ProjectRoot"

if (-not (Ensure-Command 'node')) {
  Write-Host "[JET] Node.js no está instalado. Intentando instalar con winget..." -ForegroundColor Yellow
  if (-not (Ensure-Command 'winget')) {
    throw "No se encontró winget. Instala Node.js LTS manualmente y vuelve a ejecutar este launcher."
  }
  winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
}

if (-not (Ensure-Command 'npm')) {
  throw "npm no está disponible. Verifica instalación de Node.js LTS."
}

$launcher = Join-Path $ProjectRoot 'scripts/start-local.js'
if (-not (Test-Path $launcher)) {
  throw "No existe script de arranque: $launcher"
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'JET UNIFICADO.lnk'
if (-not (Test-Path $shortcutPath)) {
  $wsh = New-Object -ComObject WScript.Shell
  $shortcut = $wsh.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = (Join-Path $ProjectRoot 'desktop/JET_Lanzar.cmd')
  $shortcut.WorkingDirectory = $ProjectRoot
  $shortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,176"
  $shortcut.Save()
  Write-Host "[JET] Acceso directo creado en escritorio: $shortcutPath" -ForegroundColor Green
}

Write-Host "[JET] Iniciando instalación de dependencias y servicios..." -ForegroundColor Green
Set-Location $ProjectRoot
node $launcher
