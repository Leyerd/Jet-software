function movement(id, y, m, d, tipo, descripcion, neto, iva = 0, extra = {}) {
  return {
    id,
    fecha: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    tipo,
    descripcion,
    desc: descripcion,
    neto,
    iva,
    total: Math.round(neto + iva),
    ...extra
  };
}

function buildDemoCatalog() {
  return [
    { id: 1, sku: 'CAM-001', nombre: 'Camiseta Premium', categoria: 'Textil', costoPromedio: 8900, stock: 160 },
    { id: 2, sku: 'JEA-002', nombre: 'Jeans Slim Fit', categoria: 'Textil', costoPromedio: 17900, stock: 110 },
    { id: 3, sku: 'ZAP-003', nombre: 'Zapatilla Urbana', categoria: 'Calzado', costoPromedio: 24900, stock: 90 },
    { id: 4, sku: 'CHA-004', nombre: 'Chaqueta Outdoor', categoria: 'Textil', costoPromedio: 35900, stock: 75 },
    { id: 5, sku: 'POL-005', nombre: 'Polerón Básico', categoria: 'Textil', costoPromedio: 14900, stock: 130 },
    { id: 6, sku: 'CAL-006', nombre: 'Calcetín Deportivo', categoria: 'Accesorios', costoPromedio: 2200, stock: 520 },
    { id: 7, sku: 'GOR-007', nombre: 'Gorro Lana', categoria: 'Accesorios', costoPromedio: 4900, stock: 210 },
    { id: 8, sku: 'MOC-008', nombre: 'Mochila Urbana', categoria: 'Accesorios', costoPromedio: 21900, stock: 65 },
    { id: 9, sku: 'CAM-009', nombre: 'Camisa Casual', categoria: 'Textil', costoPromedio: 16900, stock: 95 },
    { id: 10, sku: 'PAN-010', nombre: 'Pantalón Chino', categoria: 'Textil', costoPromedio: 20900, stock: 82 },
    { id: 11, sku: 'BLU-011', nombre: 'Blusa Formal', categoria: 'Textil', costoPromedio: 18900, stock: 70 },
    { id: 12, sku: 'VES-012', nombre: 'Vestido Midi', categoria: 'Textil', costoPromedio: 23900, stock: 54 },
    { id: 13, sku: 'SND-013', nombre: 'Sandalia Verano', categoria: 'Calzado', costoPromedio: 12900, stock: 92 },
    { id: 14, sku: 'BOT-014', nombre: 'Botín Cuero', categoria: 'Calzado', costoPromedio: 32900, stock: 48 },
    { id: 15, sku: 'PAR-015', nombre: 'Parka Térmica', categoria: 'Textil', costoPromedio: 44900, stock: 37 },
    { id: 16, sku: 'BUF-016', nombre: 'Bufanda Tejida', categoria: 'Accesorios', costoPromedio: 5900, stock: 142 },
    { id: 17, sku: 'CIN-017', nombre: 'Cinturón Cuero', categoria: 'Accesorios', costoPromedio: 7900, stock: 160 },
    { id: 18, sku: 'BOL-018', nombre: 'Bolso Mano', categoria: 'Accesorios', costoPromedio: 19900, stock: 61 },
    { id: 19, sku: 'TRA-019', nombre: 'Traje Ejecutivo', categoria: 'Textil', costoPromedio: 55900, stock: 26 },
    { id: 20, sku: 'TEN-020', nombre: 'Tenis Running', categoria: 'Calzado', costoPromedio: 27900, stock: 68 }
  ];
}

function buildDemoMovements(products) {
  const movimientos = [];
  let id = 1000;

  const yearlyScale = {
    2024: 0.92,
    2025: 1.0,
    2026: 1.12
  };

  for (const year of [2024, 2025, 2026]) {
    const scale = yearlyScale[year];
    for (let month = 1; month <= 12; month += 1) {
      const saleCount = month % 2 === 0 ? 4 : 3;
      for (let i = 0; i < saleCount; i += 1) {
        const p = products[(month * 3 + i + year) % products.length];
        const cant = ((month + i) % 5) + 2;
        const neto = Math.round(p.costoPromedio * cant * 2.15 * scale);
        const iva = Math.round(neto * 0.19);
        movimientos.push(movement(
          ++id,
          year,
          month,
          2 + i * 6,
          'VENTA',
          `Venta ${p.nombre} #${year}-${month}-${i + 1}`,
          neto,
          iva,
          {
            prodId: p.id,
            cant,
            costoMercaderia: Math.round(p.costoPromedio * cant),
            nDoc: `BOL-${year}${String(month).padStart(2, '0')}-${i + 1}`,
            cuentaId: month % 2 === 0 ? 'banco' : 'caja'
          }
        ));
      }

      // gastos operacionales
      const gastoNeto = Math.round((220000 + month * 35000) * scale);
      const gastoIva = Math.round(gastoNeto * 0.19);
      movimientos.push(movement(
        ++id,
        year,
        month,
        18,
        'GASTO_LOCAL',
        `Gasto operacional ${year}-${String(month).padStart(2, '0')}`,
        gastoNeto,
        gastoIva,
        { nDoc: `FAC-G-${year}${String(month).padStart(2, '0')}` }
      ));

      // honorarios en meses trimestrales
      if (month % 3 === 0) {
        const bruto = Math.round((240000 + month * 9000) * scale);
        const retention = Math.round(bruto * 0.145);
        movimientos.push(movement(
          ++id,
          year,
          month,
          21,
          'HONORARIOS',
          `Honorarios asesoría tributaria ${year}-${month}`,
          bruto,
          0,
          { retention, nDoc: `HON-${year}${String(month).padStart(2, '0')}` }
        ));
      }

      // importaciones periódicas
      if ([2, 5, 8, 11].includes(month)) {
        const p = products[(month + year) % products.length];
        const cant = 40 + (month % 4) * 10;
        const neto = Math.round(p.costoPromedio * cant * scale);
        movimientos.push(movement(
          ++id,
          year,
          month,
          25,
          'IMPORTACION',
          `Importación lote ${p.nombre} ${year}-${month}`,
          neto,
          0,
          {
            prodId: p.id,
            cant,
            costoMercaderia: neto,
            nDoc: `IMP-${year}${String(month).padStart(2, '0')}`,
            accepted: true
          }
        ));
      }
    }
  }

  return movimientos;
}

function buildDemoState() {
  const products = buildDemoCatalog();
  const movimientos = buildDemoMovements(products);

  const state = {
    migratedAt: null,
    source: 'seed-demo-multiyear',
    usuarios: [
      { id: 1, email: 'dueno@demo.cl', nombre: 'Dueño Demo', rol: 'dueno', activo: true },
      { id: 2, email: 'contador@demo.cl', nombre: 'Contador Demo', rol: 'contador_admin', activo: true },
      { id: 3, email: 'auditor@demo.cl', nombre: 'Auditor Demo', rol: 'auditor', activo: true }
    ],
    sesiones: [],
    productos: products,
    movimientos,
    cuentas: [
      { id: 'caja', nombre: 'Caja', tipo: 'efectivo', moneda: 'CLP', saldo: 6850000 },
      { id: 'banco', nombre: 'Banco Estado', tipo: 'banco', moneda: 'CLP', saldo: 19250000 },
      { id: 'banchile', nombre: 'Banco Chile', tipo: 'banco', moneda: 'CLP', saldo: 6400000 },
      { id: 'mp', nombre: 'Mercado Pago', tipo: 'fintech', moneda: 'CLP', saldo: 1840000 }
    ],
    terceros: [
      { id: '76.123.456-7', rut: '76.123.456-7', nombre: 'Proveedor Andes SpA', tipo: 'PROVEEDOR' },
      { id: '77.888.999-1', rut: '77.888.999-1', nombre: 'Cliente Retail Sur', tipo: 'CLIENTE' },
      { id: '76.555.222-4', rut: '76.555.222-4', nombre: 'Logística Patagonia Ltda', tipo: 'PROVEEDOR' },
      { id: '11.111.111-1', rut: '11.111.111-1', nombre: 'Javier Demo', tipo: 'SOCIO' },
      { id: '22.222.222-2', rut: '22.222.222-2', nombre: 'Ana Demo', tipo: 'SOCIO' }
    ],
    flujoCaja: [],
    periodos: [
      { id: '2024-12', year: 2024, month: 12, status: 'closed' },
      { id: '2025-12', year: 2025, month: 12, status: 'closed' },
      { id: '2026-12', year: 2026, month: 12, status: 'open' }
    ],
    auditLog: [
      { id: 'seed-1', event: 'seed.demo.loaded', at: new Date().toISOString(), actor: 'system' }
    ],
    asientos: [],
    asientoLineas: [],
    taxConfig: { regime: '14D8', year: 2026, ppmRate: 0.2, ivaRate: 0.19, retentionRate: 14.5 },
    cartolaMovimientos: [],
    rcvVentas: [],
    marketplaceOrders: [],
    rcvCompras: [],
    integrationConfigs: {
      alibaba: { enabled: false, lastSyncAt: null },
      mercadolibre: { enabled: false, lastSyncAt: null },
      sii: { enabled: false, lastSyncAt: null }
    },
    integrationSyncLog: [],
    complianceObligations: [],
    complianceEvidence: [],
    complianceConfig: {
      taxpayerType: 'EIRL',
      alerts: { emailEnabled: false, webhookEnabled: false, emailTo: '', webhookUrl: '' },
      escalationDaysBefore: [7, 3, 1]
    },
    chartOfAccounts: [],
    accountingRules: [],
    costCenters: [],
    approvalRequests: [],
    normativeChanges: [],
    normativeRegressionRuns: [],
    normativePolicy: { monthlyReviewEnabled: true, ownerRole: 'contador_admin', hotfixWindowHours: 24, lastReviewedAt: null },
    backups: [],
    backupPolicy: { retentionMaxFiles: 20, frequency: 'daily', encryptionPlanned: true, offsitePlanned: true }
  };

  const totalsByYear = movimientos.reduce((acc, m) => {
    const y = Number(String(m.fecha).slice(0, 4));
    acc[y] = acc[y] || { ventas: 0, gastos: 0, importaciones: 0, honorarios: 0 };
    if (m.tipo === 'VENTA') acc[y].ventas += m.total;
    else if (m.tipo === 'GASTO_LOCAL') acc[y].gastos += m.total;
    else if (m.tipo === 'IMPORTACION') acc[y].importaciones += m.total;
    else if (m.tipo === 'HONORARIOS') acc[y].honorarios += m.total;
    return acc;
  }, {});

  return {
    state,
    totalsByYear,
    products: products.length,
    movements: movimientos.length,
    thirdParties: state.terceros.length,
    accounts: state.cuentas.length
  };
}

module.exports = { buildDemoState };
