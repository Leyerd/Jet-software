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

function Open-Url {
  param([string]$Url)
  Start-Process $Url | Out-Null
}

function Wait-HttpOk {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  } while ((Get-Date) -lt $deadline)

  return $false
}

Write-Host "[JET] Instalador/arranque automático" -ForegroundColor Cyan
Write-Host "[JET] Proyecto: $ProjectRoot"

$composeFile = Join-Path $ProjectRoot 'docker-compose.yml'
if (-not (Test-Path $composeFile)) {
  throw "No se encontró docker-compose.yml en: $ProjectRoot"
}

Set-Location $ProjectRoot

$usedDockerMode = $false
if (Ensure-Command 'docker') {
  try {
    Write-Host "[JET] Iniciando contenedores Docker (modo recomendado)..." -ForegroundColor Green
    & docker compose up -d --build
    if ($LASTEXITCODE -eq 0) {
      $usedDockerMode = $true
    } else {
      Write-Host "[JET] 'docker compose' falló. Intentando con 'docker-compose'..." -ForegroundColor Yellow
      if (Ensure-Command 'docker-compose') {
        & docker-compose up -d --build
        if ($LASTEXITCODE -eq 0) {
          $usedDockerMode = $true
        }
      }
    }
  } catch {
    Write-Host "[JET] No fue posible iniciar Docker automáticamente: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

if ($usedDockerMode) {
  Write-Host "[JET] Docker iniciado. Verificando servicios..." -ForegroundColor Green
  & docker compose ps

  $apiOk = Wait-HttpOk -Url 'http://localhost:4000/health' -TimeoutSeconds 90
  $webOk = Wait-HttpOk -Url 'http://localhost:3000' -TimeoutSeconds 90

  if ($apiOk -and $webOk) {
    Write-Host "[JET] Servicios arriba: Web=http://localhost:3000 API=http://localhost:4000/health" -ForegroundColor Green
  } else {
    Write-Host "[JET] Advertencia: uno o más servicios tardaron en responder." -ForegroundColor Yellow
    Write-Host "[JET] Revisa logs con: docker compose logs api --tail=120" -ForegroundColor Yellow
    Write-Host "[JET] Revisa logs con: docker compose logs web --tail=120" -ForegroundColor Yellow
  }

  Open-Url 'http://localhost:3000'
  Write-Host "[JET] Lanzamiento finalizado (modo Docker)." -ForegroundColor Cyan
  Write-Host "[JET] Para cerrar: presiona Q en esta ventana (o ejecuta 'docker compose down')." -ForegroundColor Yellow
  while ($true) {
    $k = [Console]::ReadKey($true)
    if ($k.Key -eq [ConsoleKey]::Q) {
      Write-Host "[JET] Deteniendo contenedores..." -ForegroundColor Yellow
      try { & docker compose down } catch { Write-Host "[JET] No se pudo ejecutar docker compose down automáticamente." -ForegroundColor Red }
      break
    }
  }
  exit 0
}

Write-Host "[JET] Docker no disponible. Se usará fallback local con Node.js." -ForegroundColor Yellow

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

Write-Host "[JET] Iniciando instalación de dependencias y servicios (modo local)..." -ForegroundColor Green
Write-Host "[JET] Para cerrar en modo local: Ctrl+C o Q + Enter." -ForegroundColor Yellow
node $launcher
