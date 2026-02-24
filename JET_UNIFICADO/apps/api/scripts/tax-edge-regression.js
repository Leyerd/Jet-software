#!/usr/bin/env node

const { computeMonthlyF29, computeYearlyRli, computeF22ByRegime, getCatalog } = require('../src/modules/tax');

function assertEq(name, actual, expected) {
  if (actual !== expected) throw new Error(`${name} esperado=${expected} actual=${actual}`);
}

function run() {
  const cat14D8 = getCatalog(2026, '14D8');
  const cat14D3 = getCatalog(2026, '14D3');

  // Escenario: crédito fiscal mayor que débito (no debe pagar IVA negativo)
  const monthCreditCarry = [
    { fecha: '2026-08-01', tipo: 'VENTA', neto: 100000, iva: 19000, accepted: true },
    { fecha: '2026-08-04', tipo: 'GASTO_LOCAL', neto: 200000, iva: 38000, accepted: true },
    { fecha: '2026-08-06', tipo: 'IMPORTACION', neto: 100000, iva: 19000, accepted: true }
  ];
  const f29Carry = computeMonthlyF29(monthCreditCarry, { ppmRate: 0.2 }, cat14D8);
  assertEq('IVA a pagar con crédito superior', f29Carry.totals.ivaToPay, 0);
  assertEq('Total a pagar con crédito superior', f29Carry.totals.totalToPay, 200);

  // Escenario: honorarios rechazados no deben sumar retención
  const monthRejectedFees = [
    { fecha: '2026-09-01', tipo: 'VENTA', neto: 400000, iva: 76000, accepted: true },
    { fecha: '2026-09-02', tipo: 'HONORARIOS', neto: 80000, retention: 9200, accepted: false },
    { fecha: '2026-09-03', tipo: 'HONORARIOS', neto: 40000, retention: 4600, accepted: true }
  ];
  const f29Fees = computeMonthlyF29(monthRejectedFees, { ppmRate: 0.2 }, cat14D8);
  assertEq('Retención con honorarios rechazados excluidos', f29Fees.totals.retention, 4600);


  // Escenario: movimientos legacy (ingreso/egreso + monto) deben mapear a base tributaria
  const legacyMonth = [
    { fecha: '2026-10-01', tipo: 'ingreso', categoria: 'venta_marketplace', monto: 119000, accepted: true },
    { fecha: '2026-10-02', tipo: 'egreso', categoria: 'gasto_operacional', monto: 59500, accepted: true }
  ];
  const f29Legacy = computeMonthlyF29(legacyMonth, { ppmRate: 0.2 }, cat14D8);
  assertEq('Legacy F29 débito', f29Legacy.totals.debit, 19000);
  assertEq('Legacy F29 crédito', f29Legacy.totals.credit, 9500);
  assertEq('Legacy F29 total a pagar', f29Legacy.totals.totalToPay, 9700);
  const rliLegacy = computeYearlyRli(legacyMonth, cat14D8);
  assertEq('Legacy RLI', rliLegacy.components.rli, 50000);

  // Escenario: diferencia por régimen para mismo RLI
  const yearly = [
    { fecha: '2026-01-01', tipo: 'VENTA', neto: 2000000, iva: 380000, costoMercaderia: 700000, accepted: true },
    { fecha: '2026-02-01', tipo: 'GASTO_LOCAL', neto: 400000, iva: 76000, accepted: true },
    { fecha: '2026-03-01', tipo: 'COMISION_MARKETPLACE', neto: 100000, comision: 100000, accepted: true }
  ];
  const rli = computeYearlyRli(yearly, cat14D8);
  const f22_14d8 = computeF22ByRegime(rli.components.rli, '14D8', cat14D8);
  const f22_14d3 = computeF22ByRegime(rli.components.rli, '14D3', cat14D3);
  assertEq('RLI anual esperado', rli.components.rli, 800000);
  assertEq('14D8 atribución', f22_14d8.transparentAttribution, 800000);
  assertEq('14D3 IDPC', f22_14d3.idpc, 200000);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    scenarios: ['carry-credit-floor', 'rejected-fees-excluded', 'legacy-ingreso-egreso-mapping', 'regime-delta-14d8-vs-14d3']
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
}
