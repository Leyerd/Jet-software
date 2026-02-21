const crypto = require('crypto');
const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');
const { isPostgresMode, withPgClient, appendAuditLog } = require('../lib/postgresRepo');

const SCRYPT_N = Number(process.env.SCRYPT_N || 16384);
const SCRYPT_R = Number(process.env.SCRYPT_R || 8);
const SCRYPT_P = Number(process.env.SCRYPT_P || 1);
const KEY_LEN = 64;

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

const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);

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

async function getSessionUser(req) {
  const token = getBearerToken(req);
  if (!token) return null;

  if (isPostgresMode()) {
    return withPgClient(async (client) => {
      const rs = await client.query(
        `SELECT s.id, s.usuario_id, s.token, s.creado_en, u.id AS user_id, u.nombre, u.email, u.rol
         FROM sesiones s
         JOIN usuarios u ON u.id = s.usuario_id
         WHERE s.token = $1
         LIMIT 1`,
        [token]
      );
      if (!rs.rows.length) return null;
      const row = rs.rows[0];
      const createdAt = new Date(row.creado_en).getTime();
      const ttlMs = SESSION_TTL_HOURS * 60 * 60 * 1000;
      if (Number.isFinite(createdAt) && Date.now() - createdAt > ttlMs) {
        await client.query('DELETE FROM sesiones WHERE token = $1', [token]);
        return null;
      }
      return { id: row.user_id, nombre: row.nombre, email: row.email, rol: row.rol };
    });
  }

  const state = await readStore();
  const session = state.sesiones.find(s => s.token === token);
  if (!session) return null;

  const createdAt = new Date(session.creadoEn).getTime();
  const ttlMs = SESSION_TTL_HOURS * 60 * 60 * 1000;
  if (Number.isFinite(createdAt) && Date.now() - createdAt > ttlMs) {
    state.sesiones = state.sesiones.filter(s => s.token !== token);
    await writeStore(state);
    return null;
  }

  return state.usuarios.find(u => u.id === session.userId) || null;
}

async function requireRoles(req, allowedRoles) {
  const user = await getSessionUser(req);
  if (!user) {
    return { ok: false, status: 401, message: 'No autenticado. Use token Bearer.' };
  }
  if (!allowedRoles.includes(user.rol)) {
    return { ok: false, status: 403, message: 'No autorizado para esta operación.' };
  }
  return { ok: true, user };
}

async function register(req, res) {
  const body = await parseBody(req);
  const nombre = body.nombre;
  const email = (body.email || '').toLowerCase().trim();
  const password = body.password;
  const rol = body.rol || 'operador';

  if (!nombre || !email || !password) {
    return sendJson(res, 400, { ok: false, message: 'nombre, email y password son requeridos' });
  }

  const passwordError = validatePassword(password);
  if (passwordError) return sendJson(res, 400, { ok: false, message: passwordError });

  const validRoles = ['dueno', 'contador_admin', 'operador', 'auditor'];
  if (!validRoles.includes(rol)) {
    return sendJson(res, 400, { ok: false, message: 'rol inválido' });
  }

  if (isPostgresMode()) {
    const passwordHash = hashPassword(password);
    const user = await withPgClient(async (client) => {
      const existing = await client.query('SELECT id FROM usuarios WHERE email = $1 LIMIT 1', [email]);
      if (existing.rows.length) return null;
      const created = await client.query(
        `INSERT INTO usuarios (email, nombre, rol, password_hash, creado_en)
         VALUES ($1, $2, $3, $4, NOW())
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
  if (state.usuarios.find(u => u.email === email)) {
    return sendJson(res, 409, { ok: false, message: 'email ya registrado' });
  }

  const user = {
    id: `USR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    nombre,
    email,
    rol,
    passwordHash: hashPassword(password),
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
  if (!email || !password) return sendJson(res, 400, { ok: false, message: 'email y password son requeridos' });

  if (isPostgresMode()) {
    const authData = await withPgClient(async (client) => {
      const userRs = await client.query(
        'SELECT id, nombre, email, rol, password_hash FROM usuarios WHERE email = $1 LIMIT 1',
        [email]
      );
      if (!userRs.rows.length) return null;
      const user = userRs.rows[0];
      if (!verifyPassword(password, user.password_hash || '')) return null;
      const token = generateToken();
      await client.query(
        'INSERT INTO sesiones (usuario_id, token, creado_en, expira_en) VALUES ($1, $2, NOW(), NOW() + make_interval(hours => $3))',
        [user.id, token, SESSION_TTL_HOURS]
      );
      return { token, user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol } };
    });

    if (!authData) return sendJson(res, 401, { ok: false, message: 'credenciales inválidas' });
    await appendAuditLog('auth.login', { email }, authData.user.email);
    return sendJson(res, 200, { ok: true, token: authData.token, user: authData.user });
  }

  const state = await readStore();
  const user = state.usuarios.find(u => u.email === email);
  if (!user || !verifyPassword(password, user.passwordHash || '')) {
    return sendJson(res, 401, { ok: false, message: 'credenciales inválidas' });
  }

  const token = generateToken();
  state.sesiones.push({
    token,
    userId: user.id,
    creadoEn: new Date().toISOString()
  });
  await writeStore(state);
  await appendAudit('auth.login', { email }, user.email);

  return sendJson(res, 200, {
    ok: true,
    token,
    user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol }
  });
}

async function me(req, res) {
  const user = await getSessionUser(req);
  if (!user) return sendJson(res, 401, { ok: false, message: 'No autenticado' });
  return sendJson(res, 200, {
    ok: true,
    user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol }
  });
}

async function logout(req, res) {
  const token = getBearerToken(req);
  if (!token) return sendJson(res, 401, { ok: false, message: 'No autenticado' });

  if (isPostgresMode()) {
    const removed = await withPgClient(async (client) => {
      const rs = await client.query('DELETE FROM sesiones WHERE token = $1', [token]);
      return rs.rowCount || 0;
    });
    return sendJson(res, 200, { ok: true, removedSessions: removed });
  }

  const state = await readStore();
  const before = state.sesiones.length;
  state.sesiones = state.sesiones.filter(s => s.token !== token);
  const removed = before - state.sesiones.length;
  await writeStore(state);

  return sendJson(res, 200, { ok: true, removedSessions: removed });
}

module.exports = {
  register,
  login,
  me,
  logout,
  getSessionUser,
  requireRoles
};
