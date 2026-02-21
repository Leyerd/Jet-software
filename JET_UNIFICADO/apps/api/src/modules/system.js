const fs = require('fs');
const path = require('path');
const { sendJson } = require('../lib/http');

function coherenceCheck(_req, res) {
  const requiredFiles = [
    'src/routes.js',
    'src/modules/auth.js',
    'src/modules/migration.js',
    'src/modules/accountingClose.js',
    'src/modules/movements.js',
    'src/modules/products.js',
    'src/modules/db.js',
    'src/lib/http.js',
    'src/lib/store.js',
    'scripts/migrate-store-to-postgres.js'
  ];

  const root = path.join(__dirname, '..', '..');
  const checks = requiredFiles.map(rel => ({ file: rel, exists: fs.existsSync(path.join(root, rel)) }));
  const missing = checks.filter(c => !c.exists).map(c => c.file);

  return sendJson(res, 200, {
    ok: missing.length === 0,
    sprint: 3,
    message: missing.length === 0 ? 'Coherencia básica OK' : 'Faltan archivos críticos',
    checks,
    missing
  });
}

module.exports = { coherenceCheck };
