const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');

const NORMATIVE_CATALOG = {
  2026: {
    version: 'cl-tax-2026.1',
    source: 'SII+LIR (modelo interno referencial)',
    regimes: {
      '14D8': {
        default: true,
        ppmRate: 0.2,
        ivaRate: 0.19,
        retentionRate: 14.5,
        rules: {
          f29: [
            { id: 'F29-VENTA-DEBITO', field: 'casilla_538', formula: 'SUM(iva) para VENTA' },
            { id: 'F29-COMPRA-CREDITO', field: 'casilla_511', formula: 'SUM(iva) para GASTO_LOCAL/IMPORTACION' },
            { id: 'F29-PPM', field: 'casilla_062', formula: 'SUM(neto ventas) * ppmRate/100' },
            { id: 'F29-RET-HON', field: 'casilla_151', formula: 'SUM(retention) honorarios' }
          ],
          f22: [
            { id: 'F22-RLI', field: 'rli', formula: 'ventasNetas - costos - gastos' },
            { id: 'F22-14D8-ATRIB', field: 'atribucionTransparente', formula: 'max(0, RLI)' }
          ],
          ddjj: [{ id: 'DDJJ-1947', description: 'Base referencial RTE 14D8' }]
        }
      },
      '14D3': {
        default: false,
        ppmRate: 0.25,
        ivaRate: 0.19,
        retentionRate: 14.5,
        rules: {
          f29: [
            { id: 'F29-VENTA-DEBITO', field: 'casilla_538', formula: 'SUM(iva) para VENTA' },
            { id: 'F29-COMPRA-CREDITO', field: 'casilla_511', formula: 'SUM(iva) para GASTO_LOCAL/IMPORTACION' },
            { id: 'F29-PPM', field: 'casilla_062', formula: 'SUM(neto ventas) * ppmRate/100' },
            { id: 'F29-RET-HON', field: 'casilla_151', formula: 'SUM(retention) honorarios' }
          ],
          f22: [
            { id: 'F22-RLI', field: 'rli', formula: 'ventasNetas - costos - gastos' },
            { id: 'F22-14D3-IDPC', field: 'idpc', formula: 'max(0, RLI*0.25)' }
          ],
          ddjj: [{ id: 'DDJJ-1887', description: 'Base referencial renta 14D3' }]
        }
      }
    }
  }
};

function getCatalog(year, regime) {
  const selectedYear = NORMATIVE_CATALOG[year] ? year : 2026;
  const y = NORMATIVE_CATALOG[selectedYear];
  const rg = y.regimes[regime] ? regime : '14D8';
  return {
    year: selectedYear,
    regime: rg,
    version: y.version,
    source: y.source,
    ...y.regimes[rg]
  };
}

function ensureTaxConfig(state) {
  if (!state.taxConfig || typeof state.taxConfig !== 'object') state.taxConfig = {};
  if (!['14D8', '14D3'].includes(state.taxConfig.regime)) state.taxConfig.regime = '14D8';
  if (!state.taxConfig.year) state.taxConfig.year = new Date().getFullYear();
  const cat = getCatalog(state.taxConfig.year, state.taxConfig.regime);
  if (state.taxConfig.ppmRate === undefined) state.taxConfig.ppmRate = cat.ppmRate;
  if (state.taxConfig.ivaRate === undefined) state.taxConfig.ivaRate = cat.ivaRate;
  if (state.taxConfig.retentionRate === undefined) state.taxConfig.retentionRate = cat.retentionRate;
  return state.taxConfig;
}

function computeMonthlyF29(movs, config, catalog) {
  const debit = movs.filter(m => String(m.tipo).toUpperCase() === 'VENTA').reduce((a, b) => a + Number(b.iva || 0), 0);
  const credit = movs.filter(m => ['GASTO_LOCAL', 'IMPORTACION'].includes(String(m.tipo).toUpperCase())).reduce((a, b) => a + Number(b.iva || 0), 0);
  const netSales = movs.filter(m => String(m.tipo).toUpperCase() === 'VENTA').reduce((a, b) => a + Number(b.neto || b.total || 0), 0);
  const retention = movs.filter(m => String(m.tipo).toUpperCase() === 'HONORARIOS').reduce((a, b) => a + Number(b.retention || 0), 0);
  const ppm = Math.round(netSales * (Number(config.ppmRate || 0) / 100));
  const ivaToPay = Math.max(0, Math.round(debit - credit));

  const casillas = {
    casilla_538_debitoFiscal: Math.round(debit),
    casilla_511_creditoFiscal: Math.round(credit),
    casilla_151_retHonorarios: Math.round(retention),
    casilla_062_ppm: Math.round(ppm),
    casilla_089_ivaDeterminado: Math.round(ivaToPay),
    casilla_091_totalAPagar: Math.round(ivaToPay + retention + ppm)
  };

  return {
    casillas,
    totals: {
      debit: Math.round(debit),
      credit: Math.round(credit),
      retention: Math.round(retention),
      ppm: Math.round(ppm),
      ivaToPay: Math.round(ivaToPay),
      totalToPay: Math.round(ivaToPay + retention + ppm)
    },
    trace: {
      rulesApplied: catalog.rules.f29,
      version: catalog.version,
      source: catalog.source
    }
  };
}

function computeYearlyRli(movs, catalog) {
  const ventasNetas = movs.filter(m => String(m.tipo).toUpperCase() === 'VENTA').reduce((a, b) => a + Number(b.neto || b.total || 0), 0);
  const costos = movs.reduce((a, b) => a + Number(b.costoMercaderia || 0), 0);
  const gastos = movs.filter(m => ['GASTO_LOCAL', 'HONORARIOS', 'IMPORTACION', 'COMISION_MARKETPLACE'].includes(String(m.tipo).toUpperCase())).reduce((a, b) => a + Number(b.neto || b.total || 0), 0);
  const rli = ventasNetas - costos - gastos;

  return {
    components: {
      ventasNetas: Math.round(ventasNetas),
      costos: Math.round(costos),
      gastos: Math.round(gastos),
      rli: Math.round(rli)
    },
    ddjjBase: {
      ddjjRelevant: catalog.rules.ddjj,
      provisionalBase: Math.round(Math.max(0, rli))
    },
    trace: {
      rulesApplied: catalog.rules.f22.filter(r => r.id === 'F22-RLI'),
      version: catalog.version,
      source: catalog.source
    }
  };
}

function computeF22ByRegime(rli, regime, catalog) {
  if (regime === '14D3') {
    const idpc = Math.max(0, Math.round(rli * 0.25));
    return {
      regime,
      idpc,
      transparentAttribution: 0,
      trace: {
        rulesApplied: catalog.rules.f22,
        version: catalog.version,
        source: catalog.source
      }
    };
  }
  return {
    regime,
    idpc: 0,
    transparentAttribution: Math.max(0, Math.round(rli)),
    trace: {
      rulesApplied: catalog.rules.f22,
      version: catalog.version,
      source: catalog.source
    }
  };
}

async function loadTaxConfigFromDb(year) {
  return withPgClient(async (client) => {
    const rs = await client.query(
      `SELECT anio AS year, regimen AS regime, ppm_rate AS "ppmRate", iva_rate AS "ivaRate", ret_rate AS "retentionRate"
       FROM tax_config
       WHERE anio = $1
       ORDER BY id DESC
       LIMIT 1`,
      [year]
    );
    if (rs.rows.length) return rs.rows[0];
    const cat = getCatalog(year, '14D8');
    const created = { year, regime: '14D8', ppmRate: cat.ppmRate, ivaRate: cat.ivaRate, retentionRate: cat.retentionRate };
    await client.query(
      `INSERT INTO tax_config (anio, regimen, ppm_rate, iva_rate, ret_rate)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (anio, regimen)
       DO UPDATE SET ppm_rate = EXCLUDED.ppm_rate, iva_rate = EXCLUDED.iva_rate, ret_rate = EXCLUDED.ret_rate`,
      [created.year, created.regime, created.ppmRate, created.ivaRate, created.retentionRate]
    );
    return created;
  });
}

async function getTaxCatalog(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const query = req.url.includes('?') ? new URL(req.url, 'http://localhost').searchParams : new URLSearchParams();
  const year = Number(query.get('year') || new Date().getFullYear());
  const regime = query.get('regime') || '14D8';
  const catalog = getCatalog(year, regime);
  return sendJson(res, 200, { ok: true, catalog });
}

async function getTaxConfig(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  if (isPostgresMode()) {
    const year = new Date().getFullYear();
    const taxConfig = await loadTaxConfigFromDb(year);
    const catalog = getCatalog(taxConfig.year, taxConfig.regime);
    return sendJson(res, 200, { ok: true, taxConfig, catalog: { version: catalog.version, source: catalog.source, rules: catalog.rules } });
  }

  const state = await readStore();
  const taxConfig = ensureTaxConfig(state);
  await writeStore(state);
  const catalog = getCatalog(taxConfig.year, taxConfig.regime);
  return sendJson(res, 200, { ok: true, taxConfig, catalog: { version: catalog.version, source: catalog.source, rules: catalog.rules } });
}

async function updateTaxConfig(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const nowYear = new Date().getFullYear();

  if (isPostgresMode()) {
    const current = await loadTaxConfigFromDb(nowYear);
    const regime = body.regime || current.regime;
    const year = Number(body.year || current.year || nowYear);
    const catalog = getCatalog(year, regime);

    if (!['14D8', '14D3'].includes(regime)) return sendJson(res, 400, { ok: false, message: 'regime inválido: use 14D8 o 14D3' });

    const taxConfig = {
      regime,
      year,
      ppmRate: Number(body.ppmRate !== undefined ? body.ppmRate : catalog.ppmRate),
      ivaRate: Number(body.ivaRate !== undefined ? body.ivaRate : catalog.ivaRate),
      retentionRate: Number(body.retentionRate !== undefined ? body.retentionRate : catalog.retentionRate)
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

    await appendAuditLog('tax.config.update', { ...taxConfig, catalogVersion: catalog.version }, auth.user.email);
    return sendJson(res, 200, { ok: true, taxConfig, catalog: { version: catalog.version, source: catalog.source } });
  }

  const state = await readStore();
  const current = ensureTaxConfig(state);
  const regime = body.regime || current.regime;
  const year = Number(body.year || current.year || nowYear);
  const catalog = getCatalog(year, regime);

  if (!['14D8', '14D3'].includes(regime)) return sendJson(res, 400, { ok: false, message: 'regime inválido: use 14D8 o 14D3' });

  state.taxConfig = {
    regime,
    year,
    ppmRate: Number(body.ppmRate !== undefined ? body.ppmRate : catalog.ppmRate),
    ivaRate: Number(body.ivaRate !== undefined ? body.ivaRate : catalog.ivaRate),
    retentionRate: Number(body.retentionRate !== undefined ? body.retentionRate : catalog.retentionRate)
  };

  await writeStore(state);
  await appendAudit('tax.config.update', { ...state.taxConfig, catalogVersion: catalog.version }, auth.user.email);
  return sendJson(res, 200, { ok: true, taxConfig: state.taxConfig, catalog: { version: catalog.version, source: catalog.source } });
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
    cfg = await loadTaxConfigFromDb(year);
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

  const catalog = getCatalog(cfg.year || year, cfg.regime || '14D8');
  const monthMovs = yearMovs.filter(m => (new Date(m.fecha).getMonth() + 1) === month);

  const f29 = computeMonthlyF29(monthMovs, cfg, catalog);
  const rli = computeYearlyRli(yearMovs, catalog);
  const selectedRegime = computeF22ByRegime(rli.components.rli, cfg.regime, catalog);
  const altCatalog = getCatalog(cfg.year || year, cfg.regime === '14D8' ? '14D3' : '14D8');
  const alternativeRegime = computeF22ByRegime(rli.components.rli, cfg.regime === '14D8' ? '14D3' : '14D8', altCatalog);

  return sendJson(res, 200, {
    ok: true,
    assumptions: {
      defaultRegime: cfg.regime,
      eirlMode: 'empresa_individual_responsabilidad_limitada',
      year,
      month,
      normativeVersion: catalog.version,
      normativeSource: catalog.source
    },
    f29,
    f22: {
      rli,
      selectedRegime,
      alternativeRegime
    },
    trace: {
      appliedRules: [...catalog.rules.f29, ...catalog.rules.f22],
      version: catalog.version,
      source: catalog.source
    }
  });
}

module.exports = { getTaxConfig, updateTaxConfig, getTaxSummary, getTaxCatalog, ensureTaxConfig, getCatalog };
