function movement(id, y, m, d, tipo, descripcion, neto, iva = 0, extra = {}) {
  return {
    id,
    fecha: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    tipo,
    descripcion,
    neto,
    iva,
    total: neto + iva,
    ...extra
  };
}

function buildDemoState() {
  const products = [
    { id: 1, sku: 'CAM-001', nombre: 'Camiseta Premium', categoria: 'Textil', costoPromedio: 8900, stock: 120 },
    { id: 2, sku: 'JEA-002', nombre: 'Jeans Slim Fit', categoria: 'Textil', costoPromedio: 17900, stock: 80 },
    { id: 3, sku: 'ZAP-003', nombre: 'Zapatilla Urbana', categoria: 'Calzado', costoPromedio: 24900, stock: 60 }
  ];

  const movimientos = [
    movement(1001, 2024, 3, 5, 'VENTA', 'Venta ecommerce #A-1001', 650000, 123500),
    movement(1002, 2024, 3, 9, 'GASTO', 'Arriendo local marzo', 420000, 79800),
    movement(1003, 2024, 4, 2, 'IMPORTACION', 'Compra lote proveedores Asia', 1900000, 0),
    movement(1004, 2024, 5, 15, 'VENTA', 'Venta marketplace #M-442', 780000, 148200),

    movement(2001, 2025, 1, 12, 'VENTA', 'Venta mayorista #B-210', 1200000, 228000),
    movement(2002, 2025, 2, 10, 'GASTO', 'Servicio logístico', 160000, 30400),
    movement(2003, 2025, 5, 20, 'VENTA', 'Campaña invierno', 990000, 188100),
    movement(2004, 2025, 7, 7, 'GASTO', 'Publicidad digital', 210000, 39900),
    movement(2005, 2025, 9, 1, 'VENTA', 'Venta retail septiembre', 1430000, 271700),

    movement(3001, 2026, 1, 8, 'VENTA', 'Apertura temporada 2026', 1110000, 210900),
    movement(3002, 2026, 2, 19, 'GASTO', 'Sueldos febrero', 840000, 0),
    movement(3003, 2026, 3, 11, 'VENTA', 'Venta web #W-889', 1320000, 250800),
    movement(3004, 2026, 3, 21, 'IMPORTACION', 'Reposición calzado', 2100000, 0),
    movement(3005, 2026, 4, 6, 'VENTA', 'Venta tienda física abril', 970000, 184300)
  ];

  const state = {
    migratedAt: null,
    source: 'seed-demo-multiyear',
    usuarios: [
      { id: 1, email: 'dueno@demo.cl', nombre: 'Dueño Demo', rol: 'dueno', activo: true },
      { id: 2, email: 'contador@demo.cl', nombre: 'Contador Demo', rol: 'contador_admin', activo: true }
    ],
    sesiones: [],
    productos: products,
    movimientos,
    cuentas: [
      { id: 1, nombre: 'Caja', moneda: 'CLP', saldo: 4200000 },
      { id: 2, nombre: 'Banco Estado', moneda: 'CLP', saldo: 13800000 }
    ],
    terceros: [
      { id: 1, rut: '76.123.456-7', nombre: 'Proveedor Andes SpA', tipo: 'PROVEEDOR' },
      { id: 2, rut: '77.888.999-1', nombre: 'Cliente Retail Sur', tipo: 'CLIENTE' }
    ],
    flujoCaja: [],
    periodos: [
      { id: '2024-12', year: 2024, month: 12, status: 'closed' },
      { id: '2025-12', year: 2025, month: 12, status: 'closed' },
      { id: '2026-04', year: 2026, month: 4, status: 'open' }
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
    acc[y] = acc[y] || { ventas: 0, gastos: 0, importaciones: 0 };
    if (m.tipo === 'VENTA') acc[y].ventas += m.total;
    else if (m.tipo === 'GASTO') acc[y].gastos += m.total;
    else if (m.tipo === 'IMPORTACION') acc[y].importaciones += m.total;
    return acc;
  }, {});

  return { state, totalsByYear, products: products.length, movements: movimientos.length };
}

module.exports = { buildDemoState };
