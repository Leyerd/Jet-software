const http = require('http');
const crypto = require('crypto');
const { route } = require('./src/routes');
const { runWithRequestContext } = require('./src/lib/requestContext');
const { recordRequest } = require('./src/modules/observability');

const PORT = process.env.PORT || 4000;

const server = http.createServer((req, res) => {
  const requestId = req.headers['x-request-id'] || `req-${crypto.randomUUID()}`;
  const startedAt = Date.now();
  const path = (req.url || '').split('?')[0] || '/';

  res.setHeader('X-Request-Id', requestId);
  res.on('finish', () => {
    recordRequest({
      requestId,
      method: req.method,
      path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });

  runWithRequestContext({ requestId, path }, () => route(req, res));
});

server.listen(PORT, () => {
  console.log(`JET API (Sprint 12) escuchando en puerto ${PORT}`);
});
