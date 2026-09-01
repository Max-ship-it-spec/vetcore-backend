-- ══════════════════════════════════════════════════════════════
-- VETCORE — Esquema de base de datos MySQL
-- Ejecuta este archivo completo en tu servidor MySQL antes de
-- iniciar el backend. Ejemplo:
--   mysql -u root -p < schema.sql
-- ══════════════════════════════════════════════════════════════


-- ── Planes disponibles ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS planes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(30) UNIQUE NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  precio DECIMAL(10,2) NOT NULL DEFAULT 0,
  descripcion TEXT,
  modulos JSON
);

INSERT IGNORE INTO planes (codigo, nombre, precio, descripcion, modulos) VALUES
('starter', 'Plan Starter', 29.99,
  'Para veterinario independiente',
  JSON_ARRAY('clientes','pacientes','agenda','historia','ventas','inventario')),
('clinic', 'Plan Clinic', 59.99,
  'Para clínicas con varios usuarios',
  JSON_ARRAY('clientes','pacientes','agenda','historia','ventas','inventario','recordatorios','dashboard','reportes')),
('pro', 'Plan Pro', 99.99,
  'Automatización avanzada, marketing y fidelización',
  JSON_ARRAY('clientes','pacientes','agenda','historia','ventas','inventario','recordatorios','dashboard','reportes','whatsapp','marketing'));

-- ── Usuarios del sistema (admin de Vetcore + cuentas de clínicas) ──
CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rol ENUM('admin','cliente') NOT NULL DEFAULT 'cliente',
  nombre_clinica VARCHAR(150),
  nombre VARCHAR(150),
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  telefono VARCHAR(30),
  plan_id INT,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES planes(id)
);

-- ── Clientes (propietarios de mascotas) — dato de cada clínica ──
CREATE TABLE IF NOT EXISTS clientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cuenta_id INT NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  telefono VARCHAR(30),
  email VARCHAR(150),
  direccion VARCHAR(255),
  documento VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- ── Pacientes (mascotas) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS pacientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cuenta_id INT NOT NULL,
  cliente_id INT NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  especie VARCHAR(50),
  raza VARCHAR(100),
  sexo VARCHAR(20),
  fecha_nacimiento DATE NULL,
  peso DECIMAL(6,2),
  color VARCHAR(50),
  microchip VARCHAR(60),
  alergias TEXT,
  observaciones TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
);

-- ── Agenda (citas) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS citas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cuenta_id INT NOT NULL,
  cliente_id INT,
  paciente_id INT,
  fecha DATE NOT NULL,
  hora TIME,
  motivo VARCHAR(255),
  estado ENUM('pendiente','confirmada','cancelada','atendida') DEFAULT 'pendiente',
  notas TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL,
  FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE SET NULL
);

-- ── Historia clínica (consultas) ─────────────────────────────
CREATE TABLE IF NOT EXISTS historias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cuenta_id INT NOT NULL,
  paciente_id INT NOT NULL,
  fecha DATE NOT NULL,
  motivo VARCHAR(255),
  anamnesis TEXT,
  peso DECIMAL(6,2),
  temperatura DECIMAL(5,2),
  fc VARCHAR(20),
  fr VARCHAR(20),
  diagnostico TEXT,
  tratamiento TEXT,
  recomendaciones TEXT,
  proximo_control DATE NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE
);

-- ── Inventario básico ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS productos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cuenta_id INT NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  categoria VARCHAR(80),
  precio_venta DECIMAL(10,2) DEFAULT 0,
  precio_compra DECIMAL(10,2) DEFAULT 0,
  stock INT DEFAULT 0,
  stock_minimo INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- ── Ventas / facturación ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS ventas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cuenta_id INT NOT NULL,
  cliente_id INT,
  paciente_id INT,
  items_json JSON,
  subtotal DECIMAL(10,2) DEFAULT 0,
  descuento DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) DEFAULT 0,
  metodo_pago VARCHAR(30) DEFAULT 'efectivo',
  estado_pago ENUM('pagado','pendiente') DEFAULT 'pagado',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL,
  FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE SET NULL
);