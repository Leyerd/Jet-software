#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { runRestoreValidationCore } = require('../src/modules/backup');

const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');

function pickLatestBackup() {
  if (!fs.existsSync(BACKUP_DIR)) return null;
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.bkpenc')).sort();
  return files.length ? files[files.length - 1] : null;
}

async function isValidationDue() {
  if (!process.env.DATABASE_URL) return true;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS backup_policy_runtime (id INT PRIMARY KEY DEFAULT 1, restore_validation_frequency TEXT NOT NULL DEFAULT \'weekly\', last_validation_at TIMESTAMP)');
    await client.query('INSERT INTO backup_policy_runtime (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    const rs = await client.query('SELECT restore_validation_frequency, last_validation_at FROM backup_policy_runtime WHERE id=1');
    const row = rs.rows[0] || { restore_validation_frequency: 'weekly', last_validation_at: null };
    const freq = row.restore_validation_frequency || 'weekly';
    const last = row.last_validation_at ? new Date(row.last_validation_at).getTime() : 0;
    const now = Date.now();
    const intervalMs = freq === 'daily' ? 24 * 3600 * 1000 : (freq === 'monthly' ? 30 * 24 * 3600 * 1000 : 7 * 24 * 3600 * 1000);
    return !last || (now - last) >= intervalMs;
  } finally {
    await client.end();
  }
}

(async () => {
  const latest = pickLatestBackup();
  if (!latest) {
    console.log(JSON.stringify({ ok: false, skipped: true, reason: 'no-backups-found' }, null, 2));
    process.exitCode = 2;
    return;
  }

  const due = await isValidationDue();
  if (!due) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'not-due-yet', backupFile: latest }, null, 2));
    return;
  }

  const result = await runRestoreValidationCore(latest, 'scheduler');
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
