#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const apiDir = path.join(root, 'apps', 'api');

function bin(name) {
  if (process.platform !== 'win32') return name;
  if (name === 'npm') return 'npm.cmd';
  if (name === 'node') return 'node.exe';
  return name;
}

function run(cmd, args, cwd, inherit = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin(cmd), args, { cwd, stdio: inherit ? 'inherit' : 'pipe', shell: false });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} failed with code ${code}`));
    });
    child.on('error', reject);
  });
}

function startProcess(cmd, args, cwd, name, env = {}) {
  const child = spawn(bin(cmd), args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...env }
  });
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[JET] ${name} terminó con código ${code}`);
    }
  });
  return child;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureApiDependencies() {
  const nodeModules = path.join(apiDir, 'node_modules');
  if (fs.existsSync(nodeModules)) return;
  console.log('[JET] Instalando dependencias de API...');
  await run('npm', ['install'], apiDir);
}

function openBrowser(url) {
  if (process.env.JET_NO_BROWSER === '1') return;
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', shell: false }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore', shell: false }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore', shell: false }).unref();
  }
}

async function main() {
  console.log('[JET] Iniciador local: instalación automática + arranque de servicios');
  await ensureApiDependencies();

  const apiPort = Number(process.env.JET_API_PORT || 4000);
  const webPort = Number(process.env.JET_WEB_PORT || 3000);

  console.log(`[JET] Iniciando API en puerto ${apiPort}...`);
  const api = startProcess('node', ['server.js'], apiDir, 'API', { PORT: String(apiPort) });

  console.log(`[JET] Iniciando WEB en puerto ${webPort}...`);
  const web = startProcess('node', [path.join(root, 'scripts', 'web-static-server.js')], root, 'WEB', { JET_WEB_PORT: String(webPort) });

  await wait(1200);
  const url = `http://localhost:${webPort}`;
  console.log(`[JET] Abriendo navegador en ${url}`);
  openBrowser(url);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n[JET] Cerrando servicios...');
    for (const p of [api, web]) {
      if (p && !p.killed) p.kill('SIGTERM');
    }
    setTimeout(() => process.exit(0), 150);
  };

  api.on('exit', () => { if (!shuttingDown) shutdown(); });
  web.on('exit', () => { if (!shuttingDown) shutdown(); });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (process.stdin && process.stdin.isTTY) {
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', (chunk) => {
      const txt = String(chunk || '').trim().toLowerCase();
      if (txt === 'q' || txt === 'exit' || txt === 'salir') shutdown();
    });
  }

  const autoExitMs = Number(process.env.JET_TEST_EXIT_AFTER_MS || 0);
  if (autoExitMs > 0) setTimeout(shutdown, autoExitMs);

  console.log('[JET] Sistema listo. Presiona Ctrl+C o escribe Q + Enter para detener API y WEB.');
}

main().catch((err) => {
  console.error('[JET] Error en iniciador:', err.message);
  process.exit(1);
});
