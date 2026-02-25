const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');

const NORMATIVE_CATALOG = {
  2026: {
    version: 'cl-tax-2026.1',
    source: 'Servicio de Impuestos Internos (SII) + Ley sobre Impuesto a la Renta (LIR, texto legal vigente)',
    legalBasis: [
      {
        label: 'SII · Portal de formularios e instrucciones tributarias',
        url: 'https://www.sii.cl'
      },
      {
        label: 'BCN · Ley sobre Impuesto a la Renta (LIR)',
        url: 'https://www.bcn.cl/leychile/navegar?idNorma=6368'
      }
    ],
    certification: {
      legalExternalCertification: false,
      note: 'El motor automatiza reglas con trazabilidad de fuente, pero no reemplaza certificación legal externa oficial.'
    },
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


function buildCertificationProfile(baseCertification) {
  const envCertified = String(process.env.TAX_LEGAL_CERTIFIED || '').trim().toLowerCase();
  const legalExternalCertification = ['1', 'true', 'yes', 'si'].includes(envCertified)
    ? true
    : Boolean(baseCertification?.legalExternalCertification);

  return {
    legalExternalCertification,
    authority: process.env.TAX_LEGAL_CERT_AUTHORITY || baseCertification?.authority || null,
    certificateId: process.env.TAX_LEGAL_CERT_ID || baseCertification?.certificateId || null,
    issuedAt: process.env.TAX_LEGAL_CERT_ISSUED_AT || baseCertification?.issuedAt || null,
    expiresAt: process.env.TAX_LEGAL_CERT_EXPIRES_AT || baseCertification?.expiresAt || null,
    verificationUrl: process.env.TAX_LEGAL_CERT_VERIFICATION_URL || baseCertification?.verificationUrl || null,
    status: legalExternalCertification ? 'certified' : 'not_certified',
    note: legalExternalCertification
      ? (process.env.TAX_LEGAL_CERT_NOTE || baseCertification?.note || 'Certificación legal externa registrada por configuración.')
      : (process.env.TAX_LEGAL_CERT_NOTE || baseCertification?.note || 'El motor automatiza reglas con trazabilidad de fuente, pero no reemplaza certificación legal externa oficial.')
  };
}

const NORMATIVE_CHANGELOG = [
  { version: 'cl-tax-2026.1', effectiveFrom: '2026-01-01', scope: ['F29', 'F22', 'DDJJ'], notes: 'Versión base 2026 para 14D8/14D3 con referencia explícita a fuentes legales públicas.', sourceRef: 'SII + LIR (BCN)' },
  { version: 'cl-tax-2026.2', effectiveFrom: '2026-07-01', scope: ['F29', 'F22'], notes: 'Ajuste de trazabilidad y explicación por casilla sin alterar estructura de casillas.', sourceRef: 'SII + LIR (BCN)' }
];

function compareDateIso(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function resolveNormativeVersion(dateLike, preferredVersion) {
  const iso = new Date(dateLike).toISOString().slice(0, 10);
  if (preferredVersion) {
    const hit = NORMATIVE_CHANGELOG.find((x) => x.version === preferredVersion);
    if (hit) return hit;
  }
  const applicable = NORMATIVE_CHANGELOG
    .filter((x) => compareDateIso(x.effectiveFrom, iso) <= 0)
    .sort((a, b) => compareDateIso(a.effectiveFrom, b.effectiveFrom));
  return applicable[applicable.length - 1] || NORMATIVE_CHANGELOG[0];
}

function getCatalog(year, regime) {
  const selectedYear = NORMATIVE_CATALOG[year] ? year : 2026;
  const y = NORMATIVE_CATALOG[selectedYear];
  const rg = y.regimes[regime] ? regime : '14D8';
  return {
    year: selectedYear,
    regime: rg,
    version: y.version,
    source: y.source,
    legalBasis: y.legalBasis || [],
    certification: buildCertificationProfile(y.certification),
    normative: resolveNormativeVersion(`${selectedYear}-01-01`, y.version),
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


function getTaxTipo(movement) {
  const raw = String(movement?.tipo || '').trim().toUpperCase();
  const category = String(movement?.categoria || '').trim().toUpperCase();
  const desc = String(movement?.descripcion || movement?.desc || '').trim().toUpperCase();
  const signature = `${raw} ${category} ${desc}`;

  if (['VENTA', 'GASTO_LOCAL', 'HONORARIOS', 'IMPORTACION', 'COMISION_MARKETPLACE', 'RETIRO'].includes(raw)) return raw;

  if (signature.includes('RETIRO')) return 'RETIRO';
  if (signature.includes('HONOR')) return 'HONORARIOS';
  if (signature.includes('IMPORT')) return 'IMPORTACION';
  if (signature.includes('COMISION') || signature.includes('COMISIÓN')) return 'COMISION_MARKETPLACE';
  if (signature.includes('VENTA') || signature.includes('INGRESO') || signature.includes('BOLETA') || signature.includes('FACTURA')) return 'VENTA';
  if (signature.includes('GASTO') || signature.includes('EGRESO') || signature.includes('COMPRA') || signature.includes('PAGO')) return 'GASTO_LOCAL';

  return raw;
}

function getTaxNeto(movement, tipoNormalized) {
  const declaredNeto = Number(movement?.neto || 0);
  if (!Number.isNaN(declaredNeto) && declaredNeto > 0) return declaredNeto;
  const total = Number(movement?.total ?? movement?.monto ?? 0);
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (['VENTA', 'GASTO_LOCAL', 'IMPORTACION', 'COMISION_MARKETPLACE'].includes(tipoNormalized)) return Math.round(total / 1.19);
  if (tipoNormalized === 'HONORARIOS') return Math.max(0, total - Number(movement?.retention || 0));
  return total;
}

function getTaxIva(movement, tipoNormalized) {
  const declaredIva = Number(movement?.iva || 0);
  if (!Number.isNaN(declaredIva) && declaredIva > 0) return declaredIva;
  const total = Number(movement?.total ?? movement?.monto ?? 0);
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (['VENTA', 'GASTO_LOCAL', 'IMPORTACION', 'COMISION_MARKETPLACE'].includes(tipoNormalized)) {
    const neto = getTaxNeto(movement, tipoNormalized);
    return Math.max(0, Math.round(total - neto));
  }
  return 0;
}

function hasTaxRelevantAmount(movement, tipoNormalized = getTaxTipo(movement)) {
  const total = Number(movement?.total ?? movement?.monto ?? 0);
  const neto = Number(movement?.neto || 0);
  const iva = Number(movement?.iva || 0);
  const retention = Number(movement?.retention || 0);

  if (['VENTA', 'GASTO_LOCAL', 'IMPORTACION', 'COMISION_MARKETPLACE', 'HONORARIOS'].includes(tipoNormalized)) {
    return [total, neto, iva, retention].some((v) => Number.isFinite(v) && v > 0);
  }
  if (tipoNormalized === 'RETIRO') return Number.isFinite(total) && total > 0;
  return [total, neto, iva, retention].some((v) => Number.isFinite(v) && v > 0);
}

function isAcceptedForTax(movement) {
  if (!movement) return false;
  const tipoNormalized = getTaxTipo(movement);
  if (!hasTaxRelevantAmount(movement, tipoNormalized)) return false;
  if (movement.accepted === undefined || movement.accepted === null) return true;
  if (typeof movement.accepted === 'boolean') return movement.accepted;
  if (typeof movement.accepted === 'number') return movement.accepted !== 0;
  const normalized = String(movement.accepted).trim().toLowerCase();
  return !['false', '0', 'no', 'rechazado'].includes(normalized);
}

function parseMovementDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value).trim();
  if (!raw) return null;

  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) return native;

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, d, m, y] = slashMatch;
    const fallback = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    if (!Number.isNaN(fallback.getTime())) return fallback;
  }

  const dashMatch = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    const [, d, m, y] = dashMatch;
    const fallback = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    if (!Number.isNaN(fallback.getTime())) return fallback;
  }

  const compactMatch = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    const [, y, m, d] = compactMatch;
    const fallback = new Date(`${y}-${m}-${d}`);
    if (!Number.isNaN(fallback.getTime())) return fallback;
  }

  return null;
}

function filterYearMovementsByDate(movements, year) {
  let invalidDateCount = 0;
  const yearMovs = (movements || []).filter((m) => {
    const movementDate = parseMovementDate(m?.fecha);
    if (!movementDate) {
      invalidDateCount += 1;
      return false;
    }
    return movementDate.getFullYear() === Number(year);
  });
  return { yearMovs, invalidDateCount };
}

function extractAvailableYears(movements) {
  const years = new Set();
  (movements || []).forEach((m) => {
    const movementDate = parseMovementDate(m?.fecha);
    if (movementDate) years.add(movementDate.getFullYear());
  });
  return Array.from(years).sort((a, b) => a - b);
}

async function loadRuntimeMetaFromDb() {
  return withPgClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS runtime_fragments (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    const rs = await client.query("SELECT key, value FROM runtime_fragments WHERE key IN ('source','migratedAt')");
    const meta = { source: null, migratedAt: null };
    for (const row of rs.rows || []) {
      if (row.key === 'source') meta.source = typeof row.value === 'string' ? row.value : (row.value ?? null);
      if (row.key === 'migratedAt') meta.migratedAt = typeof row.value === 'string' ? row.value : (row.value ?? null);
    }
    return meta;
  });
}

function buildTaxDiagnostics({ year, month, cfg, yearMovs, monthMovs, invalidDateCount, totalMovements = 0, availableYears = [], rliComponents = null, runtimeMeta = {}, allMovements = [] }) {
  const diagnostics = [];
  const hasYearData = yearMovs.length > 0;
  const hasMonthData = monthMovs.length > 0;

  if (invalidDateCount > 0) {
    diagnostics.push({
      code: 'TAX-DIAG-003',
      severity: 'critical',
      reason: 'MOVEMENT_DATE_PARSE_ERROR',
      message: `Hay ${invalidDateCount} movimientos con fecha inválida y no entran en F29/F22.`
    });
  }

  if (!hasYearData) {
    diagnostics.push({
      code: 'TAX-DIAG-001',
      severity: 'critical',
      reason: 'NO_MOVEMENTS_FOR_YEAR',
      message: `No existen movimientos tributarios para el año ${year}.`
    });
  }

  if (!hasYearData && totalMovements === 0) {
    diagnostics.push({
      code: 'TAX-DIAG-006',
      severity: 'critical',
      reason: 'BACKEND_STORAGE_EMPTY',
      message: 'No existen movimientos en el backend. Posible desfase por migración desde frontend local a backend.'
    });
  }

  if (!hasYearData && totalMovements > 0 && Array.isArray(availableYears) && availableYears.length > 0) {
    const minY = Math.min(...availableYears);
    const maxY = Math.max(...availableYears);
    diagnostics.push({
      code: 'TAX-DIAG-007',
      severity: 'warning',
      reason: 'YEAR_WITHOUT_DATA_IN_BACKEND',
      message: `El backend tiene movimientos, pero no para ${year}. Años disponibles: ${minY}-${maxY}.`
    });
  }

  if (hasYearData && !hasMonthData) {
    diagnostics.push({
      code: 'TAX-DIAG-002',
      severity: 'warning',
      reason: 'NO_MOVEMENTS_FOR_MONTH',
      message: `No existen movimientos para el mes ${month} del año ${year}.`
    });
  }

  if (Number(cfg?.year || year) !== Number(year)) {
    diagnostics.push({
      code: 'TAX-DIAG-004',
      severity: 'warning',
      reason: 'CONFIG_YEAR_MISMATCH',
      message: `La configuración tributaria está en ${cfg?.year}, pero el resumen se pidió para ${year}.`
    });
  }


  const rli = Number(rliComponents?.rli || 0);
  const ventasNetas = Number(rliComponents?.ventasNetas || 0);
  const costos = Number(rliComponents?.costos || 0);
  const gastos = Number(rliComponents?.gastos || 0);

  if (rli < 0) {
    diagnostics.push({
      code: 'TAX-DIAG-008',
      severity: 'warning',
      reason: 'NEGATIVE_RLI_LOSS',
      message: `La RLI anual está negativa (${Math.round(rli).toLocaleString('es-CL')}). Corresponde a pérdida tributaria del período.`
    });
  }

  if (ventasNetas <= 0 && (costos > 0 || gastos > 0)) {
    diagnostics.push({
      code: 'TAX-DIAG-009',
      severity: 'warning',
      reason: 'NO_TAXABLE_SALES_WITH_EXPENSES',
      message: 'No hay ventas netas tributarias en el año, pero sí costos/gastos. Verifica clasificación de movimientos y año activo.'
    });
  }
  const importacionesNetas = Number(rliComponents?.importacionesNetas || 0);
  const importacionesYearCount = yearMovs.filter((m) => getTaxTipo(m) === 'IMPORTACION' && isAcceptedForTax(m)).length;
  const importacionesIvaCredito = Math.round(yearMovs
    .filter((m) => getTaxTipo(m) === 'IMPORTACION' && isAcceptedForTax(m))
    .reduce((a, b) => a + getTaxIva(b, 'IMPORTACION'), 0));

  if (rli < 0 && importacionesNetas > 0 && ventasNetas > 0) {
    diagnostics.push({
      code: 'TAX-DIAG-010',
      severity: 'warning',
      reason: 'INVENTORY_RECOGNITION_APPLIED',
      message: 'Se detectan importaciones/compras de inventario en el año. En RLI se excluyen de gasto y se reconoce CMV solo en ventas.'
    });
  }

  if (importacionesYearCount > 0) {
    diagnostics.push({
      code: 'TAX-DIAG-011',
      severity: 'warning',
      reason: 'IMPORTS_TAX_TREATMENT_TRACE',
      message: `Hay ${importacionesYearCount} importaciones aceptadas. Se usan para crédito IVA F29 (IVA ${importacionesIvaCredito.toLocaleString('es-CL')}) y no como gasto directo en RLI/F22.`
    });
  }

  const zeroAmountAcceptedCount = yearMovs.filter((m) => {
    const tipo = getTaxTipo(m);
    if (tipo !== 'IMPORTACION') return false;
    const acceptedFlag = m?.accepted === undefined || m?.accepted === null ? true : isAcceptedForTax(m);
    return acceptedFlag && !hasTaxRelevantAmount(m, tipo);
  }).length;
  if (zeroAmountAcceptedCount > 0) {
    diagnostics.push({
      code: 'TAX-DIAG-013',
      severity: 'warning',
      reason: 'ZERO_AMOUNT_IMPORT_ROWS',
      message: `Se detectaron ${zeroAmountAcceptedCount} importaciones con monto/neto/iva en 0. Se excluyen del cálculo tributario por posible dato fantasma o apertura incompleta.`
    });
  }

  if (!hasYearData && totalMovements > 0 && Array.isArray(availableYears) && availableYears.length > 0) {
    const nearestYear = availableYears.reduce((acc, y) => {
      if (acc === null) return y;
      return Math.abs(Number(y) - Number(year)) < Math.abs(Number(acc) - Number(year)) ? y : acc;
    }, null);
    diagnostics.push({
      code: 'TAX-DIAG-012',
      severity: 'warning',
      reason: 'PERIOD_SELECTION_OUT_OF_RANGE',
      message: `El período ${year} no tiene movimientos en backend. Año más cercano con datos: ${nearestYear}.`
    });
  }


  const backendSource = runtimeMeta?.source || null;
  const backendMigratedAt = runtimeMeta?.migratedAt || null;
  const universe = Array.isArray(allMovements) && allMovements.length ? allMovements : yearMovs;
  const typeBreakdown = universe.reduce((acc, m) => {
    const t = getTaxTipo(m) || 'UNKNOWN';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const knownDates = universe.map((m) => parseMovementDate(m?.fecha)).filter(Boolean);
  const minMovementDate = knownDates.length ? knownDates.reduce((a, b) => (a < b ? a : b)).toISOString().slice(0, 10) : null;
  const maxMovementDate = knownDates.length ? knownDates.reduce((a, b) => (a > b ? a : b)).toISOString().slice(0, 10) : null;
  if (totalMovements > 0 && backendSource) {
    diagnostics.push({
      code: 'TAX-DIAG-014',
      severity: 'warning',
      reason: 'BACKEND_DATA_SOURCE_TRACE',
      message: `El backend ya tenía ${totalMovements} movimientos cargados. Fuente registrada: ${backendSource}.`
    });
  }
  if (totalMovements > 0 && String(backendSource || '').toLowerCase().includes('demo')) {
    diagnostics.push({
      code: 'TAX-DIAG-015',
      severity: 'warning',
      reason: 'DEMO_SEED_DETECTED',
      message: 'Se detecta fuente de datos demo en backend. Si esperabas base vacía, ejecuta reset runtime.'
    });
  }

  if (totalMovements > 0 && !backendSource) {
    diagnostics.push({
      code: 'TAX-DIAG-016',
      severity: 'warning',
      reason: 'BACKEND_MOVEMENTS_WITHOUT_SOURCE_META',
      message: `El backend tiene ${totalMovements} movimientos sin metadata de origen (source=null). Posible carga operativa previa o importación histórica.`
    });
  }

  if (totalMovements > 0) {
    const topTypes = Object.entries(typeBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');
    diagnostics.push({
      code: 'TAX-DIAG-017',
      severity: 'warning',
      reason: 'BACKEND_MOVEMENT_FOOTPRINT',
      message: `Huella backend movimientos=${totalMovements}. Tipos: ${topTypes || 'N/D'}. Rango fechas: ${minMovementDate || 'N/D'}→${maxMovementDate || 'N/D'}.`
    });
  }

  if (!['14D8', '14D3'].includes(String(cfg?.regime || ''))) {
    diagnostics.push({
      code: 'TAX-DIAG-005',
      severity: 'critical',
      reason: 'INVALID_REGIME_CONFIG',
      message: `Régimen inválido detectado (${cfg?.regime || 'N/D'}).`
    });
  }

  return {
    status: diagnostics.some((d) => d.severity === 'critical') ? 'error' : diagnostics.length ? 'warning' : 'ok',
    diagnostics,
    stats: {
      requestedYear: year,
      requestedMonth: month,
      configuredYear: Number(cfg?.year || year),
      configuredRegime: cfg?.regime || '14D8',
      movementsInYear: yearMovs.length,
      movementsInMonth: monthMovs.length,
      invalidDateCount,
      totalMovements,
      availableYears,
      rli: Math.round(rli),
      ventasNetas: Math.round(ventasNetas),
      costos: Math.round(costos),
      gastos: Math.round(gastos),
      importacionesNetas: Math.round(importacionesNetas),
      importacionesYearCount,
      importacionesIvaCredito,
      zeroAmountAcceptedCount,
      backendSource,
      backendMigratedAt,
      movementTypeBreakdown: typeBreakdown,
      minMovementDate,
      maxMovementDate
    }
  };
}

function computeMonthlyF29(movs, config, catalog) {
  const debit = movs.filter(m => getTaxTipo(m) === 'VENTA').reduce((a, b) => a + getTaxIva(b, getTaxTipo(b)), 0);
  const credit = movs
    .filter(m => ['GASTO_LOCAL', 'IMPORTACION'].includes(getTaxTipo(m)) && isAcceptedForTax(m))
    .reduce((a, b) => a + getTaxIva(b, getTaxTipo(b)), 0);
  const netSales = movs.filter(m => getTaxTipo(m) === 'VENTA').reduce((a, b) => a + getTaxNeto(b, getTaxTipo(b)), 0);
  const retention = movs
    .filter(m => getTaxTipo(m) === 'HONORARIOS' && isAcceptedForTax(m))
    .reduce((a, b) => a + Number(b.retention || 0), 0);
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
      version: catalog.normative?.version || catalog.version,
      effectiveFrom: catalog.normative?.effectiveFrom,
      source: catalog.source,
      legalBasis: catalog.legalBasis,
      certification: catalog.certification
    }
  };
}

function computeYearlyRli(movs, catalog) {
  const accepted = movs.filter(isAcceptedForTax);
  const ventas = accepted.filter((m) => getTaxTipo(m) === 'VENTA');
  const ventasNetas = ventas.reduce((a, b) => a + getTaxNeto(b, 'VENTA'), 0);

  // CMV: solo se reconoce por ventas efectivamente realizadas (costoMercaderia en movimientos de VENTA).
  const costos = ventas.reduce((a, b) => a + Number(b.costoMercaderia || b.costo_mercaderia || 0), 0);

  // Bajo esquema con control de inventario, IMPORTACION/COMPRA de inventario no se lleva directo a gasto,
  // sino a costo vía CMV al vender. Evita doble castigo de RLI.
  const gastos = accepted
    .filter((m) => ['GASTO_LOCAL', 'HONORARIOS', 'COMISION_MARKETPLACE'].includes(getTaxTipo(m)))
    .reduce((a, b) => a + getTaxNeto(b, getTaxTipo(b)), 0);

  const importacionesNetas = accepted
    .filter((m) => getTaxTipo(m) === 'IMPORTACION')
    .reduce((a, b) => a + getTaxNeto(b, 'IMPORTACION'), 0);

  const rli = ventasNetas - costos - gastos;

  return {
    components: {
      ventasNetas: Math.round(ventasNetas),
      costos: Math.round(costos),
      gastos: Math.round(gastos),
      importacionesNetas: Math.round(importacionesNetas),
      rli: Math.round(rli)
    },
    ddjjBase: {
      ddjjRelevant: catalog.rules.ddjj,
      provisionalBase: Math.round(Math.max(0, rli))
    },
    trace: {
      rulesApplied: catalog.rules.f22.filter(r => r.id === 'F22-RLI'),
      version: catalog.version,
      source: catalog.source,
      legalBasis: catalog.legalBasis,
      certification: catalog.certification
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
      source: catalog.source,
      legalBasis: catalog.legalBasis,
      certification: catalog.certification
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
    return sendJson(res, 200, { ok: true, taxConfig, catalog: { version: catalog.version, source: catalog.source, legalBasis: catalog.legalBasis, certification: catalog.certification, rules: catalog.rules } });
  }

  const state = await readStore();
  const taxConfig = ensureTaxConfig(state);
  await writeStore(state);
  const catalog = getCatalog(taxConfig.year, taxConfig.regime);
  return sendJson(res, 200, { ok: true, taxConfig, catalog: { version: catalog.version, source: catalog.source, legalBasis: catalog.legalBasis, certification: catalog.certification, rules: catalog.rules } });
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
    return sendJson(res, 200, { ok: true, taxConfig, catalog: { version: catalog.version, source: catalog.source, legalBasis: catalog.legalBasis, certification: catalog.certification } });
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
  return sendJson(res, 200, { ok: true, taxConfig: state.taxConfig, catalog: { version: catalog.version, source: catalog.source, legalBasis: catalog.legalBasis, certification: catalog.certification } });
}

async function getTaxSummary(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const query = req.url.includes('?') ? new URL(req.url, 'http://localhost').searchParams : new URLSearchParams();
  const year = Number(query.get('year') || new Date().getFullYear());
  const month = Number(query.get('month') || (new Date().getMonth() + 1));

  let cfg;
  let yearMovs;
  let invalidDateCount = 0;
  let totalMovements = 0;
  let availableYears = [];
  let runtimeMeta = { source: null, migratedAt: null };
  let allMovements = [];

  if (isPostgresMode()) {
    cfg = await loadTaxConfigFromDb(year);
    yearMovs = await withPgClient(async (client) => {
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS retention NUMERIC(18,2) DEFAULT 0');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS comision NUMERIC(18,2) DEFAULT 0');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS costo_mercaderia NUMERIC(18,2) DEFAULT 0');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS accepted BOOLEAN DEFAULT TRUE');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS document_ref TEXT');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS monto NUMERIC(18,2) DEFAULT 0');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS categoria TEXT');
      const rs = await client.query(
        `SELECT fecha, tipo,
                COALESCE(total, monto, 0) AS total,
                COALESCE(neto, 0) AS neto,
                COALESCE(iva, 0) AS iva,
                COALESCE(monto, total, 0) AS monto,
                COALESCE(categoria, '') AS categoria,
                COALESCE(retention, 0) AS retention,
                COALESCE(comision, 0) AS comision,
                COALESCE(costo_mercaderia, 0) AS "costoMercaderia",
                COALESCE(accepted, TRUE) AS accepted,
                document_ref AS "documentRef"
         FROM movimientos`
      );
      return rs.rows;
    });
    allMovements = Array.isArray(yearMovs) ? [...yearMovs] : [];
    totalMovements = Array.isArray(yearMovs) ? yearMovs.length : 0;
    availableYears = extractAvailableYears(yearMovs);
    runtimeMeta = await loadRuntimeMetaFromDb();
    const filtered = filterYearMovementsByDate(yearMovs, year);
    yearMovs = filtered.yearMovs;
    invalidDateCount = filtered.invalidDateCount;
  } else {
    const state = await readStore();
    cfg = ensureTaxConfig(state);
    const baseMovs = Array.isArray(state.movimientos) ? state.movimientos : [];
    allMovements = [...baseMovs];
    totalMovements = baseMovs.length;
    availableYears = extractAvailableYears(baseMovs);
    runtimeMeta = { source: state.source || null, migratedAt: state.migratedAt || null };
    const filtered = filterYearMovementsByDate(baseMovs, year);
    yearMovs = filtered.yearMovs;
    invalidDateCount = filtered.invalidDateCount;
  }

  const catalog = getCatalog(cfg.year || year, cfg.regime || '14D8');
  const monthMovs = yearMovs.filter((m) => {
    const movementDate = parseMovementDate(m?.fecha);
    return movementDate && (movementDate.getMonth() + 1) === month;
  });

  const f29 = computeMonthlyF29(monthMovs, cfg, catalog);
  const rli = computeYearlyRli(yearMovs, catalog);
  const dataHealth = buildTaxDiagnostics({ year, month, cfg, yearMovs, monthMovs, invalidDateCount, totalMovements, availableYears, rliComponents: rli.components, runtimeMeta, allMovements });
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
      normativeVersion: catalog.normative?.version || catalog.version,
      normativeEffectiveFrom: catalog.normative?.effectiveFrom || `${year}-01-01`,
      normativeSource: catalog.source,
      normativeLegalBasis: catalog.legalBasis,
      normativeCertification: catalog.certification
    },
    dataHealth,
    f29,
    f22: {
      rli,
      selectedRegime,
      alternativeRegime
    },
    trace: {
      appliedRules: [...catalog.rules.f29, ...catalog.rules.f22],
      version: catalog.version,
      source: catalog.source,
      legalBasis: catalog.legalBasis,
      certification: catalog.certification
    }
  });
}


async function getTaxExplainability(req, res) {
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
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS monto NUMERIC(18,2) DEFAULT 0');
      await client.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS categoria TEXT');
      const rs = await client.query(
        `SELECT fecha, tipo,
                COALESCE(total, monto, 0) AS total,
                COALESCE(neto, 0) AS neto,
                COALESCE(iva, 0) AS iva,
                COALESCE(monto, total, 0) AS monto,
                COALESCE(categoria, '') AS categoria,
                COALESCE(retention, 0) AS retention,
                COALESCE(comision, 0) AS comision,
                COALESCE(costo_mercaderia, 0) AS "costoMercaderia",
                COALESCE(accepted, TRUE) AS accepted,
                document_ref AS "documentRef"
         FROM movimientos`
      );
      return rs.rows;
    });
    const filtered = filterYearMovementsByDate(yearMovs, year);
    yearMovs = filtered.yearMovs;
  } else {
    const state = await readStore();
    cfg = ensureTaxConfig(state);
    yearMovs = filterYearMovementsByDate(state.movimientos || [], year).yearMovs;
  }

  const catalog = getCatalog(cfg.year || year, cfg.regime || '14D8');
  const monthMovs = yearMovs.filter((m) => {
    const movementDate = parseMovementDate(m?.fecha);
    return movementDate && (movementDate.getMonth() + 1) === month;
  });
  const f29 = computeMonthlyF29(monthMovs, cfg, catalog);
  const rli = computeYearlyRli(yearMovs, catalog);
  const selectedRegime = computeF22ByRegime(rli.components.rli, cfg.regime, catalog);

  const explainability = {
    period: { year, month, regime: cfg.regime },
    casillas: {
      casilla_538_debitoFiscal: {
        amount: f29.casillas.casilla_538_debitoFiscal,
        formula: 'SUM(iva) para VENTA',
        evidenceCount: monthMovs.filter((m) => getTaxTipo(m) === 'VENTA').length
      },
      casilla_511_creditoFiscal: {
        amount: f29.casillas.casilla_511_creditoFiscal,
        formula: 'SUM(iva) para GASTO_LOCAL/IMPORTACION con accepted=true',
        evidenceCount: monthMovs.filter((m) => ['GASTO_LOCAL', 'IMPORTACION'].includes(getTaxTipo(m)) && isAcceptedForTax(m)).length
      },
      casilla_151_retHonorarios: {
        amount: f29.casillas.casilla_151_retHonorarios,
        formula: 'SUM(retention) para HONORARIOS con accepted=true',
        evidenceCount: monthMovs.filter((m) => getTaxTipo(m) === 'HONORARIOS' && isAcceptedForTax(m)).length
      },
      casilla_062_ppm: {
        amount: f29.casillas.casilla_062_ppm,
        formula: 'SUM(neto ventas) * ppmRate/100',
        ppmRate: Number(cfg.ppmRate || 0)
      }
    },
    f22: {
      rli: rli.components,
      selectedRegime,
      ddjjBase: rli.ddjjBase
    },
    trace: {
      normativeVersion: catalog.normative?.version || catalog.version,
      normativeEffectiveFrom: catalog.normative?.effectiveFrom || `${year}-01-01`,
      normativeSource: catalog.source,
      normativeLegalBasis: catalog.legalBasis,
      normativeCertification: catalog.certification,
      rules: {
        f29: catalog.rules.f29,
        f22: catalog.rules.f22,
        ddjj: catalog.rules.ddjj
      }
    }
  };

  await appendAudit('tax.explainability.generated', { year, month, regime: cfg.regime, normativeVersion: catalog.version }, auth.user.email);
  if (isPostgresMode()) await appendAuditLog('tax.explainability.generated', { year, month, regime: cfg.regime, normativeVersion: catalog.version }, auth.user.email);

  return sendJson(res, 200, { ok: true, explainability });
}


async function getNormativeVersions(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const query = req.url.includes('?') ? new URL(req.url, 'http://localhost').searchParams : new URLSearchParams();
  const year = Number(query.get('year') || new Date().getFullYear());
  const regime = query.get('regime') || '14D8';
  const month = Number(query.get('month') || 1);
  const baseCatalog = getCatalog(year, regime);
  const resolved = resolveNormativeVersion(`${year}-${String(month).padStart(2, '0')}-01`, baseCatalog.version);

  return sendJson(res, 200, {
    ok: true,
    selected: { year, month, regime, version: resolved.version, effectiveFrom: resolved.effectiveFrom },
    timeline: NORMATIVE_CHANGELOG,
    baseCatalog: { version: baseCatalog.version, source: baseCatalog.source, legalBasis: baseCatalog.legalBasis, certification: baseCatalog.certification }
  });
}

module.exports = {
  getTaxConfig,
  updateTaxConfig,
  getTaxSummary,
  getTaxCatalog,
  getTaxExplainability,
  getNormativeVersions,
  ensureTaxConfig,
  getCatalog,
  resolveNormativeVersion,
  computeMonthlyF29,
  computeYearlyRli,
  computeF22ByRegime,
  isAcceptedForTax
};
