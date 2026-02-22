const crypto = require('crypto');
const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');

const SCRYPT_N = Number(process.env.SCRYPT_N || 16384);
const SCRYPT_R = Number(process.env.SCRYPT_R || 8);
const SCRYPT_P = Number(process.env.SCRYPT_P || 1);
const KEY_LEN = 64;
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);
const MFA_ISSUER = process.env.MFA_ISSUER || 'JET';

const MAX_ATTEMPTS_WINDOW = Number(process.env.AUTH_MAX_ATTEMPTS_WINDOW || 5);
const ATTEMPT_WINDOW_MINUTES = Number(process.env.AUTH_ATTEMPT_WINDOW_MINUTES || 15);
const LOCK_MINUTES_BASE = Number(process.env.AUTH_LOCK_MINUTES_BASE || 5);
const MAX_RATE_PER_MINUTE_IP = Number(process.env.AUTH_RATE_LIMIT_IP_PER_MIN || 20);
const MAX_RATE_PER_MINUTE_USER = Number(process.env.AUTH_RATE_LIMIT_USER_PER_MIN || 10);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, storedHash = '') {
  if (!storedHash.startsWith('scrypt$')) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const [, salt, hashHex] = parts;
  const derived = crypto.scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(hashHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function generateSecret() {
  return crypto.randomBytes(20).toString('hex');
}

function toBase32(hex) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = Buffer.from(hex, 'hex');
  let bits = 0;
  let value = 0;
  let output = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function hotp(secretHex, counter) {
  const key = Buffer.from(secretHex, 'hex');
  const c = Buffer.alloc(8);
  c.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  c.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac('sha1', key).update(c).digest();
  const offset = h[h.length - 1] & 0x0f;
  const code = ((h[offset] & 0x7f) << 24) | ((h[offset + 1] & 0xff) << 16) | ((h[offset + 2] & 0xff) << 8) | (h[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

function verifyTotp(code, secretHex, stepSeconds = 30, skew = 1) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  const counter = Math.floor(Date.now() / 1000 / stepSeconds);
  for (let i = -skew; i <= skew; i += 1) {
    if (hotp(secretHex, counter + i) === String(code)) return true;
  }
  return false;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) return 'password debe tener al menos 8 caracteres';
  if (!/[A-Z]/.test(password)) return 'password debe incluir al menos una mayúscula';
  if (!/[a-z]/.test(password)) return 'password debe incluir al menos una minúscula';
  if (!/[0-9]/.test(password)) return 'password debe incluir al menos un número';
  return null;
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return null;
  const [prefix, token] = header.split(' ');
  if (prefix !== 'Bearer' || !token) return null;
  return token;
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

async function ensurePgAuthSecurityTables(client) {
  await client.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE');
  await client.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_secret TEXT');
  await client.query('ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS revocada BOOLEAN DEFAULT FALSE');
  await client.query('ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS revocada_en TIMESTAMP');
  await client.query('ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS revocada_por TEXT');

  await client.query(`CREATE TABLE IF NOT EXISTS auth_login_events (
    id BIGSERIAL PRIMARY KEY,
    email TEXT,
    ip TEXT,
    success BOOLEAN NOT NULL,
    reason TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await client.query(`CREATE TABLE IF NOT EXISTS auth_lockouts (
    key TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    failures INTEGER NOT NULL DEFAULT 0,
    lock_until TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW()
  )`);

  await client.query('CREATE INDEX IF NOT EXISTS idx_auth_login_events_created_at ON auth_login_events(created_at)');
}

async function checkRateLimitInDb(client, email, ip) {
  const rs = await client.query(
    `SELECT
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 minute' AND ip = $1) AS ip_count,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 minute' AND email = $2) AS user_count
     FROM auth_login_events`,
    [ip, email]
  );
  const ipCount = Number(rs.rows[0]?.ip_count || 0);
  const userCount = Number(rs.rows[0]?.user_count || 0);
  return {
    blocked: ipCount >= MAX_RATE_PER_MINUTE_IP || userCount >= MAX_RATE_PER_MINUTE_USER,
    ipCount,
    userCount
  };
}

async function getLockoutInDb(client, scope, key) {
  const rs = await client.query('SELECT failures, lock_until FROM auth_lockouts WHERE scope = $1 AND key = $2', [scope, key]);
  if (!rs.rows.length) return { failures: 0, lockUntil: null };
  return { failures: Number(rs.rows[0].failures || 0), lockUntil: rs.rows[0].lock_until ? new Date(rs.rows[0].lock_until) : null };
}

async function writeLockoutFailureInDb(client, scope, key) {
  const current = await getLockoutInDb(client, scope, key);
  const nextFailures = current.failures + 1;
  const over = Math.max(0, nextFailures - MAX_ATTEMPTS_WINDOW);
  const lockMinutes = over > 0 ? LOCK_MINUTES_BASE * over : 0;
  const lockUntil = lockMinutes > 0 ? new Date(Date.now() + lockMinutes * 60 * 1000) : null;
  await client.query(
    `INSERT INTO auth_lockouts (scope, key, failures, lock_until, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (key)
     DO UPDATE SET failures = $3, lock_until = $4, updated_at = NOW(), scope = $1`,
    [scope, key, nextFailures, lockUntil]
  );
  return { failures: nextFailures, lockUntil };
}

async function clearLockoutInDb(client, scope, key) {
  await client.query('DELETE FROM auth_lockouts WHERE scope = $1 AND key = $2', [scope, key]);
}

function ensureFileAuthSecurity(state) {
  if (!state.authSecurity || typeof state.authSecurity !== 'object') {
    state.authSecurity = { events: [], lockouts: {}, mfaSetup: {} };
  }
  if (!Array.isArray(state.authSecurity.events)) state.authSecurity.events = [];
  if (!state.authSecurity.lockouts || typeof state.authSecurity.lockouts !== 'object') state.authSecurity.lockouts = {};
  if (!state.authSecurity.mfaSetup || typeof state.authSecurity.mfaSetup !== 'object') state.authSecurity.mfaSetup = {};
  return state.authSecurity;
}

function lockoutKey(scope, key) {
  return `${scope}:${key}`;
}

function getFileLockout(state, scope, key) {
  const sec = ensureFileAuthSecurity(state);
  return sec.lockouts[lockoutKey(scope, key)] || { failures: 0, lockUntil: null };
}

function setFileFailure(state, scope, key) {
  const sec = ensureFileAuthSecurity(state);
  const lk = getFileLockout(state, scope, key);
  const failures = Number(lk.failures || 0) + 1;
  const over = Math.max(0, failures - MAX_ATTEMPTS_WINDOW);
  const lockMinutes = over > 0 ? LOCK_MINUTES_BASE * over : 0;
  sec.lockouts[lockoutKey(scope, key)] = {
    failures,
    lockUntil: lockMinutes > 0 ? new Date(Date.now() + lockMinutes * 60 * 1000).toISOString() : null
  };
  return sec.lockouts[lockoutKey(scope, key)];
}

function clearFileLockout(state, scope, key) {
  const sec = ensureFileAuthSecurity(state);
  delete sec.lockouts[lockoutKey(scope, key)];
}

function isLocked(lockUntil) {
  if (!lockUntil) return false;
  const t = new Date(lockUntil).getTime();
  return Number.isFinite(t) && t > Date.now();
}

function registerLoginEventFile(state, email, ip, success, reason) {
  const sec = ensureFileAuthSecurity(state);
  sec.events.push({ email, ip, success, reason, at: new Date().toISOString() });
  const cutoff = Date.now() - 60 * 60 * 1000;
  sec.events = sec.events.filter(e => new Date(e.at).getTime() >= cutoff);
}

function checkRateLimitFile(state, email, ip) {
  const sec = ensureFileAuthSecurity(state);
  const cutoff = Date.now() - 60 * 1000;
  const recent = sec.events.filter(e => new Date(e.at).getTime() >= cutoff);
  const ipCount = recent.filter(e => e.ip === ip).length;
  const userCount = recent.filter(e => e.email === email).length;
  return {
    blocked: ipCount >= MAX_RATE_PER_MINUTE_IP || userCount >= MAX_RATE_PER_MINUTE_USER,
    ipCount,
    userCount
  };
}

async function getSessionUser(req) {
  const token = getBearerToken(req);
  if (!token) return null;

  if (isPostgresMode()) {
    return withPgClient(async (client) => {
      await ensurePgAuthSecurityTables(client);
      const rs = await client.query(
        `SELECT s.id, s.usuario_id, s.token, s.creado_en, s.revocada,
                u.id AS user_id, u.nombre, u.email, u.rol
         FROM sesiones s
         JOIN usuarios u ON u.id = s.usuario_id
         WHERE s.token = $1
         LIMIT 1`,
        [token]
      );
      if (!rs.rows.length) return null;
      const row = rs.rows[0];
      if (row.revocada) return null;
      const createdAt = new Date(row.creado_en).getTime();
      const ttlMs = SESSION_TTL_HOURS * 60 * 60 * 1000;
      if (Number.isFinite(createdAt) && Date.now() - createdAt > ttlMs) {
        await client.query('UPDATE sesiones SET revocada = TRUE, revocada_en = NOW(), revocada_por = $2 WHERE token = $1', [token, 'ttl-expired']);
        return null;
      }
      return { id: row.user_id, nombre: row.nombre, email: row.email, rol: row.rol };
    });
  }

  const state = await readStore();
  const session = state.sesiones.find(s => s.token === token && !s.revocada);
  if (!session) return null;

  const createdAt = new Date(session.creadoEn).getTime();
  const ttlMs = SESSION_TTL_HOURS * 60 * 60 * 1000;
  if (Number.isFinite(createdAt) && Date.now() - createdAt > ttlMs) {
    session.revocada = true;
    session.revocadaEn = new Date().toISOString();
    session.revocadaPor = 'ttl-expired';
    await writeStore(state);
    return null;
  }

  return state.usuarios.find(u => u.id === session.userId) || null;
}

async function requireRoles(req, allowedRoles) {
  const user = await getSessionUser(req);
  if (!user) return { ok: false, status: 401, message: 'No autenticado. Use token Bearer.' };
  if (!allowedRoles.includes(user.rol)) return { ok: false, status: 403, message: 'No autorizado para esta operación.' };
  return { ok: true, user };
}

async function register(req, res) {
  const body = await parseBody(req);
  const nombre = body.nombre;
  const email = (body.email || '').toLowerCase().trim();
  const password = body.password;
  const rol = body.rol || 'operador';

  if (!nombre || !email || !password) return sendJson(res, 400, { ok: false, message: 'nombre, email y password son requeridos' });

  const passwordError = validatePassword(password);
  if (passwordError) return sendJson(res, 400, { ok: false, message: passwordError });

  const validRoles = ['dueno', 'contador_admin', 'operador', 'auditor'];
  if (!validRoles.includes(rol)) return sendJson(res, 400, { ok: false, message: 'rol inválido' });

  if (isPostgresMode()) {
    const passwordHash = hashPassword(password);
    const user = await withPgClient(async (client) => {
      await ensurePgAuthSecurityTables(client);
      const existing = await client.query('SELECT id FROM usuarios WHERE email = $1 LIMIT 1', [email]);
      if (existing.rows.length) return null;
      const created = await client.query(
        `INSERT INTO usuarios (email, nombre, rol, password_hash, creado_en, mfa_enabled)
         VALUES ($1, $2, $3, $4, NOW(), FALSE)
         RETURNING id, nombre, email, rol`,
        [email, nombre, rol, passwordHash]
      );
      return created.rows[0];
    });
    if (!user) return sendJson(res, 409, { ok: false, message: 'email ya registrado' });
    await appendAuditLog('auth.register', { email, rol }, user.email);
    return sendJson(res, 201, { ok: true, user });
  }

  const state = await readStore();
  if (state.usuarios.find(u => u.email === email)) return sendJson(res, 409, { ok: false, message: 'email ya registrado' });

  const user = {
    id: `USR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    nombre,
    email,
    rol,
    passwordHash: hashPassword(password),
    mfaEnabled: false,
    mfaSecret: null,
    creadoEn: new Date().toISOString()
  };

  state.usuarios.push(user);
  await writeStore(state);
  await appendAudit('auth.register', { email, rol }, user.email);
  return sendJson(res, 201, { ok: true, user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol } });
}

async function login(req, res) {
  const body = await parseBody(req);
  const email = (body.email || '').toLowerCase().trim();
  const password = body.password;
  const mfaCode = body.mfaCode;
  const ip = getClientIp(req);

  if (!email || !password) return sendJson(res, 400, { ok: false, message: 'email y password son requeridos' });

  if (isPostgresMode()) {
    const authData = await withPgClient(async (client) => {
      await ensurePgAuthSecurityTables(client);

      const rate = await checkRateLimitInDb(client, email, ip);
      if (rate.blocked) {
        await client.query('INSERT INTO auth_login_events (email, ip, success, reason, created_at) VALUES ($1, $2, FALSE, $3, NOW())', [email, ip, 'rate-limited']);
        return { error: 'RATE_LIMITED' };
      }

      const emailLock = await getLockoutInDb(client, 'email', email);
      const ipLock = await getLockoutInDb(client, 'ip', ip);
      if (isLocked(emailLock.lockUntil) || isLocked(ipLock.lockUntil)) {
        await client.query('INSERT INTO auth_login_events (email, ip, success, reason, created_at) VALUES ($1, $2, FALSE, $3, NOW())', [email, ip, 'locked']);
        return { error: 'LOCKED' };
      }

      const userRs = await client.query(
        'SELECT id, nombre, email, rol, password_hash, mfa_enabled, mfa_secret FROM usuarios WHERE email = $1 LIMIT 1',
        [email]
      );
      if (!userRs.rows.length) {
        await writeLockoutFailureInDb(client, 'email', email);
        await writeLockoutFailureInDb(client, 'ip', ip);
        await client.query('INSERT INTO auth_login_events (email, ip, success, reason, created_at) VALUES ($1, $2, FALSE, $3, NOW())', [email, ip, 'invalid-user']);
        return { error: 'INVALID_CREDENTIALS' };
      }

      const user = userRs.rows[0];
      if (!verifyPassword(password, user.password_hash || '')) {
        await writeLockoutFailureInDb(client, 'email', email);
        await writeLockoutFailureInDb(client, 'ip', ip);
        await client.query('INSERT INTO auth_login_events (email, ip, success, reason, created_at) VALUES ($1, $2, FALSE, $3, NOW())', [email, ip, 'invalid-password']);
        return { error: 'INVALID_CREDENTIALS' };
      }

      if (user.mfa_enabled) {
        if (!mfaCode || !verifyTotp(String(mfaCode), user.mfa_secret || '')) {
          await writeLockoutFailureInDb(client, 'email', email);
          await writeLockoutFailureInDb(client, 'ip', ip);
          await client.query('INSERT INTO auth_login_events (email, ip, success, reason, created_at) VALUES ($1, $2, FALSE, $3, NOW())', [email, ip, 'mfa-required']);
          return { error: 'MFA_REQUIRED' };
        }
      }

      await clearLockoutInDb(client, 'email', email);
      await clearLockoutInDb(client, 'ip', ip);

      await client.query('UPDATE sesiones SET revocada = TRUE, revocada_en = NOW(), revocada_por = $2 WHERE usuario_id = $1 AND revocada IS DISTINCT FROM TRUE', [user.id, 'rotation-login']);

      const token = generateToken();
      await client.query(
        'INSERT INTO sesiones (usuario_id, token, creado_en, expira_en, revocada) VALUES ($1, $2, NOW(), NOW() + make_interval(hours => $3), FALSE)',
        [user.id, token, SESSION_TTL_HOURS]
      );

      await client.query('INSERT INTO auth_login_events (email, ip, success, reason, created_at) VALUES ($1, $2, TRUE, $3, NOW())', [email, ip, 'ok']);

      return {
        token,
        user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol, mfaEnabled: Boolean(user.mfa_enabled) }
      };
    });

    if (authData?.error === 'RATE_LIMITED') return sendJson(res, 429, { ok: false, message: 'Demasiados intentos. Espere un minuto.' });
    if (authData?.error === 'LOCKED') return sendJson(res, 423, { ok: false, message: 'Cuenta/IP bloqueada temporalmente por intentos fallidos.' });
    if (authData?.error === 'MFA_REQUIRED') return sendJson(res, 401, { ok: false, message: 'MFA requerido para esta cuenta.' });
    if (authData?.error === 'INVALID_CREDENTIALS' || !authData) return sendJson(res, 401, { ok: false, message: 'credenciales inválidas' });

    await appendAuditLog('auth.login', { email, ip, mfa: authData.user.mfaEnabled }, authData.user.email);
    return sendJson(res, 200, { ok: true, token: authData.token, user: authData.user });
  }

  const state = await readStore();
  const sec = ensureFileAuthSecurity(state);
  const rate = checkRateLimitFile(state, email, ip);
  if (rate.blocked) {
    registerLoginEventFile(state, email, ip, false, 'rate-limited');
    await writeStore(state);
    return sendJson(res, 429, { ok: false, message: 'Demasiados intentos. Espere un minuto.' });
  }

  const emailLock = getFileLockout(state, 'email', email);
  const ipLock = getFileLockout(state, 'ip', ip);
  if (isLocked(emailLock.lockUntil) || isLocked(ipLock.lockUntil)) {
    registerLoginEventFile(state, email, ip, false, 'locked');
    await writeStore(state);
    return sendJson(res, 423, { ok: false, message: 'Cuenta/IP bloqueada temporalmente por intentos fallidos.' });
  }

  const user = state.usuarios.find(u => u.email === email);
  if (!user || !verifyPassword(password, user.passwordHash || '')) {
    setFileFailure(state, 'email', email);
    setFileFailure(state, 'ip', ip);
    registerLoginEventFile(state, email, ip, false, 'invalid-credentials');
    await writeStore(state);
    return sendJson(res, 401, { ok: false, message: 'credenciales inválidas' });
  }

  if (user.mfaEnabled) {
    if (!mfaCode || !verifyTotp(String(mfaCode), user.mfaSecret || '')) {
      setFileFailure(state, 'email', email);
      setFileFailure(state, 'ip', ip);
      registerLoginEventFile(state, email, ip, false, 'mfa-required');
      await writeStore(state);
      return sendJson(res, 401, { ok: false, message: 'MFA requerido para esta cuenta.' });
    }
  }

  clearFileLockout(state, 'email', email);
  clearFileLockout(state, 'ip', ip);

  for (const s of state.sesiones) {
    if (s.userId === user.id && !s.revocada) {
      s.revocada = true;
      s.revocadaEn = new Date().toISOString();
      s.revocadaPor = 'rotation-login';
    }
  }

  const token = generateToken();
  state.sesiones.push({ token, userId: user.id, creadoEn: new Date().toISOString(), revocada: false });
  registerLoginEventFile(state, email, ip, true, 'ok');
  await writeStore(state);
  await appendAudit('auth.login', { email, ip, mfa: Boolean(user.mfaEnabled) }, user.email);

  return sendJson(res, 200, { ok: true, token, user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol, mfaEnabled: Boolean(user.mfaEnabled) } });
}

async function me(req, res) {
  const user = await getSessionUser(req);
  if (!user) return sendJson(res, 401, { ok: false, message: 'No autenticado' });
  return sendJson(res, 200, { ok: true, user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol } });
}

async function logout(req, res) {
  const token = getBearerToken(req);
  if (!token) return sendJson(res, 401, { ok: false, message: 'No autenticado' });

  if (isPostgresMode()) {
    const removed = await withPgClient(async (client) => {
      await ensurePgAuthSecurityTables(client);
      const rs = await client.query('UPDATE sesiones SET revocada = TRUE, revocada_en = NOW(), revocada_por = $2 WHERE token = $1 AND revocada IS DISTINCT FROM TRUE', [token, 'logout']);
      return rs.rowCount || 0;
    });
    return sendJson(res, 200, { ok: true, removedSessions: removed });
  }

  const state = await readStore();
  let removed = 0;
  for (const s of state.sesiones) {
    if (s.token === token && !s.revocada) {
      s.revocada = true;
      s.revocadaEn = new Date().toISOString();
      s.revocadaPor = 'logout';
      removed += 1;
    }
  }
  await writeStore(state);
  return sendJson(res, 200, { ok: true, removedSessions: removed });
}

async function revokeSession(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin', 'operador', 'auditor']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const token = String(body.token || '').trim();
  const all = Boolean(body.all);

  if (!token && !all) return sendJson(res, 400, { ok: false, message: 'Debe indicar token o all=true' });

  if (isPostgresMode()) {
    const result = await withPgClient(async (client) => {
      await ensurePgAuthSecurityTables(client);
      if (all) {
        const rs = await client.query('UPDATE sesiones SET revocada = TRUE, revocada_en = NOW(), revocada_por = $2 WHERE usuario_id = $1 AND revocada IS DISTINCT FROM TRUE', [auth.user.id, 'manual-revoke-all']);
        return rs.rowCount || 0;
      }
      const rs = await client.query('UPDATE sesiones SET revocada = TRUE, revocada_en = NOW(), revocada_por = $2 WHERE token = $1 AND revocada IS DISTINCT FROM TRUE', [token, 'manual-revoke-token']);
      return rs.rowCount || 0;
    });
    await appendAuditLog('auth.session.revoke', { all, token }, auth.user.email);
    return sendJson(res, 200, { ok: true, revoked: result });
  }

  const state = await readStore();
  let revoked = 0;
  for (const s of state.sesiones) {
    const match = all ? s.userId === auth.user.id : s.token === token;
    if (match && !s.revocada) {
      s.revocada = true;
      s.revocadaEn = new Date().toISOString();
      s.revocadaPor = all ? 'manual-revoke-all' : 'manual-revoke-token';
      revoked += 1;
    }
  }
  await writeStore(state);
  await appendAudit('auth.session.revoke', { all, token }, auth.user.email);
  return sendJson(res, 200, { ok: true, revoked });
}

async function mfaSetup(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  const secret = generateSecret();
  const otpauth = `otpauth://totp/${encodeURIComponent(`${MFA_ISSUER}:${auth.user.email}`)}?secret=${toBase32(secret)}&issuer=${encodeURIComponent(MFA_ISSUER)}`;

  if (isPostgresMode()) {
    await withPgClient(async (client) => {
      await ensurePgAuthSecurityTables(client);
      await client.query('UPDATE usuarios SET mfa_secret = $2, mfa_enabled = FALSE WHERE id = $1', [auth.user.id, secret]);
    });
    await appendAuditLog('auth.mfa.setup', { userId: auth.user.id }, auth.user.email);
    return sendJson(res, 200, { ok: true, mfaPending: true, secret, otpauth });
  }

  const state = await readStore();
  const user = state.usuarios.find(u => u.id === auth.user.id);
  if (!user) return sendJson(res, 404, { ok: false, message: 'Usuario no encontrado' });
  user.mfaSecret = secret;
  user.mfaEnabled = false;
  await writeStore(state);
  await appendAudit('auth.mfa.setup', { userId: auth.user.id }, auth.user.email);
  return sendJson(res, 200, { ok: true, mfaPending: true, secret, otpauth });
}

async function mfaEnable(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });
  const body = await parseBody(req);
  const code = String(body.code || '');

  if (isPostgresMode()) {
    const out = await withPgClient(async (client) => {
      await ensurePgAuthSecurityTables(client);
      const rs = await client.query('SELECT mfa_secret FROM usuarios WHERE id = $1 LIMIT 1', [auth.user.id]);
      const secret = rs.rows[0]?.mfa_secret;
      if (!secret) return { error: 'MFA_SETUP_REQUIRED' };
      if (!verifyTotp(code, secret)) return { error: 'INVALID_CODE' };
      await client.query('UPDATE usuarios SET mfa_enabled = TRUE WHERE id = $1', [auth.user.id]);
      return { ok: true };
    });
    if (out.error === 'MFA_SETUP_REQUIRED') return sendJson(res, 400, { ok: false, message: 'Primero debe ejecutar setup MFA.' });
    if (out.error === 'INVALID_CODE') return sendJson(res, 400, { ok: false, message: 'Código MFA inválido.' });
    await appendAuditLog('auth.mfa.enable', { userId: auth.user.id }, auth.user.email);
    return sendJson(res, 200, { ok: true, mfaEnabled: true });
  }

  const state = await readStore();
  const user = state.usuarios.find(u => u.id === auth.user.id);
  if (!user || !user.mfaSecret) return sendJson(res, 400, { ok: false, message: 'Primero debe ejecutar setup MFA.' });
  if (!verifyTotp(code, user.mfaSecret)) return sendJson(res, 400, { ok: false, message: 'Código MFA inválido.' });
  user.mfaEnabled = true;
  await writeStore(state);
  await appendAudit('auth.mfa.enable', { userId: auth.user.id }, auth.user.email);
  return sendJson(res, 200, { ok: true, mfaEnabled: true });
}

async function mfaDisable(req, res) {
  const auth = await requireRoles(req, ['dueno', 'contador_admin']);
  if (!auth.ok) return sendJson(res, auth.status, { ok: false, message: auth.message });

  if (isPostgresMode()) {
    await withPgClient(async (client) => {
      await ensurePgAuthSecurityTables(client);
      await client.query('UPDATE usuarios SET mfa_enabled = FALSE, mfa_secret = NULL WHERE id = $1', [auth.user.id]);
    });
    await appendAuditLog('auth.mfa.disable', { userId: auth.user.id }, auth.user.email);
    return sendJson(res, 200, { ok: true, mfaEnabled: false });
  }

  const state = await readStore();
  const user = state.usuarios.find(u => u.id === auth.user.id);
  if (!user) return sendJson(res, 404, { ok: false, message: 'Usuario no encontrado' });
  user.mfaEnabled = false;
  user.mfaSecret = null;
  await writeStore(state);
  await appendAudit('auth.mfa.disable', { userId: auth.user.id }, auth.user.email);
  return sendJson(res, 200, { ok: true, mfaEnabled: false });
}

module.exports = {
  register,
  login,
  me,
  logout,
  revokeSession,
  mfaSetup,
  mfaEnable,
  mfaDisable,
  getSessionUser,
  requireRoles,
  hashPassword,
  verifyPassword
};
