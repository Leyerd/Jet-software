const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'store.json');

const defaultState = {
  migratedAt: null,
  source: null,
  usuarios: [],
  sesiones: [],
  productos: [],
  movimientos: [],
  cuentas: [],
  terceros: [],
  flujoCaja: [],
  periodos: [],
  auditLog: []
};

function ensureStore() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultState, null, 2));
    return;
  }

  const state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  let changed = false;
  if (!Array.isArray(state.usuarios)) { state.usuarios = []; changed = true; }
  if (!Array.isArray(state.sesiones)) { state.sesiones = []; changed = true; }
  if (!Array.isArray(state.periodos)) { state.periodos = []; changed = true; }
  if (!Array.isArray(state.auditLog)) { state.auditLog = []; changed = true; }
  if (changed) fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function readStore() {
  ensureStore();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeStore(next) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(next, null, 2));
}

function appendAudit(action, detail, user = 'system') {
  const state = readStore();
  state.auditLog.push({
    id: `AUD-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    action,
    detail,
    user,
    createdAt: new Date().toISOString()
  });
  writeStore(state);
}

module.exports = { readStore, writeStore, appendAudit };
