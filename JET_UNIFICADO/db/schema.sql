CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS movimientos (
  id SERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  tipo TEXT NOT NULL,
  descripcion TEXT,
  neto NUMERIC(14,2) DEFAULT 0,
  iva NUMERIC(14,2) DEFAULT 0,
  total NUMERIC(14,2) DEFAULT 0,
  producto_id INTEGER REFERENCES productos(id),
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS periodos_contables (
  id SERIAL PRIMARY KEY,
  anio INTEGER NOT NULL,
  mes INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'abierto',
  cerrado_por TEXT,
  cerrado_en TIMESTAMP,
  UNIQUE(anio, mes)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  entidad TEXT NOT NULL,
  entidad_id TEXT NOT NULL,
  accion TEXT NOT NULL,
  detalle JSONB,
  usuario TEXT,
  fecha TIMESTAMP DEFAULT NOW()
);
