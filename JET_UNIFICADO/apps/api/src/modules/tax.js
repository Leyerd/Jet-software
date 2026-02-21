const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');

function defaultTaxConfig() {
  return {
    regime: '14D8', // Transparente por defecto
    year: new Date().getFullYear(),
    ppmRate: 0.2,
    ivaRate: 0.19,
    retentionRate: 14.5
  };
}

function ensureTaxConfig(state) {
  if (!state.taxConfig || typeof state.taxConfig !== 'object') {
    state.taxConfig = defaultTaxConfig();
  }
  if (!state.taxConfig.regime) state.taxConfig.regime = '14D8';
  if (state.taxConfig.ppmRate === undefined) state.taxConfig.ppmRate = state.taxConfig.regime === '14D8' ? 0.2 : 0.25;
  if (state.taxConfig.ivaRate === undefined) state.taxConfig.ivaRate = 0.19;
  if (state.taxConfig.retentionRate === undefined) state.taxConfig.retentionRate = 14.5;
  if (!state.taxConfig.year) state.taxConfig.year = new Date().getFullYear();
  return state.taxConfig;
}

function computeMonthlyF29(movs, config) {
  const debit = movs.filter(m => m.tipo === 'VENTA').reduce((a, b) => a + Number(b.iva || 0), 0);
  const credit = movs.filter(m => ['GASTO_LOCAL', 'IMPORTACION'].includes(m.tipo)).reduce((a, b) => a + Number(b.iva || 0), 0);
  const netSales = movs.filter(m => m.tipo === 'VENTA').reduce((a, b) => a + Number(b.neto || b.total || 0), 0);
  const retention = movs.filter(m => m.tipo === 'HONORARIOS').reduce((a, b) => a + Number(b.retention || 0), 0);
  const ppm = Math.round(netSales * (Number(config.ppmRate || 0) / 100));
  const ivaToPay = Math.max(0, Math.round(debit - credit));
  return {
    debit,
    credit,
    retention,
    ppm,
    ivaToPay,
    totalToPay: ivaToPay + retention + ppm
  };
}

function computeYearlyRli(movs) {
  const ventasNetas = movs.filter(m => m.tipo === 'VENTA').reduce((a, b) => a + Number(b.neto || b.total || 0), 0);
  const costos = movs.reduce((a, b) => a + Number(b.costoMercaderia || 0), 0);
  const gastos = movs.filter(m => ['GASTO_LOCAL', 'HONORARIOS', 'IMPORTACION'].includes(m.tipo)).reduce((a, b) => a + Number(b.neto || 0), 0);
  const rli = ventasNetas - costos - gastos;
  return { ventasNetas, costos, gastos, rli };
}

function computeTaxByRegime(rli, regime) {
  if (regime === '14D3') {
    const idpc = Math.max(0, Math.round(rli * 0.25));
    return { regime, idpc, transparentAttribution: 0 };
  }
  // 14D8 transparente
  return { regime, idpc: 0, transparentAttribution: Math.max(0, Math.round(rli)) };
}

async function getTaxConfig(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const state = await readStore();
  const taxConfig = ensureTaxConfig(state);
  await writeStore(state);
  return sendJson(res, 200, { ok: true, taxConfig });
}

async function updateTaxConfig(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const state = await readStore();
  const current = ensureTaxConfig(state);

  const regime = body.regime || current.regime;
  if (!['14D8', '14D3'].includes(regime)) return sendJson(res, 400, { ok: false, message: 'regime inválido: use 14D8 o 14D3' });

  state.taxConfig = {
    regime,
    year: Number(body.year || current.year || new Date().getFullYear()),
    ppmRate: Number(body.ppmRate !== undefined ? body.ppmRate : (regime === '14D8' ? 0.2 : 0.25)),
    ivaRate: Number(body.ivaRate !== undefined ? body.ivaRate : current.ivaRate),
    retentionRate: Number(body.retentionRate !== undefined ? body.retentionRate : current.retentionRate)
  };

  await writeStore(state);
  await appendAudit('tax.config.update', state.taxConfig, auth.user.email);
  return sendJson(res, 200, { ok: true, taxConfig: state.taxConfig });
}

async function getTaxSummary(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const query = req.url.includes('?') ? new URL(req.url, 'http://localhost').searchParams : new URLSearchParams();
  const state = await readStore();
  const cfg = ensureTaxConfig(state);
  const year = Number(query.get('year') || cfg.year || new Date().getFullYear());
  const month = Number(query.get('month') || (new Date().getMonth() + 1));

  const yearMovs = (state.movimientos || []).filter(m => new Date(m.fecha).getFullYear() === year);
  const monthMovs = yearMovs.filter(m => (new Date(m.fecha).getMonth() + 1) === month);

  const f29 = computeMonthlyF29(monthMovs, cfg);
  const yearly = computeYearlyRli(yearMovs);
  const selectedRegime = computeTaxByRegime(yearly.rli, cfg.regime);
  const alternativeRegime = computeTaxByRegime(yearly.rli, cfg.regime === '14D8' ? '14D3' : '14D8');

  return sendJson(res, 200, {
    ok: true,
    assumptions: {
      defaultRegime: cfg.regime,
      eirlMode: 'empresa_individual_responsabilidad_limitada',
      year,
      month
    },
    f29,
    f22: {
      yearly,
      selectedRegime,
      alternativeRegime
    }
  });
}

module.exports = { getTaxConfig, updateTaxConfig, getTaxSummary, ensureTaxConfig };
