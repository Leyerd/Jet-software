#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = process.env.JET_WEB_ROOT || path.join(__dirname, '..', 'apps', 'web');
const port = Number(process.env.JET_WEB_PORT || 3000);

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let p = (req.url || '/').split('?')[0];
  if (p === '/' || !p) p = '/index.html';

  const filePath = path.join(root, p.replace(/^\/+/, ''));
  if (!filePath.startsWith(root)) {
    res.statusCode = 403;
    return res.end('forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', mime[path.extname(filePath)] || 'text/plain');
    return res.end(data);
  });
});

server.listen(port, () => {
  console.log(`[JET] Web listo en http://localhost:${port}`);
});
