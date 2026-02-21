const fs = require('fs');
const path = require('path');
const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { requireRoles } = require('./auth');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'data', 'backups');

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function ensureBackupStructures(state) {
  if (!Array.isArray(state.backups)) state.backups = [];
  if (!state.backupPolicy || typeof state.backupPolicy !== 'object') {
    state.backupPolicy = {
      retentionMaxFiles: 20,
      frequency: 'daily',
      encryptionPlanned: true,
      offsitePlanned: true
    };
  }
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

  if (!['daily', 'weekly', 'monthly'].includes(frequency)) {
    return sendJson(res, 400, { ok: false, message: 'frequency inválida (daily|weekly|monthly)' });
  }
  if (retentionMaxFiles < 1 || retentionMaxFiles > 365) {
    return sendJson(res, 400, { ok: false, message: 'retentionMaxFiles debe estar entre 1 y 365' });
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

  const state = await readStore();
  ensureBackupStructures(state);

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const backupId = `BKP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const fileName = `jet-backup-${stamp}.json`;
  const filePath = path.join(BACKUP_DIR, fileName);

  const payload = {
    backupId,
    createdAt: now.toISOString(),
    reason,
    createdBy: auth.user.email,
    snapshot: state
  };

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));

  const sizeBytes = fs.statSync(filePath).size;
  state.backups.push({
    id: backupId,
    createdAt: payload.createdAt,
    createdBy: auth.user.email,
    reason,
    fileName,
    sizeBytes
  });

  const removed = enforceRetention(state);
  await writeStore(state);
  await appendAudit('backup.create', { backupId, reason, removedCount: removed.length }, auth.user.email);

  return sendJson(res, 201, {
    ok: true,
    backup: { id: backupId, createdAt: payload.createdAt, reason, fileName, sizeBytes },
    retentionRemoved: removed.map(r => r.id)
  });
}

async function listBackups(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

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

  const state = await readStore();
  ensureBackupStructures(state);
  const backup = state.backups.find(b => b.id === backupId);
  if (!backup) return sendJson(res, 404, { ok: false, message: 'Backup no encontrado' });

  const filePath = path.join(BACKUP_DIR, backup.fileName);
  if (!fs.existsSync(filePath)) return sendJson(res, 404, { ok: false, message: 'Archivo de backup no existe' });

  const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const snapshot = payload.snapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    return sendJson(res, 422, { ok: false, message: 'Backup corrupto: snapshot inválido' });
  }

  const previousBackups = Array.isArray(state.backups) ? state.backups : [];
  const previousPolicy = state.backupPolicy || null;

  snapshot.backups = previousBackups;
  snapshot.backupPolicy = previousPolicy;

  await writeStore(snapshot);
  await appendAudit('backup.restore', { backupId, restoredFrom: backup.fileName }, auth.user.email);

  return sendJson(res, 200, { ok: true, restoredBackupId: backupId });
}

module.exports = {
  getBackupPolicy,
  updateBackupPolicy,
  createBackup,
  listBackups,
  restoreBackup
};
