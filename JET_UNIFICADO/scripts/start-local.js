#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const apiDir = path.join(root, 'apps', 'api');
const webDir = path.join(root, 'apps', 'web');

function run(cmd, args, cwd, inherit = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: inherit ? 'inherit' : 'pipe', shell: process.platform === 'win32' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} failed with code ${code}`));
    });
    child.on('error', reject);
  });
}

function startProcess(cmd, args, cwd, name, env = {}) {
  const child = spawn(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
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

async function main() {
  console.log('[JET] Iniciador local: instalación automática + arranque de servicios');
  await ensureApiDependencies();

  const apiPort = Number(process.env.JET_API_PORT || 4000);
  const webPort = Number(process.env.JET_WEB_PORT || 3000);

  console.log(`[JET] Iniciando API en puerto ${apiPort}...`);
  const api = startProcess('node', ['server.js'], apiDir, 'API', { PORT: String(apiPort) });

  console.log(`[JET] Iniciando WEB en puerto ${webPort}...`);
  const webServerScript = [
    "const http=require('http');",
    "const fs=require('fs');",
    "const path=require('path');",
    `const root=${JSON.stringify(webDir)};`,
    "const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};",
    "const server=http.createServer((req,res)=>{",
    "let p=req.url.split('?')[0];if(p==='/'||!p)p='/index.html';",
    "const f=path.join(root,p.replace(/^\\/+/,''));",
    "if(!f.startsWith(root)){res.statusCode=403;return res.end('forbidden');}",
    "fs.readFile(f,(err,data)=>{if(err){res.statusCode=404;return res.end('not found');}",
    "res.setHeader('Content-Type',mime[path.extname(f)]||'text/plain');res.end(data);});});",
    `server.listen(${webPort},()=>console.log('[JET] Web listo en http://localhost:${webPort}'));`
  ].join('');

  const web = startProcess('node', ['-e', webServerScript], root, 'WEB');

  await wait(1200);
  const url = `http://localhost:${webPort}`;
  console.log(`[JET] Abriendo navegador en ${url}`);

  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }

  const shutdown = () => {
    console.log('\n[JET] Cerrando servicios...');
    for (const p of [api, web]) {
      if (p && !p.killed) p.kill('SIGTERM');
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[JET] Sistema listo. Presiona Ctrl+C en esta ventana para detener API y WEB.');
}

main().catch((err) => {
  console.error('[JET] Error en iniciador:', err.message);
  process.exit(1);
});
