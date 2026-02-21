function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  return sendJson(res, 404, { ok: false, message: 'Ruta no encontrada' });
}

function methodNotAllowed(res) {
  return sendJson(res, 405, { ok: false, message: 'Método no permitido' });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 10 * 1024 * 1024) {
        reject(new Error('Payload demasiado grande (máx 10MB)'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('JSON inválido en request body'));
      }
    });
    req.on('error', err => reject(err));
  });
}

module.exports = { sendJson, notFound, methodNotAllowed, parseBody };
