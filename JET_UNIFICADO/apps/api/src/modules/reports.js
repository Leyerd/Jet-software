const crypto = require('crypto');
const { sendJson } = require('../lib/http');
const { readStore } = require('../lib/store');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient } = require('../lib/postgresRepo');

function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashObject(value) {
  return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function accountMapping(tipoRaw) {
  const tipo = String(tipoRaw || '').toUpperCase();
  if (tipo === 'VENTA') return { debe: '1101-Caja/Bancos', haber: '4101-Ingresos por ventas' };
  if (['GASTO_LOCAL', 'HONORARIOS', 'COMISION_MARKETPLACE'].includes(tipo)) return { debe: '5101-Gastos operacionales', haber: '1101-Caja/Bancos' };
  if (tipo === 'IMPORTACION') return { debe: '1201-Inventarios', haber: '2101-Proveedores' };
  return { debe: '1101-Caja/Bancos', haber: '2102-Cuenta transitoria' };
}

function toNum(v) { return Number(v || 0); }

async function loadMovements(year, month) {
  if (isPostgresMode()) {
    return withPgClient(async (client) => {
      const params = [year];
      let where = 'WHERE EXTRACT(YEAR FROM fecha) = $1';
      if (month) { params.push(month); where += ' AND EXTRACT(MONTH FROM fecha) = $2'; }
      const rs = await client.query(
        `SELECT id, fecha, tipo, descripcion, total, neto, iva, estado
         FROM movimientos
         ${where}
         ORDER BY fecha ASC, id ASC`,
        params
      );
      return rs.rows;
    });
  }
  const state = await readStore();
  return (state.movimientos || []).filter((m) => {
    const d = new Date(m.fecha);
    if (Number.isNaN(d.getTime())) return false;
    if (d.getFullYear() !== year) return false;
    if (month && d.getMonth() + 1 !== month) return false;
    return true;
  });
}

function buildReports(movements, year, month) {
  const diario = movements.map((m) => {
    const map = accountMapping(m.tipo);
    return {
      movementId: m.id,
      fecha: m.fecha,
      glosa: m.descripcion || '',
      tipo: m.tipo,
      cuentaDebe: map.debe,
      cuentaHaber: map.haber,
      debe: Math.round(toNum(m.total || m.neto || 0)),
      haber: Math.round(toNum(m.total || m.neto || 0)),
      source: { table: 'movimientos', id: m.id }
    };
  });

  const mayorMap = new Map();
  for (const d of diario) {
    if (!mayorMap.has(d.cuentaDebe)) mayorMap.set(d.cuentaDebe, { cuenta: d.cuentaDebe, debe: 0, haber: 0, sources: [] });
    if (!mayorMap.has(d.cuentaHaber)) mayorMap.set(d.cuentaHaber, { cuenta: d.cuentaHaber, debe: 0, haber: 0, sources: [] });
    mayorMap.get(d.cuentaDebe).debe += toNum(d.debe);
    mayorMap.get(d.cuentaDebe).sources.push(d.movementId);
    mayorMap.get(d.cuentaHaber).haber += toNum(d.haber);
    mayorMap.get(d.cuentaHaber).sources.push(d.movementId);
  }
  const mayor = [...mayorMap.values()].map((m) => ({ ...m, saldo: Math.round(m.debe - m.haber) }));

  const ingresos = movements.filter(m => String(m.tipo).toUpperCase() === 'VENTA').reduce((a, m) => a + toNum(m.neto || m.total), 0);
  const gastos = movements.filter(m => ['GASTO_LOCAL', 'HONORARIOS', 'COMISION_MARKETPLACE'].includes(String(m.tipo).toUpperCase())).reduce((a, m) => a + toNum(m.neto || m.total), 0);
  const costoVentas = movements.filter(m => String(m.tipo).toUpperCase() === 'VENTA').reduce((a, m) => a + toNum(m.costoMercaderia || 0), 0);

  const estadoResultados = {
    ingresos: Math.round(ingresos),
    costoVentas: Math.round(costoVentas),
    gastos: Math.round(gastos),
    resultado: Math.round(ingresos - costoVentas - gastos),
    traceability: movements.map(m => ({ movementId: m.id, tipo: m.tipo }))
  };

  const activos = mayor.filter(m => String(m.cuenta).startsWith('1')).reduce((a, m) => a + m.saldo, 0);
  const pasivos = mayor.filter(m => String(m.cuenta).startsWith('2')).reduce((a, m) => a + Math.abs(m.saldo), 0);
  const patrimonio = Math.round(activos - pasivos);

  const balance = {
    activos: Math.round(activos),
    pasivos: Math.round(pasivos),
    patrimonio,
    cuadratura: Math.round(activos - pasivos - patrimonio)
  };

  const ivaVentas = movements.filter(m => String(m.tipo).toUpperCase() === 'VENTA').reduce((a, m) => a + toNum(m.iva), 0);
  const ivaCompras = movements.filter(m => ['GASTO_LOCAL', 'IMPORTACION'].includes(String(m.tipo).toUpperCase())).reduce((a, m) => a + toNum(m.iva), 0);

  const iva = {
    compras: Math.round(ivaCompras),
    ventas: Math.round(ivaVentas),
    neto: Math.round(ivaVentas - ivaCompras),
    detail: movements.map(m => ({ movementId: m.id, tipo: m.tipo, iva: Math.round(toNum(m.iva)) }))
  };

  const anexos = {
    period: month ? `${year}-${String(month).padStart(2, '0')}` : String(year),
    movementCount: movements.length,
    sourceTables: ['movimientos'],
    sourceIds: movements.map(m => m.id)
  };

  return { diario, mayor, balance, estadoResultados, iva, anexos };
}

function toCsv(reportName, report) {
  if (Array.isArray(report)) {
    if (!report.length) return '';
    const headers = Object.keys(report[0]);
    const rows = report.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','));
    return `${headers.join(',')}\n${rows.join('\n')}`;
  }
  const entries = Object.entries(report || {});
  return `key,value\n${entries.map(([k, v]) => `${JSON.stringify(k)},${JSON.stringify(typeof v === 'object' ? JSON.stringify(v) : v)}`).join('\n')}`;
}

function toSpreadsheetXml(reportName, report) {
  const csv = toCsv(reportName, report).split('\n').map(line => line.split(','));
  const rows = csv.map(cols => `<Row>${cols.map(c => `<Cell><Data ss:Type="String">${String(c).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Data></Cell>`).join('')}</Row>`).join('');
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${reportName}"><Table>${rows}</Table></Worksheet></Workbook>`;
}

function toSimplePdf(text) {
  const safe = String(text || '').replace(/[()\\]/g, ' ');
  const content = `BT /F1 10 Tf 40 780 Td (${safe.slice(0, 1500)}) Tj ET`;
  const objects = [];
  objects.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj');
  objects.push('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj');
  objects.push('3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >> endobj');
  objects.push('4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj');
  objects.push(`5 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`);

  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) { offsets.push(body.length); body += `${obj}\n`; }
  const xrefPos = body.length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(body, 'utf8');
}

async function getReports(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const query = req.url.includes('?') ? new URL(req.url, 'http://localhost').searchParams : new URLSearchParams();
  const year = Number(query.get('year') || new Date().getFullYear());
  const month = query.get('month') ? Number(query.get('month')) : null;
  const reports = buildReports(await loadMovements(year, month), year, month);
  const hash = hashObject(reports);

  return sendJson(res, 200, {
    ok: true,
    reports,
    metadata: {
      generatedAt: new Date().toISOString(),
      generatedBy: auth.user.email,
      hash,
      period: month ? `${year}-${String(month).padStart(2, '0')}` : `${year}`
    }
  });
}

async function exportReport(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const query = req.url.includes('?') ? new URL(req.url, 'http://localhost').searchParams : new URLSearchParams();
  const year = Number(query.get('year') || new Date().getFullYear());
  const month = query.get('month') ? Number(query.get('month')) : null;
  const reportName = String(query.get('report') || 'diario');
  const format = String(query.get('format') || 'csv').toLowerCase();

  const reports = buildReports(await loadMovements(year, month), year, month);
  if (!reports[reportName]) return sendJson(res, 400, { ok: false, message: 'report inválido' });
  const report = reports[reportName];
  const hash = hashObject(report);
  const metadata = { generatedAt: new Date().toISOString(), generatedBy: auth.user.email, hash, report: reportName, period: month ? `${year}-${String(month).padStart(2, '0')}` : `${year}` };

  if (format === 'csv') {
    const content = `# metadata=${JSON.stringify(metadata)}\n${toCsv(reportName, report)}`;
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${reportName}-${metadata.period}.csv"` });
    res.end(content);
    return;
  }

  if (format === 'xlsx') {
    const xml = toSpreadsheetXml(reportName, report);
    res.writeHead(200, { 'Content-Type': 'application/vnd.ms-excel; charset=utf-8', 'Content-Disposition': `attachment; filename="${reportName}-${metadata.period}.xlsx"`, 'X-Report-Metadata': JSON.stringify(metadata) });
    res.end(xml);
    return;
  }

  if (format === 'pdf') {
    const text = `${reportName.toUpperCase()}\nmeta=${JSON.stringify(metadata)}\n${JSON.stringify(report).slice(0, 1200)}`;
    const pdf = toSimplePdf(text);
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${reportName}-${metadata.period}.pdf"`, 'X-Report-Metadata': JSON.stringify(metadata) });
    res.end(pdf);
    return;
  }

  return sendJson(res, 400, { ok: false, message: 'format inválido (csv|xlsx|pdf)' });
}

module.exports = { getReports, exportReport, buildReports, hashObject };
