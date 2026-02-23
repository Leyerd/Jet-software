#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const backup = read('apps/api/src/modules/backup.js');
const routes = read('apps/api/src/routes.js');
const pkg = JSON.parse(read('apps/api/package.json'));

const checks = [
  check('Backups cifrados en repositorio local/externo', /aes-256-gcm/.test(backup) && /BACKUP_ENCRYPTION_KEY/.test(backup) && /syncOffsite/.test(backup)),
  check('Pruebas periódicas de restore automatizadas', /runRestoreValidationCore/.test(backup) && /backup_restore_validations/.test(backup) && Boolean(pkg.scripts['backup:validate:scheduled'])),
  check('Política RPO/RTO definida', /rpo_hours/.test(backup) && /rto_hours/.test(backup)),
  check('Endpoint de validación de restore expuesto', /\/backup\/validate-restore/.test(routes) && /validateRestore/.test(backup)),
  check('Gate Meta8: restore validado automáticamente semanal', /restore_validation_frequency/.test(backup) && /last_validation_at/.test(backup) && /isValidationDue/.test(read('apps/api/scripts/backup-restore-validation.js')))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter(c => c.ok).length,
    total: checks.length,
    meta8GateReached: checks.every(c => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.meta8GateReached) process.exitCode = 2;
