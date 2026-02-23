const crypto = require('crypto');
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

function sha(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function resolveEncryptionKey() {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  const source = raw || 'dev-backup-key-change-me';
  if (/^[0-9a-fA-F]{64}$/.test(source)) return Buffer.from(source, 'hex');
  try {
    const b = Buffer.from(source, 'base64');
    if (b.length === 32) return b;
  } catch (e) {
    // ignore decode
  }
  return crypto.createHash('sha256').update(source).digest();
}

function encryptPayload(payload) {
  const key = resolveEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64')
  };
}

function decryptPayload(envelope) {
  const key = resolveEncryptionKey();
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.authTag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}

function ensureBackupStructures(state) {
  if (!Array.isArray(state.backups)) state.backups = [];
  if (!state.backupPolicy || typeof state.backupPolicy !== 'object') {
    state.backupPolicy = {
      retentionMaxFiles: 20,
      frequency: 'daily',
      encryptionEnabled: true,
      offsiteEnabled: false,
      offsitePath: null,
      rpoHours: 24,
      rtoHours: 4,
      restoreValidationFrequency: 'weekly',
      lastValidationAt: null
    };
  }
}

async function ensurePgBackupTables(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS backup_policy_runtime (
    id INT PRIMARY KEY DEFAULT 1,
    retention_max_files INT NOT NULL DEFAULT 20,
    frequency TEXT NOT NULL DEFAULT 'daily',
    encryption_enabled BOOLEAN NOT NULL DEFAULT true,
    offsite_enabled BOOLEAN NOT NULL DEFAULT false,
    offsite_path TEXT,
    rpo_hours INT NOT NULL DEFAULT 24,
    rto_hours INT NOT NULL DEFAULT 4,
    restore_validation_frequency TEXT NOT NULL DEFAULT 'weekly',
    last_validation_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW()
  )`);

  await client.query(`ALTER TABLE backup_policy_runtime ADD COLUMN IF NOT EXISTS encryption_enabled BOOLEAN NOT NULL DEFAULT true`);
  await client.query(`ALTER TABLE backup_policy_runtime ADD COLUMN IF NOT EXISTS offsite_enabled BOOLEAN NOT NULL DEFAULT false`);
  await client.query(`ALTER TABLE backup_policy_runtime ADD COLUMN IF NOT EXISTS offsite_path TEXT`);
  await client.query(`ALTER TABLE backup_policy_runtime ADD COLUMN IF NOT EXISTS rpo_hours INT NOT NULL DEFAULT 24`);
  await client.query(`ALTER TABLE backup_policy_runtime ADD COLUMN IF NOT EXISTS rto_hours INT NOT NULL DEFAULT 4`);
  await client.query(`ALTER TABLE backup_policy_runtime ADD COLUMN IF NOT EXISTS restore_validation_frequency TEXT NOT NULL DEFAULT 'weekly'`);
  await client.query(`ALTER TABLE backup_policy_runtime ADD COLUMN IF NOT EXISTS last_validation_at TIMESTAMP`);

  await client.query(`CREATE TABLE IF NOT EXISTS backup_restore_validations (
    id BIGSERIAL PRIMARY KEY,
    backup_file TEXT NOT NULL,
    status TEXT NOT NULL,
    details JSONB,
    duration_ms INT,
    validated_at TIMESTAMP DEFAULT NOW(),
    validated_by TEXT
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

function policyFromBody(body, current = {}) {
  const retentionMaxFiles = Number(body.retentionMaxFiles ?? current.retentionMaxFiles ?? 20);
  const frequency = body.frequency || current.frequency || 'daily';
  const restoreValidationFrequency = body.restoreValidationFrequency || current.restoreValidationFrequency || 'weekly';
  const rpoHours = Number(body.rpoHours ?? current.rpoHours ?? 24);
  const rtoHours = Number(body.rtoHours ?? current.rtoHours ?? 4);
  if (!['daily', 'weekly', 'monthly'].includes(frequency)) throw new Error('frequency inválida (daily|weekly|monthly)');
  if (!['daily', 'weekly', 'monthly'].includes(restoreValidationFrequency)) throw new Error('restoreValidationFrequency inválida (daily|weekly|monthly)');
  if (retentionMaxFiles < 1 || retentionMaxFiles > 365) throw new Error('retentionMaxFiles debe estar entre 1 y 365');
  if (rpoHours < 1 || rpoHours > 720) throw new Error('rpoHours debe estar entre 1 y 720');
  if (rtoHours < 1 || rtoHours > 168) throw new Error('rtoHours debe estar entre 1 y 168');
  return {
    retentionMaxFiles,
    frequency,
    encryptionEnabled: body.encryptionEnabled !== undefined ? Boolean(body.encryptionEnabled) : (current.encryptionEnabled ?? true),
    offsiteEnabled: body.offsiteEnabled !== undefined ? Boolean(body.offsiteEnabled) : (current.offsiteEnabled ?? false),
    offsitePath: body.offsitePath !== undefined ? (body.offsitePath || null) : (current.offsitePath || null),
    rpoHours,
    rtoHours,
    restoreValidationFrequency,
    lastValidationAt: current.lastValidationAt || null
  };
}

async function getBackupPolicy(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  if (isPostgresMode()) {
    const policy = await withPgClient(async (client) => {
      await ensurePgBackupTables(client);
      await client.query('INSERT INTO backup_policy_runtime (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
      const rs = await client.query(
        `SELECT retention_max_files AS "retentionMaxFiles", frequency, encryption_enabled AS "encryptionEnabled",
                offsite_enabled AS "offsiteEnabled", offsite_path AS "offsitePath", rpo_hours AS "rpoHours",
                rto_hours AS "rtoHours", restore_validation_frequency AS "restoreValidationFrequency",
                last_validation_at AS "lastValidationAt"
         FROM backup_policy_runtime WHERE id=1`
      );
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

  if (isPostgresMode()) {
    const policy = await withPgClient(async (client) => {
      await ensurePgBackupTables(client);
      await client.query('INSERT INTO backup_policy_runtime (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
      const currentRs = await client.query(
        `SELECT retention_max_files AS "retentionMaxFiles", frequency, encryption_enabled AS "encryptionEnabled",
                offsite_enabled AS "offsiteEnabled", offsite_path AS "offsitePath", rpo_hours AS "rpoHours",
                rto_hours AS "rtoHours", restore_validation_frequency AS "restoreValidationFrequency",
                last_validation_at AS "lastValidationAt"
         FROM backup_policy_runtime WHERE id=1`
      );
      const policyCandidate = policyFromBody(body, currentRs.rows[0] || {});
      await client.query(
        `UPDATE backup_policy_runtime
         SET retention_max_files=$1, frequency=$2, encryption_enabled=$3, offsite_enabled=$4, offsite_path=$5,
             rpo_hours=$6, rto_hours=$7, restore_validation_frequency=$8, updated_at=NOW()
         WHERE id=1`,
        [policyCandidate.retentionMaxFiles, policyCandidate.frequency, policyCandidate.encryptionEnabled, policyCandidate.offsiteEnabled,
          policyCandidate.offsitePath, policyCandidate.rpoHours, policyCandidate.rtoHours, policyCandidate.restoreValidationFrequency]
      );
      const rs = await client.query(
        `SELECT retention_max_files AS "retentionMaxFiles", frequency, encryption_enabled AS "encryptionEnabled",
                offsite_enabled AS "offsiteEnabled", offsite_path AS "offsitePath", rpo_hours AS "rpoHours",
                rto_hours AS "rtoHours", restore_validation_frequency AS "restoreValidationFrequency",
                last_validation_at AS "lastValidationAt"
         FROM backup_policy_runtime WHERE id=1`
      );
      return rs.rows[0];
    });
    await appendAuditLog('backup.policy.update', { policy }, auth.user.email);
    return sendJson(res, 200, { ok: true, policy, removedCount: 0 });
  }

  const state = await readStore();
  ensureBackupStructures(state);
  let policy;
  try {
    policy = policyFromBody(body, state.backupPolicy);
  } catch (err) {
    return sendJson(res, 400, { ok: false, message: err.message });
  }
  state.backupPolicy = { ...state.backupPolicy, ...policy };
  const removed = enforceRetention(state);
  await writeStore(state);
  await appendAudit('backup.policy.update', { policy: state.backupPolicy, removedCount: removed.length }, auth.user.email);
  return sendJson(res, 200, { ok: true, policy: state.backupPolicy, removedCount: removed.length });
}

function writeBackupFile(filePath, payload) {
  const envelope = encryptPayload(payload);
  fs.writeFileSync(filePath, JSON.stringify(envelope, null, 2));
}

function readBackupFile(filePath) {
  const envelope = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return decryptPayload(envelope);
}

function syncOffsite(filePath, offsitePath) {
  if (!offsitePath) return null;
  const abs = path.isAbsolute(offsitePath) ? offsitePath : path.join(__dirname, '..', '..', offsitePath);
  if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
  const target = path.join(abs, path.basename(filePath));
  fs.copyFileSync(filePath, target);
  return target;
}

async function buildPostgresSnapshot() {
  return withPgClient(async (client) => {
    await ensurePgBackupTables(client);
    const [usuarios, productos, movimientos, periodos, tax, docs, sessions] = await Promise.all([
      client.query('SELECT id, email, nombre, rol, creado_en AS "creadoEn" FROM usuarios'),
      client.query('SELECT id, sku, nombre, categoria, costo_promedio AS "costoPromedio", stock, creado_en AS "creadoEn" FROM productos'),
      client.query('SELECT id, fecha, tipo, descripcion, neto, iva, total, n_doc AS "nDoc", estado FROM movimientos'),
      client.query('SELECT anio, mes, estado, cerrado_por AS "cerradoPor", cerrado_en AS "cerradoEn", reabierto_por AS "reabiertoPor", reabierto_en AS "reabiertoEn", motivo_reapertura AS "motivoReapertura" FROM periodos_contables'),
      client.query('SELECT anio AS year, regimen AS regime, ppm_rate AS "ppmRate", iva_rate AS "ivaRate", ret_rate AS "retentionRate" FROM tax_config ORDER BY id DESC LIMIT 1'),
      client.query('SELECT id, tipo_dte AS "tipoDte", folio, fecha_emision AS "fechaEmision", total, iva FROM documentos_fiscales'),
      client.query('SELECT id, usuario_id AS "usuarioId", token, creado_en AS "creadoEn", expira_en AS "expiraEn", revocada FROM sesiones')
    ]);
    return {
      usuarios: usuarios.rows,
      productos: productos.rows,
      movimientos: movimientos.rows,
      periodos: periodos.rows,
      taxConfig: tax.rows[0] || null,
      documentosFiscales: docs.rows,
      sesiones: sessions.rows
    };
  });
}

async function getCurrentPolicyForCreate() {
  if (!isPostgresMode()) return null;
  return withPgClient(async (client) => {
    await ensurePgBackupTables(client);
    await client.query('INSERT INTO backup_policy_runtime (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    const rs = await client.query(
      `SELECT retention_max_files AS "retentionMaxFiles", encryption_enabled AS "encryptionEnabled",
              offsite_enabled AS "offsiteEnabled", offsite_path AS "offsitePath"
       FROM backup_policy_runtime WHERE id=1`
    );
    return rs.rows[0];
  });
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
  const fileName = `jet-backup-${stamp}.bkpenc`;
  const filePath = path.join(BACKUP_DIR, fileName);

  if (isPostgresMode()) {
    const policy = await getCurrentPolicyForCreate();
    const snapshot = await buildPostgresSnapshot();
    const checksum = sha(snapshot);
    const payload = { backupId, createdAt: now.toISOString(), reason, createdBy: auth.user.email, checksum, snapshot };
    writeBackupFile(filePath, payload);
    const sizeBytes = fs.statSync(filePath).size;

    let offsiteFile = null;
    if (policy?.offsiteEnabled) offsiteFile = syncOffsite(filePath, policy.offsitePath);

    const retentionMaxFiles = await withPgClient(async (client) => {
      await ensurePgBackupTables(client);
      await client.query('INSERT INTO backups (tipo, ruta, estado, generado_en) VALUES ($1, $2, $3, NOW())', ['bkpenc', fileName, 'ok']);
      return Number(policy?.retentionMaxFiles || 20);
    });

    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.bkpenc')).map(f => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs })).sort((a, b) => a.t - b.t);
    const remove = files.slice(0, Math.max(0, files.length - retentionMaxFiles));
    for (const r of remove) fs.unlinkSync(path.join(BACKUP_DIR, r.f));

    await appendAuditLog('backup.create', { backupId, reason, checksum, removedCount: remove.length, offsiteFile }, auth.user.email);
    return sendJson(res, 201, { ok: true, backup: { id: backupId, createdAt: now.toISOString(), reason, fileName, sizeBytes, checksum, encrypted: true, offsiteFile }, retentionRemoved: remove.map(r => r.f) });
  }

  const state = await readStore();
  ensureBackupStructures(state);
  const checksum = sha(state);
  const payload = { backupId, createdAt: now.toISOString(), reason, createdBy: auth.user.email, checksum, snapshot: state };
  writeBackupFile(filePath, payload);
  const sizeBytes = fs.statSync(filePath).size;
  let offsiteFile = null;
  if (state.backupPolicy.offsiteEnabled) offsiteFile = syncOffsite(filePath, state.backupPolicy.offsitePath);
  state.backups.push({ id: backupId, createdAt: payload.createdAt, createdBy: auth.user.email, reason, fileName, sizeBytes, checksum, encrypted: true, offsiteFile });
  const removed = enforceRetention(state);
  await writeStore(state);
  await appendAudit('backup.create', { backupId, reason, checksum, removedCount: removed.length, offsiteFile }, auth.user.email);
  return sendJson(res, 201, { ok: true, backup: { id: backupId, createdAt: payload.createdAt, reason, fileName, sizeBytes, checksum, encrypted: true, offsiteFile }, retentionRemoved: removed.map(r => r.id) });
}

async function listBackups(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  ensureBackupDir();
  const rows = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.bkpenc')).map((f) => {
    const st = fs.statSync(path.join(BACKUP_DIR, f));
    return { id: f, fileName: f, createdAt: new Date(st.mtimeMs).toISOString(), sizeBytes: st.size, encrypted: true };
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (isPostgresMode()) {
    const policy = await withPgClient(async (client) => {
      await ensurePgBackupTables(client);
      await client.query('INSERT INTO backup_policy_runtime (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
      const rs = await client.query(
        `SELECT retention_max_files AS "retentionMaxFiles", frequency, encryption_enabled AS "encryptionEnabled",
                offsite_enabled AS "offsiteEnabled", offsite_path AS "offsitePath", rpo_hours AS "rpoHours",
                rto_hours AS "rtoHours", restore_validation_frequency AS "restoreValidationFrequency",
                last_validation_at AS "lastValidationAt"
         FROM backup_policy_runtime WHERE id=1`
      );
      return rs.rows[0];
    });
    return sendJson(res, 200, { ok: true, count: rows.length, backups: rows, policy });
  }

  const state = await readStore();
  ensureBackupStructures(state);
  return sendJson(res, 200, { ok: true, count: rows.length, backups: rows, policy: state.backupPolicy });
}

function normalizeBackupFileName(input) {
  if (!input) return null;
  if (input.endsWith('.bkpenc')) return input;
  return input;
}

function validateSnapshotObject(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return { ok: false, message: 'snapshot inválido' };
  const must = ['usuarios', 'productos', 'movimientos'];
  for (const k of must) {
    if (!Array.isArray(snapshot[k])) return { ok: false, message: `snapshot.${k} inválido` };
  }
  return { ok: true };
}

async function runRestoreValidationCore(backupFile, actor = 'system') {
  ensureBackupDir();
  const started = Date.now();
  const filePath = path.join(BACKUP_DIR, normalizeBackupFileName(backupFile));
  if (!fs.existsSync(filePath)) {
    return { ok: false, status: 'error', message: 'Archivo no existe', backupFile, durationMs: Date.now() - started };
  }

  try {
    const payload = readBackupFile(filePath);
    const v = validateSnapshotObject(payload.snapshot);
    if (!v.ok) return { ok: false, status: 'error', message: v.message, backupFile, durationMs: Date.now() - started };
    const checksumOk = payload.checksum === sha(payload.snapshot);
    const details = {
      checksumOk,
      users: payload.snapshot.usuarios.length,
      products: payload.snapshot.productos.length,
      movements: payload.snapshot.movimientos.length
    };
    const status = checksumOk ? 'ok' : 'error';

    if (isPostgresMode()) {
      await withPgClient(async (client) => {
        await ensurePgBackupTables(client);
        await client.query(
          `INSERT INTO backup_restore_validations (backup_file, status, details, duration_ms, validated_at, validated_by)
           VALUES ($1, $2, $3::jsonb, $4, NOW(), $5)`,
          [path.basename(filePath), status, JSON.stringify(details), Date.now() - started, actor]
        );
        await client.query('UPDATE backup_policy_runtime SET last_validation_at = NOW(), updated_at = NOW() WHERE id = 1');
      });
    }

    return { ok: checksumOk, status, details, backupFile: path.basename(filePath), durationMs: Date.now() - started };
  } catch (err) {
    if (isPostgresMode()) {
      await withPgClient(async (client) => {
        await ensurePgBackupTables(client);
        await client.query(
          `INSERT INTO backup_restore_validations (backup_file, status, details, duration_ms, validated_at, validated_by)
           VALUES ($1, 'error', $2::jsonb, $3, NOW(), $4)`,
          [path.basename(filePath), JSON.stringify({ error: err.message }), Date.now() - started, actor]
        );
      });
    }
    return { ok: false, status: 'error', message: err.message, backupFile: path.basename(filePath), durationMs: Date.now() - started };
  }
}

async function validateRestore(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const backupFile = body.backupFile || null;

  ensureBackupDir();
  const latest = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.bkpenc')).sort().reverse()[0];
  const target = backupFile || latest;
  if (!target) return sendJson(res, 404, { ok: false, message: 'No hay backups para validar' });

  const result = await runRestoreValidationCore(target, auth.user.email);
  if (isPostgresMode()) await appendAuditLog('backup.restore.validate', result, auth.user.email);
  else await appendAudit('backup.restore.validate', result, auth.user.email);
  return sendJson(res, result.ok ? 200 : 422, { ok: result.ok, result });
}

async function restoreBackup(req, res) {
  const auth = await requireRoles(req, ['dueno']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const backupId = body.backupId;
  if (!backupId) return sendJson(res, 400, { ok: false, message: 'backupId es requerido' });

  const filePath = path.join(BACKUP_DIR, normalizeBackupFileName(backupId));
  if (!fs.existsSync(filePath)) return sendJson(res, 404, { ok: false, message: 'Archivo de backup no existe' });

  const payload = readBackupFile(filePath);
  const snapshot = payload.snapshot;
  const valid = validateSnapshotObject(snapshot);
  if (!valid.ok) return sendJson(res, 422, { ok: false, message: `Backup corrupto: ${valid.message}` });
  if (payload.checksum !== sha(snapshot)) return sendJson(res, 422, { ok: false, message: 'Backup corrupto: checksum inválido' });

  if (isPostgresMode()) {
    // Restore operacional para entorno de prueba (data puede vaciarse según criterio del proyecto)
    await withPgClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('TRUNCATE TABLE sesiones RESTART IDENTITY CASCADE');
        await client.query('TRUNCATE TABLE documentos_fiscales RESTART IDENTITY CASCADE');
        await client.query('TRUNCATE TABLE movimientos RESTART IDENTITY CASCADE');
        await client.query('TRUNCATE TABLE productos RESTART IDENTITY CASCADE');
        await client.query('TRUNCATE TABLE usuarios RESTART IDENTITY CASCADE');

        for (const u of snapshot.usuarios || []) {
          await client.query('INSERT INTO usuarios (id, email, nombre, rol, creado_en) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING', [u.id, u.email, u.nombre, u.rol, u.creadoEn || new Date().toISOString()]);
        }
        for (const p of snapshot.productos || []) {
          await client.query('INSERT INTO productos (id, sku, nombre, categoria, costo_promedio, stock, creado_en) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING', [p.id, p.sku, p.nombre, p.categoria, Number(p.costoPromedio || 0), Number(p.stock || 0), p.creadoEn || new Date().toISOString()]);
        }
        for (const m of snapshot.movimientos || []) {
          await client.query('INSERT INTO movimientos (id, fecha, tipo, descripcion, neto, iva, total, n_doc, estado, creado_en) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT (id) DO NOTHING', [m.id, m.fecha, m.tipo, m.descripcion || '', Number(m.neto || 0), Number(m.iva || 0), Number(m.total || 0), m.nDoc || null, m.estado || 'vigente']);
        }
        for (const d of snapshot.documentosFiscales || []) {
          await client.query('INSERT INTO documentos_fiscales (id, tipo_dte, folio, fecha_emision, total, iva, creado_en) VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT (id) DO NOTHING', [d.id, d.tipoDte, d.folio, d.fechaEmision, Number(d.total || 0), Number(d.iva || 0)]);
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    await appendAuditLog('backup.restore', { backupId, checksum: payload.checksum }, auth.user.email);
    return sendJson(res, 200, { ok: true, restoredBackupId: backupId, checksum: payload.checksum, encrypted: true });
  }

  const state = await readStore();
  ensureBackupStructures(state);
  const previousBackups = Array.isArray(state.backups) ? state.backups : [];
  const previousPolicy = state.backupPolicy || null;
  snapshot.backups = previousBackups;
  snapshot.backupPolicy = previousPolicy;
  await writeStore(snapshot);
  await appendAudit('backup.restore', { backupId, checksum: payload.checksum }, auth.user.email);
  return sendJson(res, 200, { ok: true, restoredBackupId: backupId, checksum: payload.checksum, encrypted: true });
}

module.exports = {
  getBackupPolicy,
  updateBackupPolicy,
  createBackup,
  listBackups,
  restoreBackup,
  validateRestore,
  runRestoreValidationCore
};
