#!/usr/bin/env node

const { computeMonthlyF29, computeYearlyRli, computeF22ByRegime, getCatalog } = require('../src/modules/tax');

function assertEqual(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${name} esperado=${expected} actual=${actual}`);
  }
}

function run() {
  const catalog14D8 = getCatalog(2026, '14D8');
  const catalog14D3 = getCatalog(2026, '14D3');

  const janMovements = [
    { fecha: '2026-01-05', tipo: 'VENTA', neto: 1000000, iva: 190000, costoMercaderia: 300000, accepted: true },
    { fecha: '2026-01-07', tipo: 'GASTO_LOCAL', neto: 100000, iva: 19000, accepted: true },
    { fecha: '2026-01-08', tipo: 'IMPORTACION', neto: 50000, iva: 9500, accepted: false },
    { fecha: '2026-01-10', tipo: 'HONORARIOS', neto: 200000, retention: 21000, accepted: true },
    { fecha: '2026-01-12', tipo: 'COMISION_MARKETPLACE', neto: 30000, comision: 30000, accepted: true }
  ];

  const f29 = computeMonthlyF29(janMovements, { ppmRate: 0.2 }, catalog14D8);
  assertEqual('F29 debito', f29.totals.debit, 190000);
  assertEqual('F29 credito excluye rechazados', f29.totals.credit, 19000);
  assertEqual('F29 retencion honorarios', f29.totals.retention, 21000);
  assertEqual('F29 ppm', f29.totals.ppm, 2000);
  assertEqual('F29 total a pagar', f29.totals.totalToPay, 194000);

  const rli14D8 = computeYearlyRli(janMovements, catalog14D8);
  assertEqual('RLI ventas netas', rli14D8.components.ventasNetas, 1000000);
  assertEqual('RLI costos aceptados', rli14D8.components.costos, 300000);
  assertEqual('RLI gastos incluyen import/comision y excluyen rechazados', rli14D8.components.gastos, 330000);
  assertEqual('RLI final', rli14D8.components.rli, 370000);

  const f22_14d8 = computeF22ByRegime(rli14D8.components.rli, '14D8', catalog14D8);
  assertEqual('F22 14D8 atribucion transparente', f22_14d8.transparentAttribution, 370000);

  const f22_14d3 = computeF22ByRegime(rli14D8.components.rli, '14D3', catalog14D3);
  assertEqual('F22 14D3 IDPC', f22_14d3.idpc, 92500);

  const lossScenario = [
    { fecha: '2026-02-01', tipo: 'VENTA', neto: 100000, iva: 19000, costoMercaderia: 120000, accepted: true },
    { fecha: '2026-02-03', tipo: 'GASTO_LOCAL', neto: 50000, iva: 9500, accepted: true }
  ];
  const rliLoss = computeYearlyRli(lossScenario, catalog14D8);
  assertEqual('RLI perdida', rliLoss.components.rli, -70000);
  const f22Loss = computeF22ByRegime(rliLoss.components.rli, '14D8', catalog14D8);
  assertEqual('Atribucion no puede ser negativa', f22Loss.transparentAttribution, 0);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    scenarios: ['base-accepted-rejected', 'loss-floor-at-zero']
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
}
