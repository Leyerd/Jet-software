const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');

function ensureTaxConfig(state) {
  if (!state.taxConfig || typeof state.taxConfig !== 'object') state.taxConfig = {};
  if (!['14D8', '14D3'].includes(state.taxConfig.regime)) state.taxConfig.regime = '14D8';
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
  return { regime, idpc: 0, transparentAttribution: Math.max(0, Math.round(rli)) };
}

async function getTaxConfig(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  if (isPostgresMode()) {
    const year = new Date().getFullYear();
    const taxConfig = await withPgClient(async (client) => {
      const rs = await client.query(
        `SELECT anio AS year, regimen AS regime, ppm_rate AS "ppmRate", iva_rate AS "ivaRate", ret_rate AS "retentionRate"
         FROM tax_config
         WHERE anio = $1
         ORDER BY id DESC
         LIMIT 1`,
        [year]
      );
      if (rs.rows.length) return rs.rows[0];
      const created = {
        year,
        regime: '14D8',
        ppmRate: 0.2,
        ivaRate: 0.19,
        retentionRate: 14.5
      };
      await client.query(
        `INSERT INTO tax_config (anio, regimen, ppm_rate, iva_rate, ret_rate)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (anio, regimen) DO UPDATE SET ppm_rate = EXCLUDED.ppm_rate, iva_rate = EXCLUDED.iva_rate, ret_rate = EXCLUDED.ret_rate`,
        [created.year, created.regime, created.ppmRate, created.ivaRate, created.retentionRate]
      );
      return created;
    });
    return sendJson(res, 200, { ok: true, taxConfig });
  }

  const state = await readStore();
  const taxConfig = ensureTaxConfig(state);
  await writeStore(state);
  return sendJson(res, 200, { ok: true, taxConfig });
}

async function updateTaxConfig(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);

  if (isPostgresMode()) {
    const nowYear = new Date().getFullYear();
    const current = await withPgClient(async (client) => {
      const rs = await client.query(
        `SELECT anio AS year, regimen AS regime, ppm_rate AS "ppmRate", iva_rate AS "ivaRate", ret_rate AS "retentionRate"
         FROM tax_config
         WHERE anio = $1
         ORDER BY id DESC
         LIMIT 1`,
        [nowYear]
      );
      return rs.rows[0] || { year: nowYear, regime: '14D8', ppmRate: 0.2, ivaRate: 0.19, retentionRate: 14.5 };
    });

    const regime = body.regime || current.regime;
    if (!['14D8', '14D3'].includes(regime)) return sendJson(res, 400, { ok: false, message: 'regime inválido: use 14D8 o 14D3' });

    const taxConfig = {
      regime,
      year: Number(body.year || current.year || nowYear),
      ppmRate: Number(body.ppmRate !== undefined ? body.ppmRate : (regime === '14D8' ? 0.2 : 0.25)),
      ivaRate: Number(body.ivaRate !== undefined ? body.ivaRate : current.ivaRate),
      retentionRate: Number(body.retentionRate !== undefined ? body.retentionRate : current.retentionRate)
    };

    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO tax_config (anio, regimen, ppm_rate, iva_rate, ret_rate)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (anio, regimen)
         DO UPDATE SET ppm_rate = EXCLUDED.ppm_rate, iva_rate = EXCLUDED.iva_rate, ret_rate = EXCLUDED.ret_rate`,
        [taxConfig.year, taxConfig.regime, taxConfig.ppmRate, taxConfig.ivaRate, taxConfig.retentionRate]
      );
    });

    await appendAuditLog('tax.config.update', taxConfig, auth.user.email);
    return sendJson(res, 200, { ok: true, taxConfig });
  }

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
  const year = Number(query.get('year') || new Date().getFullYear());
  const month = Number(query.get('month') || (new Date().getMonth() + 1));

  let cfg;
  let yearMovs;

  if (isPostgresMode()) {
    cfg = await withPgClient(async (client) => {
      const rs = await client.query(
        `SELECT anio AS year, regimen AS regime, ppm_rate AS "ppmRate", iva_rate AS "ivaRate", ret_rate AS "retentionRate"
         FROM tax_config
         WHERE anio = $1
         ORDER BY id DESC
         LIMIT 1`,
        [year]
      );
      return rs.rows[0] || { year, regime: '14D8', ppmRate: 0.2, ivaRate: 0.19, retentionRate: 14.5 };
    });

    yearMovs = await withPgClient(async (client) => {
      const rs = await client.query(
        `SELECT fecha, tipo, total, neto, iva
         FROM movimientos
         WHERE EXTRACT(YEAR FROM fecha) = $1`,
        [year]
      );
      return rs.rows;
    });
  } else {
    const state = await readStore();
    cfg = ensureTaxConfig(state);
    yearMovs = (state.movimientos || []).filter(m => new Date(m.fecha).getFullYear() === year);
  }

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
