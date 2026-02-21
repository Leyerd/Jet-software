const crypto = require('crypto');
const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');

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
