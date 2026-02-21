const http = require('http');
const { route } = require('./src/routes');

const PORT = process.env.PORT || 4000;

const server = http.createServer((req, res) => {
  route(req, res);
});

server.listen(PORT, () => {
  console.log(`JET API (Sprint 5) escuchando en puerto ${PORT}`);
});
