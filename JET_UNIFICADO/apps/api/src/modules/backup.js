const fs = require('fs');
const path = require('path');
const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'data', 'backups');

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function ensureBackupStructures(state) {
  if (!Array.isArray(state.backups)) state.backups = [];
  if (!state.backupPolicy || typeof state.backupPolicy !== 'object') {
    state.backupPolicy = { retentionMaxFiles: 20, frequency: 'daily', encryptionPlanned: true, offsitePlanned: true };
  }
}

async function ensurePgBackupTables(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS backup_policy_runtime (
    id INT PRIMARY KEY DEFAULT 1,
    retention_max_files INT NOT NULL DEFAULT 20,
    frequency TEXT NOT NULL DEFAULT 'daily',
    encryption_planned BOOLEAN NOT NULL DEFAULT true,
    offsite_planned BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMP DEFAULT NOW()
  )`);
}

function enforceRetention(state) {
  ensureBackupStructures(state);
  const max = Number(state.backupPolicy.retentionMaxFiles || 20);
  if (max <= 0) return [];
  const ordered = [...state.backups].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const toDelete = ordered.slice(0, Math.max(0, ordered.length - max));
  for (const item of toDelete) {
    const filePath = path.join(BACKUP_DIR, item.fileName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  state.backups = state.backups.filter(b => !toDelete.find(d => d.id === b.id));
  return toDelete;
}

async function getBackupPolicy(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  if (isPostgresMode()) {
    const policy = await withPgClient(async (client) => {
      await ensurePgBackupTables(client);
      await client.query(`INSERT INTO backup_policy_runtime (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
      const rs = await client.query('SELECT retention_max_files AS "retentionMaxFiles", frequency, encryption_planned AS "encryptionPlanned", offsite_planned AS "offsitePlanned" FROM backup_policy_runtime WHERE id=1');
      return rs.rows[0];
    });
    return sendJson(res, 200, { ok: true, policy });
  }

  const state = await readStore();
  ensureBackupStructures(state);
  return sendJson(res, 200, { ok: true, policy: state.backupPolicy });
}

async function updateBackupPolicy(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const body = await parseBody(req);
  const retentionMaxFiles = Number(body.retentionMaxFiles || 20);
  const frequency = body.frequency || 'daily';
  if (!['daily', 'weekly', 'monthly'].includes(frequency)) return sendJson(res, 400, { ok: false, message: 'frequency inválida (daily|weekly|monthly)' });
  if (retentionMaxFiles < 1 || retentionMaxFiles > 365) return sendJson(res, 400, { ok: false, message: 'retentionMaxFiles debe estar entre 1 y 365' });

  if (isPostgresMode()) {
    const policy = await withPgClient(async (client) => {
      await ensurePgBackupTables(client);
      await client.query(
        `INSERT INTO backup_policy_runtime (id, retention_max_files, frequency, encryption_planned, offsite_planned, updated_at)
         VALUES (1, $1, $2, $3, $4, NOW())
         ON CONFLICT (id)
         DO UPDATE SET retention_max_files=$1, frequency=$2, encryption_planned=$3, offsite_planned=$4, updated_at=NOW()`,
        [retentionMaxFiles, frequency, body.encryptionPlanned !== undefined ? Boolean(body.encryptionPlanned) : true, body.offsitePlanned !== undefined ? Boolean(body.offsitePlanned) : true]
      );
      const rs = await client.query('SELECT retention_max_files AS "retentionMaxFiles", frequency, encryption_planned AS "encryptionPlanned", offsite_planned AS "offsitePlanned" FROM backup_policy_runtime WHERE id=1');
      return rs.rows[0];
    });
    await appendAuditLog('backup.policy.update', { policy }, auth.user.email);
    return sendJson(res, 200, { ok: true, policy, removedCount: 0 });
  }

  const state = await readStore();
  ensureBackupStructures(state);
  state.backupPolicy = {
    ...state.backupPolicy,
    retentionMaxFiles,
    frequency,
    encryptionPlanned: body.encryptionPlanned !== undefined ? Boolean(body.encryptionPlanned) : state.backupPolicy.encryptionPlanned,
    offsitePlanned: body.offsitePlanned !== undefined ? Boolean(body.offsitePlanned) : state.backupPolicy.offsitePlanned
  };
  const removed = enforceRetention(state);
  await writeStore(state);
  await appendAudit('backup.policy.update', { policy: state.backupPolicy, removedCount: removed.length }, auth.user.email);
  return sendJson(res, 200, { ok: true, policy: state.backupPolicy, removedCount: removed.length });
}

async function createBackup(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  ensureBackupDir();
  const body = await parseBody(req);
  const reason = body.reason || 'manual';

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const backupId = `BKP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const fileName = `jet-backup-${stamp}.json`;
  const filePath = path.join(BACKUP_DIR, fileName);

  if (isPostgresMode()) {
    const snapshot = await withPgClient(async (client) => {
      await ensurePgBackupTables(client);
      const [usuarios, productos, movimientos, periodos, tax, docs] = await Promise.all([
        client.query('SELECT id, email, nombre, rol, creado_en AS "creadoEn" FROM usuarios'),
        client.query('SELECT id, sku, nombre, stock, costo_promedio AS "costoPromedio" FROM productos'),
        client.query('SELECT id, fecha, tipo, descripcion, total, neto, iva, n_doc AS "nDoc" FROM movimientos'),
        client.query('SELECT anio, mes, estado, cerrado_por AS "cerradoPor", cerrado_en AS "cerradoEn", reabierto_por AS "reabiertoPor", reabierto_en AS "reabiertoEn", motivo_reapertura AS "motivoReapertura" FROM periodos_contables'),
        client.query('SELECT anio AS year, regimen AS regime, ppm_rate AS "ppmRate", iva_rate AS "ivaRate", ret_rate AS "retentionRate" FROM tax_config ORDER BY id DESC LIMIT 1'),
        client.query('SELECT id, tipo_dte AS "tipoDte", folio, fecha_emision AS "fechaEmision", total, iva FROM documentos_fiscales')
      ]);
      return {
        usuarios: usuarios.rows,
        productos: productos.rows,
        movimientos: movimientos.rows,
        periodos: periodos.rows,
        taxConfig: tax.rows[0] || null,
        documentosFiscales: docs.rows
      };
    });

    fs.writeFileSync(filePath, JSON.stringify({ backupId, createdAt: now.toISOString(), reason, createdBy: auth.user.email, snapshot }, null, 2));
    const sizeBytes = fs.statSync(filePath).size;

    const retentionMaxFiles = await withPgClient(async (client) => {
      await ensurePgBackupTables(client);
      await client.query('INSERT INTO backup_policy_runtime (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
      const p = await client.query('SELECT retention_max_files FROM backup_policy_runtime WHERE id=1');
      await client.query('INSERT INTO backups (tipo, ruta, estado, generado_en) VALUES ($1, $2, $3, NOW())', ['json', fileName, 'ok']);
      return Number(p.rows[0]?.retention_max_files || 20);
    });

    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).map(f => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs })).sort((a, b) => a.t - b.t);
    const remove = files.slice(0, Math.max(0, files.length - retentionMaxFiles));
    for (const r of remove) fs.unlinkSync(path.join(BACKUP_DIR, r.f));

    await appendAuditLog('backup.create', { backupId, reason, removedCount: remove.length }, auth.user.email);
    return sendJson(res, 201, { ok: true, backup: { id: backupId, createdAt: now.toISOString(), reason, fileName, sizeBytes }, retentionRemoved: remove.map(r => r.f) });
  }

  const state = await readStore();
  ensureBackupStructures(state);
  const payload = { backupId, createdAt: now.toISOString(), reason, createdBy: auth.user.email, snapshot: state };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  const sizeBytes = fs.statSync(filePath).size;
  state.backups.push({ id: backupId, createdAt: payload.createdAt, createdBy: auth.user.email, reason, fileName, sizeBytes });
  const removed = enforceRetention(state);
  await writeStore(state);
  await appendAudit('backup.create', { backupId, reason, removedCount: removed.length }, auth.user.email);
  return sendJson(res, 201, { ok: true, backup: { id: backupId, createdAt: payload.createdAt, reason, fileName, sizeBytes }, retentionRemoved: removed.map(r => r.id) });
}

async function listBackups(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  if (isPostgresMode()) {
    ensureBackupDir();
    const rows = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { id: f, fileName: f, createdAt: new Date(st.mtimeMs).toISOString(), sizeBytes: st.size };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const policy = await withPgClient(async (client) => {
      await ensurePgBackupTables(client);
      await client.query('INSERT INTO backup_policy_runtime (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
      const rs = await client.query('SELECT retention_max_files AS "retentionMaxFiles", frequency, encryption_planned AS "encryptionPlanned", offsite_planned AS "offsitePlanned" FROM backup_policy_runtime WHERE id=1');
      return rs.rows[0];
    });
    return sendJson(res, 200, { ok: true, count: rows.length, backups: rows, policy });
  }

  const state = await readStore();
  ensureBackupStructures(state);
  const rows = [...state.backups].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return sendJson(res, 200, { ok: true, count: rows.length, backups: rows, policy: state.backupPolicy });
}

async function restoreBackup(req, res) {
  const auth = await requireRoles(req, ['dueno']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const backupId = body.backupId;
  if (!backupId) return sendJson(res, 400, { ok: false, message: 'backupId es requerido' });

  if (isPostgresMode()) {
    const filePath = path.join(BACKUP_DIR, backupId.endsWith('.json') ? backupId : `${backupId}`);
    if (!fs.existsSync(filePath)) return sendJson(res, 404, { ok: false, message: 'Archivo de backup no existe' });
    return sendJson(res, 200, { ok: true, restoredBackupId: backupId, message: 'restore postgres completo pendiente; respaldo validado' });
  }

  const state = await readStore();
  ensureBackupStructures(state);
  const backup = state.backups.find(b => b.id === backupId);
  if (!backup) return sendJson(res, 404, { ok: false, message: 'Backup no encontrado' });
  const filePath = path.join(BACKUP_DIR, backup.fileName);
  if (!fs.existsSync(filePath)) return sendJson(res, 404, { ok: false, message: 'Archivo de backup no existe' });
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const snapshot = payload.snapshot;
  if (!snapshot || typeof snapshot !== 'object') return sendJson(res, 422, { ok: false, message: 'Backup corrupto: snapshot inválido' });
  const previousBackups = Array.isArray(state.backups) ? state.backups : [];
  const previousPolicy = state.backupPolicy || null;
  snapshot.backups = previousBackups;
  snapshot.backupPolicy = previousPolicy;
  await writeStore(snapshot);
  await appendAudit('backup.restore', { backupId, restoredFrom: backup.fileName }, auth.user.email);
  return sendJson(res, 200, { ok: true, restoredBackupId: backupId });
}

module.exports = { getBackupPolicy, updateBackupPolicy, createBackup, listBackups, restoreBackup };
