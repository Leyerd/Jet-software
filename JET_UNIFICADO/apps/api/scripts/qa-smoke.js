#!/usr/bin/env node
const http = require('http');

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: 'localhost',
      port: 4000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let out = '';
      res.on('data', c => (out += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(out || '{}') });
        } catch (e) {
          reject(new Error(`Respuesta no JSON en ${method} ${path}`));
        }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const email = `qa_${Date.now()}@jet.cl`;

  const health = await req('GET', '/health');
  if (!health.data.ok) throw new Error('Health falló');

  const reg = await req('POST', '/auth/register', { nombre: 'QA', email, password: '123456', rol: 'dueno' });
  if (!reg.data.ok) throw new Error('Register falló');

  const login = await req('POST', '/auth/login', { email, password: '123456' });
  if (!login.data.ok || !login.data.token) throw new Error('Login falló');
  const token = login.data.token;

  const proj = await req('GET', '/finance/projection', null, token);
  if (!proj.data.ok || !proj.data.projection?.scenarios?.base) throw new Error('Projection falló');

  const coh = await req('GET', '/system/coherence-check');
  if (!coh.data.ok) throw new Error('Coherence check falló');

  console.log('QA smoke OK');
})().catch(err => {
  console.error('QA smoke FAIL:', err.message);
  process.exit(1);
});
