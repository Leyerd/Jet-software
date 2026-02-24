#!/usr/bin/env node
const http = require('http');

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:4000';
const U = new URL(BASE_URL);

function assertEq(name, actual, expected) {
  if (actual !== expected) throw new Error(`${name} esperado=${expected} actual=${actual}`);
}

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

  const reg = await req('POST', '/auth/register', { nombre: 'QA', email, password: 'Clave123A', rol: 'dueno' });
  if (!reg.data.ok) throw new Error('Register falló');

  const login = await req('POST', '/auth/login', { email, password: 'Clave123A' });
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

  const ventaQa = await req('POST', '/movements', {
    fecha: '2026-02-12',
    tipo: 'VENTA',
    descripcion: 'Venta QA tributaria',
    total: 119000,
    neto: 100000,
    iva: 19000,
    costoMercaderia: 30000,
    accepted: true,
    documentRef: 'QA-VENTA'
  }, token);
  if (!ventaQa.data.ok) throw new Error('Movimiento VENTA QA falló');

  const gastoQa = await req('POST', '/movements', {
    fecha: '2026-02-12',
    tipo: 'GASTO_LOCAL',
    descripcion: 'Gasto QA tributario',
    total: 59500,
    neto: 50000,
    iva: 9500,
    accepted: true,
    documentRef: 'QA-GASTO'
  }, token);
  if (!gastoQa.data.ok) throw new Error('Movimiento GASTO_LOCAL QA falló');

  const honorarioQa = await req('POST', '/movements', {
    fecha: '2026-02-12',
    tipo: 'HONORARIOS',
    descripcion: 'Honorario QA rechazado',
    total: 50000,
    neto: 42750,
    iva: 0,
    retention: 7250,
    accepted: false,
    documentRef: 'QA-HON-RECH'
  }, token);
  if (!honorarioQa.data.ok) throw new Error('Movimiento HONORARIOS QA falló');

  const taxSummary = await req('GET', '/tax/summary?year=2026&month=2', null, token);
  if (!taxSummary.data.ok || !taxSummary.data.f22 || !taxSummary.data.f29) throw new Error('Tax summary falló');

  assertEq('F29 casilla 538 débito', taxSummary.data.f29.casillas.casilla_538_debitoFiscal, 19000);
  assertEq('F29 casilla 511 crédito', taxSummary.data.f29.casillas.casilla_511_creditoFiscal, 9500);
  assertEq('F29 casilla 151 retención (rechazado excluido)', taxSummary.data.f29.casillas.casilla_151_retHonorarios, 0);
  assertEq('F29 casilla 062 PPM', taxSummary.data.f29.casillas.casilla_062_ppm, 200);
  assertEq('F29 casilla 089 IVA determinado', taxSummary.data.f29.casillas.casilla_089_ivaDeterminado, 9500);
  assertEq('F29 casilla 091 total a pagar', taxSummary.data.f29.casillas.casilla_091_totalAPagar, 9700);
  assertEq('F22 RLI ventas netas', taxSummary.data.f22.rli.components.ventasNetas, 100000);
  assertEq('F22 RLI costos', taxSummary.data.f22.rli.components.costos, 30000);
  assertEq('F22 RLI gastos', taxSummary.data.f22.rli.components.gastos, 50000);
  assertEq('F22 RLI', taxSummary.data.f22.rli.components.rli, 20000);

  const importCartola = await req('POST', '/reconciliation/import/cartola', { rows: [{ fecha: '2026-02-10', tipoMovimiento: 'INGRESO', monto: 100000 }] }, token);
  if (!importCartola.data.ok) throw new Error('Import cartola falló');

  const importRcv = await req('POST', '/reconciliation/import/rcv-ventas', { rows: [{ fecha: '2026-02-10', total: 100000 }] }, token);
  if (!importRcv.data.ok) throw new Error('Import RCV ventas falló');

  const importMkt = await req('POST', '/reconciliation/import/marketplace', { rows: [{ fecha: '2026-02-10', total: 120000, comision: 20000, netoLiquidado: 100000 }] }, token);
  if (!importMkt.data.ok) throw new Error('Import marketplace falló');

  const rec = await req('GET', '/reconciliation/summary', null, token);
  if (!rec.data.ok || !Array.isArray(rec.data.summary)) throw new Error('Reconciliation summary falló');


  const alibaba = await req('POST', '/integrations/alibaba/import-products', {
    rows: [{ sku: `ALI-${Date.now()}`, nombre: 'Producto Alibaba QA', unitCost: 2500, proveedor: 'Alibaba QA' }]
  }, token);
  if (!alibaba.data.ok || !alibaba.data.result) throw new Error('Integración Alibaba falló');

  const meli = await req('POST', '/integrations/mercadolibre/import-orders', {
    rows: [{ orderId: `ML-${Date.now()}`, fecha: '2026-02-12', total: 50000, comision: 5000, netoLiquidado: 45000 }]
  }, token);
  if (!meli.data.ok || !meli.data.result) throw new Error('Integración Mercado Libre falló');

  const sii = await req('POST', '/integrations/sii/import-rcv', {
    kind: 'ventas',
    rows: [{ folio: `F-${Date.now()}`, fecha: '2026-02-12', total: 50000, iva: 9500 }]
  }, token);
  if (!sii.data.ok || !sii.data.result) throw new Error('Integración SII falló');

  const integStatus = await req('GET', '/integrations/status', null, token);
  if (!integStatus.data.ok || !integStatus.data.providers) throw new Error('Integrations status falló');


  const backupPolicy = await req('GET', '/backup/policy', null, token);
  if (!backupPolicy.data.ok || !backupPolicy.data.policy) throw new Error('Backup policy falló');

  const backupCreate = await req('POST', '/backup/create', { reason: 'qa-smoke-sprint9' }, token);
  if (!backupCreate.data.ok || !backupCreate.data.backup?.id) throw new Error('Backup create falló');

  const backupList = await req('GET', '/backup/list', null, token);
  if (!backupList.data.ok || backupList.data.count < 1) throw new Error('Backup list falló');

  const logout = await req('POST', '/auth/logout', {}, token);
  if (!logout.data.ok) throw new Error('Logout falló');

  const coh = await req('GET', '/system/coherence-check');
  if (!coh.data.ok) throw new Error('Coherence check falló');

  console.log('QA smoke OK');
})().catch(err => {
  console.error('QA smoke FAIL:', err.message);
  process.exit(1);
});
