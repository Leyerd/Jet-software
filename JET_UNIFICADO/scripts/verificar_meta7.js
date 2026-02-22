#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (desc, ok) => ({ desc, ok });

const auth = read('apps/api/src/modules/auth.js');
const routes = read('apps/api/src/routes.js');

const checks = [
  check('Hash de password robusto y sin sha256 en auth', /hashPassword/.test(auth) && /scrypt\$/.test(auth) && !/sha256\(/.test(auth)),
  check('Bloqueo progresivo por intentos fallidos', /auth_lockouts/.test(auth) && /MAX_ATTEMPTS_WINDOW/.test(auth) && /LOCK_MINUTES_BASE/.test(auth)),
  check('Rate limiting por IP y usuario', /MAX_RATE_PER_MINUTE_IP/.test(auth) && /MAX_RATE_PER_MINUTE_USER/.test(auth) && /checkRateLimitInDb/.test(auth)),
  check('Rotación y revocación de sesiones/tokens', /rotation-login/.test(auth) && /revokeSession/.test(auth) && /revocada/.test(auth)),
  check('MFA opcional para roles críticos', /mfaSetup/.test(auth) && /mfaEnable/.test(auth) && /mfaDisable/.test(auth) && /\['dueno', 'contador_admin'\]/.test(auth)),
  check('Endpoints de seguridad expuestos', /\/auth\/revoke-session/.test(routes) && /\/auth\/mfa\/setup/.test(routes) && /\/auth\/mfa\/enable/.test(routes) && /\/auth\/mfa\/disable/.test(routes))
];

const out = {
  generatedAt: new Date().toISOString(),
  checks,
  summary: {
    passed: checks.filter(c => c.ok).length,
    total: checks.length,
    meta7GateReached: checks.every(c => c.ok)
  }
};

console.log(JSON.stringify(out, null, 2));
if (!out.summary.meta7GateReached) process.exitCode = 2;
