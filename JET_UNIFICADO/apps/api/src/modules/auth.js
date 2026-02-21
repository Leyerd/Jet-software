const crypto = require('crypto');
const { parseBody, sendJson } = require('../lib/http');
const { readStore, writeStore, appendAudit } = require('../lib/store');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return null;
  const [prefix, token] = header.split(' ');
  if (prefix !== 'Bearer' || !token) return null;
  return token;
}

function getSessionUser(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  const state = readStore();
  const session = state.sesiones.find(s => s.token === token);
  if (!session) return null;
  return state.usuarios.find(u => u.id === session.userId) || null;
}

function requireRoles(req, allowedRoles) {
  const user = getSessionUser(req);
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

  const validRoles = ['dueno', 'contador_admin', 'operador', 'auditor'];
  if (!validRoles.includes(rol)) {
    return sendJson(res, 400, { ok: false, message: 'rol inválido' });
  }

  const state = readStore();
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
  writeStore(state);
  appendAudit('auth.register', { email, rol }, user.email);
  return sendJson(res, 201, { ok: true, user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol } });
}

async function login(req, res) {
  const body = await parseBody(req);
  const email = (body.email || '').toLowerCase().trim();
  const password = body.password;
  if (!email || !password) return sendJson(res, 400, { ok: false, message: 'email y password son requeridos' });

  const state = readStore();
  const user = state.usuarios.find(u => u.email === email);
  if (!user || user.passwordHash !== hashPassword(password)) {
    return sendJson(res, 401, { ok: false, message: 'credenciales inválidas' });
  }

  const token = generateToken();
  state.sesiones.push({
    token,
    userId: user.id,
    creadoEn: new Date().toISOString()
  });
  writeStore(state);
  appendAudit('auth.login', { email }, user.email);

  return sendJson(res, 200, {
    ok: true,
    token,
    user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol }
  });
}

function me(req, res) {
  const user = getSessionUser(req);
  if (!user) return sendJson(res, 401, { ok: false, message: 'No autenticado' });
  return sendJson(res, 200, {
    ok: true,
    user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol }
  });
}

module.exports = {
  register,
  login,
  me,
  getSessionUser,
  requireRoles
};
