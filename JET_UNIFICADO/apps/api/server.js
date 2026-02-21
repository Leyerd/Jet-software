const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 4000;

const send = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const routes = {
  '/health': () => ({ ok: true, service: 'jet-api', version: 'v1-unificada' }),
  '/modules': () => ({
    modules: [
      'arquitectura-unificada',
      'migracion-datos',
      'cierre-contable',
      'conciliacion-documental',
      'motor-tributario',
      'inventario-kardex',
      'integraciones-marketplace',
      'seguridad-backups',
      'proyecciones-financieras',
      'qa-cicd'
    ]
  })
};

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  if (req.method === 'GET' && routes[parsed.pathname]) {
    return send(res, 200, routes[parsed.pathname]());
  }
  return send(res, 404, { ok: false, message: 'Ruta no encontrada' });
});

server.listen(PORT, () => {
  console.log(`JET API escuchando en puerto ${PORT}`);
});
