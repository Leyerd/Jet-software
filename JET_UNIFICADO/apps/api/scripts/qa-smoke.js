#!/usr/bin/env node
const http = require('http');

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:4000';
const U = new URL(BASE_URL);

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: U.hostname,
      port: Number(U.port || 80),
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
        } catch (_) {
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

  const product = await req('POST', '/products', { nombre: 'Prod QA', sku: `SKU-${Date.now()}`, stock: 0, costoPromedio: 0 }, token);
  if (!product.data.ok || !product.data.product?.id) throw new Error('Crear producto falló');
  const productId = product.data.product.id;

  const lot = await req('POST', '/inventory/import-lot', { productId, qty: 20, unitCost: 1500, fechaIngreso: '2026-02-10', source: 'qa-import' }, token);
  if (!lot.data.ok) throw new Error('Import lot falló');

  const consume = await req('POST', '/inventory/consume', { productId, qty: 8, fecha: '2026-02-11', reference: 'qa-sale' }, token);
  if (!consume.data.ok || !Array.isArray(consume.data.allocations) || consume.data.allocations.length === 0) throw new Error('Consume stock falló');

  const kardex = await req('GET', `/inventory/kardex?productId=${encodeURIComponent(productId)}`, null, token);
  if (!kardex.data.ok || kardex.data.count < 2) throw new Error('Kardex falló');

  const taxCfgSet = await req('POST', '/tax/config', { regime: '14D8', ppmRate: 0.2 }, token);
  if (!taxCfgSet.data.ok) throw new Error('No se pudo fijar 14D8 para QA');

  const taxSummary = await req('GET', '/tax/summary', null, token);
  if (!taxSummary.data.ok || !taxSummary.data.f22) throw new Error('Tax summary falló');

  const importCartola = await req('POST', '/reconciliation/import/cartola', { rows: [{ fecha: '2026-02-10', tipoMovimiento: 'INGRESO', monto: 100000 }] }, token);
  if (!importCartola.data.ok) throw new Error('Import cartola falló');

  const importRcv = await req('POST', '/reconciliation/import/rcv-ventas', { rows: [{ fecha: '2026-02-10', total: 100000 }] }, token);
  if (!importRcv.data.ok) throw new Error('Import RCV ventas falló');

  const importMkt = await req('POST', '/reconciliation/import/marketplace', { rows: [{ fecha: '2026-02-10', total: 120000, comision: 20000, netoLiquidado: 100000 }] }, token);
  if (!importMkt.data.ok) throw new Error('Import marketplace falló');

  const rec = await req('GET', '/reconciliation/summary', null, token);
  if (!rec.data.ok || !Array.isArray(rec.data.summary)) throw new Error('Reconciliation summary falló');

  const coh = await req('GET', '/system/coherence-check');
  if (!coh.data.ok) throw new Error('Coherence check falló');

  console.log('QA smoke OK');
})().catch(err => {
  console.error('QA smoke FAIL:', err.message);
  process.exit(1);
});
