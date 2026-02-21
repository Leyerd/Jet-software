-- Sprint 2: esquema base para operación contable-tributaria

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL,
  password_hash TEXT,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sesiones (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  token TEXT UNIQUE NOT NULL,
  creado_en TIMESTAMP DEFAULT NOW(),
  expira_en TIMESTAMP
);

CREATE TABLE IF NOT EXISTS terceros (
  id SERIAL PRIMARY KEY,
  rut TEXT UNIQUE,
  nombre TEXT NOT NULL,
  tipo TEXT,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cuentas (
  id SERIAL PRIMARY KEY,
  codigo TEXT UNIQUE,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,
  saldo NUMERIC(14,2) DEFAULT 0,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS productos (
  id SERIAL PRIMARY KEY,
  sku TEXT UNIQUE,
  nombre TEXT NOT NULL,
  stock NUMERIC(14,2) DEFAULT 0,
  costo_promedio NUMERIC(14,2) DEFAULT 0,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lotes_inventario (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  fecha_ingreso DATE NOT NULL,
  cantidad NUMERIC(14,2) NOT NULL,
  costo_unitario NUMERIC(14,2) NOT NULL,
  origen TEXT,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kardex_movimientos (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  lote_id INTEGER REFERENCES lotes_inventario(id),
  fecha DATE NOT NULL,
  tipo TEXT NOT NULL,
  cantidad NUMERIC(14,2) NOT NULL,
  costo_unitario NUMERIC(14,2),
  referencia TEXT,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movimientos (
  id SERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  tipo TEXT NOT NULL,
  descripcion TEXT,
  neto NUMERIC(14,2) DEFAULT 0,
  iva NUMERIC(14,2) DEFAULT 0,
  total NUMERIC(14,2) DEFAULT 0,
  producto_id INTEGER REFERENCES productos(id),
  tercero_id INTEGER REFERENCES terceros(id),
  n_doc TEXT,
  estado TEXT DEFAULT 'vigente',
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flujo_caja (
  id SERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  cuenta_id INTEGER REFERENCES cuentas(id),
  tipo_movimiento TEXT NOT NULL,
  descripcion TEXT,
  monto NUMERIC(14,2) NOT NULL,
  ref_movimiento_id INTEGER REFERENCES movimientos(id),
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS periodos_contables (
  id SERIAL PRIMARY KEY,
  anio INTEGER NOT NULL,
  mes INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'abierto',
  cerrado_por TEXT,
  cerrado_en TIMESTAMP,
  reabierto_por TEXT,
  reabierto_en TIMESTAMP,
  motivo_reapertura TEXT,
  UNIQUE(anio, mes)
);

CREATE TABLE IF NOT EXISTS asientos_contables (
  id SERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  glosa TEXT,
  origen TEXT,
  estado TEXT DEFAULT 'borrador',
  creado_por TEXT,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asiento_lineas (
  id SERIAL PRIMARY KEY,
  asiento_id INTEGER NOT NULL REFERENCES asientos_contables(id),
  cuenta_id INTEGER NOT NULL REFERENCES cuentas(id),
  debe NUMERIC(14,2) DEFAULT 0,
  haber NUMERIC(14,2) DEFAULT 0,
  descripcion TEXT
);

CREATE TABLE IF NOT EXISTS conciliaciones (
  id SERIAL PRIMARY KEY,
  periodo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  resumen JSONB,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documentos_fiscales (
  id SERIAL PRIMARY KEY,
  tipo_dte TEXT NOT NULL,
  folio TEXT,
  rut_emisor TEXT,
  rut_receptor TEXT,
  fecha_emision DATE,
  neto NUMERIC(14,2) DEFAULT 0,
  iva NUMERIC(14,2) DEFAULT 0,
  total NUMERIC(14,2) DEFAULT 0,
  metadata JSONB,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tax_config (
  id SERIAL PRIMARY KEY,
  anio INTEGER NOT NULL,
  regimen TEXT NOT NULL,
  ppm_rate NUMERIC(8,4),
  ret_rate NUMERIC(8,4),
  iva_rate NUMERIC(8,4) DEFAULT 0.19,
  UNIQUE(anio, regimen)
);

CREATE TABLE IF NOT EXISTS backups (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  ruta TEXT NOT NULL,
  estado TEXT NOT NULL,
  generado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  entidad TEXT,
  entidad_id TEXT,
  accion TEXT NOT NULL,
  detalle JSONB,
  usuario TEXT,
  fecha TIMESTAMP DEFAULT NOW()
);
