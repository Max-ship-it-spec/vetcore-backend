// ══════════════════════════════════════════════════════════════
// VETCORE — Backend API (Node.js + Express + MySQL)
// ══════════════════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function subirACloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => err ? reject(err) : resolve(result)
    );
    stream.end(buffer);
  });
}

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esta-clave';

app.use(cors());
app.use(express.json());

// ── Helpers ──────────────────────────────────────────────────
function firmarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, rol: usuario.rol, plan_id: usuario.plan_id },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verificarToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.rol !== 'admin') return res.status(403).json({ ok: false, error: 'Solo el administrador puede hacer esto' });
  next();
}

function requireCliente(req, res, next) {
  if (req.user.rol !== 'cliente') return res.status(403).json({ ok: false, error: 'Solo cuentas de clínica pueden hacer esto' });
  next();
}

async function usuarioPublico(row) {
  const { password_hash, ...resto } = row;
  return resto;
}

// ── AUTH ─────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: 'Email y contraseña requeridos' });

    const [rows] = await pool.query(
      `SELECT u.*, p.codigo AS plan_codigo, p.nombre AS plan_nombre, p.modulos AS plan_modulos
       FROM usuarios u LEFT JOIN planes p ON p.id = u.plan_id
       WHERE u.email=? LIMIT 1`, [email]
    );
    const usuario = rows[0];
    if (!usuario) return res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
    if (!usuario.activo) return res.status(403).json({ ok: false, error: 'Esta cuenta está desactivada' });

    const valido = await bcrypt.compare(password, usuario.password_hash);
    if (!valido) return res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });

    const token = firmarToken(usuario);
    res.json({ ok: true, token, usuario: await usuarioPublico(usuario) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/auth/me', verificarToken, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.*, p.codigo AS plan_codigo, p.nombre AS plan_nombre, p.modulos AS plan_modulos
     FROM usuarios u LEFT JOIN planes p ON p.id = u.plan_id
     WHERE u.id=? LIMIT 1`, [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ ok: false, error: 'No encontrado' });
  res.json({ ok: true, usuario: await usuarioPublico(rows[0]) });
});

// ── PLANES (lectura pública para el formulario del admin) ─────
app.get('/api/planes', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM planes ORDER BY precio ASC');
  res.json({ ok: true, planes: rows });
});

// ══════════════════════════════════════════════════════════════
// ADMIN — gestión de cuentas de clínicas (clientes de Vetcore)
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/cuentas', verificarToken, requireAdmin, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.nombre_clinica, u.nombre, u.email, u.telefono, u.activo, u.created_at,
            p.id AS plan_id, p.codigo AS plan_codigo, p.nombre AS plan_nombre, p.precio AS plan_precio
     FROM usuarios u LEFT JOIN planes p ON p.id = u.plan_id
     WHERE u.rol='cliente' ORDER BY u.id DESC`
  );
  res.json({ ok: true, cuentas: rows });
});

app.post('/api/admin/cuentas', verificarToken, requireAdmin, async (req, res) => {
  try {
    const { nombre_clinica, nombre, email, telefono, password, plan_id } = req.body || {};
    if (!nombre_clinica || !email || !password || !plan_id) {
      return res.status(400).json({ ok: false, error: 'Nombre de clínica, email, contraseña y plan son obligatorios' });
    }
    const [existe] = await pool.query('SELECT id FROM usuarios WHERE email=?', [email]);
    if (existe.length) return res.status(400).json({ ok: false, error: 'Ese email ya está registrado' });

    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      `INSERT INTO usuarios (rol, nombre_clinica, nombre, email, telefono, password_hash, plan_id, activo)
       VALUES ('cliente', ?, ?, ?, ?, ?, ?, 1)`,
      [nombre_clinica, nombre || '', email, telefono || '', hash, plan_id]
    );
    res.json({ ok: true, id: result.insertId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put('/api/admin/cuentas/:id', verificarToken, requireAdmin, async (req, res) => {
  try {
    const { nombre_clinica, nombre, telefono, plan_id, activo, password } = req.body || {};
    await pool.query(
      `UPDATE usuarios SET
         nombre_clinica = COALESCE(?, nombre_clinica),
         nombre = COALESCE(?, nombre),
         telefono = COALESCE(?, telefono),
         plan_id = COALESCE(?, plan_id),
         activo = COALESCE(?, activo)
       WHERE id=? AND rol='cliente'`,
      [nombre_clinica ?? null, nombre ?? null, telefono ?? null, plan_id ?? null,
       (activo === undefined ? null : activo), req.params.id]
    );
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE usuarios SET password_hash=? WHERE id=?', [hash, req.params.id]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/admin/cuentas/:id', verificarToken, requireAdmin, async (req, res) => {
  await pool.query(`DELETE FROM usuarios WHERE id=? AND rol='cliente'`, [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/admin/stats', verificarToken, requireAdmin, async (req, res) => {
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM usuarios WHERE rol='cliente'`);
  const [[{ activas }]] = await pool.query(`SELECT COUNT(*) AS activas FROM usuarios WHERE rol='cliente' AND activo=1`);
  const [porPlan] = await pool.query(
    `SELECT p.nombre AS plan, COUNT(*) AS total, SUM(p.precio) AS ingreso_mensual
     FROM usuarios u JOIN planes p ON p.id=u.plan_id
     WHERE u.rol='cliente' AND u.activo=1 GROUP BY p.id`
  );
  res.json({ ok: true, total, activas, porPlan });
});

// ══════════════════════════════════════════════════════════════
// CLIENTE (clínica) — módulos del plan Starter
// Todo queda aislado por cuenta_id = req.user.id
// ══════════════════════════════════════════════════════════════

// ── Clientes (propietarios de mascotas) ────────────────────────
app.get('/api/clientes', verificarToken, requireCliente, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM clientes WHERE cuenta_id=? ORDER BY id DESC', [req.user.id]);
  res.json({ ok: true, clientes: rows });
});

app.post('/api/clientes', verificarToken, requireCliente, async (req, res) => {
  const { nombre, telefono, email, direccion, documento } = req.body || {};
  if (!nombre) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio' });
  const [result] = await pool.query(
    `INSERT INTO clientes (cuenta_id, nombre, telefono, email, direccion, documento)
     VALUES (?,?,?,?,?,?)`,
    [req.user.id, nombre, telefono || '', email || '', direccion || '', documento || '']
  );
  res.json({ ok: true, id: result.insertId });
});

app.put('/api/clientes/:id', verificarToken, requireCliente, async (req, res) => {
  const { nombre, telefono, email, direccion, documento } = req.body || {};
  await pool.query(
    `UPDATE clientes SET nombre=?, telefono=?, email=?, direccion=?, documento=?
     WHERE id=? AND cuenta_id=?`,
    [nombre, telefono || '', email || '', direccion || '', documento || '', req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

app.delete('/api/clientes/:id', verificarToken, requireCliente, async (req, res) => {
  await pool.query('DELETE FROM clientes WHERE id=? AND cuenta_id=?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ── Pacientes (mascotas) ────────────────────────────────────────
app.get('/api/pacientes', verificarToken, requireCliente, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT pa.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
     FROM pacientes pa JOIN clientes c ON c.id = pa.cliente_id
     WHERE pa.cuenta_id=? ORDER BY pa.id DESC`, [req.user.id]
  );
  res.json({ ok: true, pacientes: rows });
});

// ── Subir foto de mascota ──────────────────────────────────────
app.post('/api/pacientes/:id/foto', verificarToken, requireCliente, upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió ninguna imagen' });
    const result = await subirACloudinary(req.file.buffer, 'vetcore/pacientes');
    await pool.query(
      'UPDATE pacientes SET foto_url=? WHERE id=? AND cuenta_id=?',
      [result.secure_url, req.params.id, req.user.id]
    );
    res.json({ ok: true, foto_url: result.secure_url });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/pacientes', verificarToken, requireCliente, async (req, res) => {
  const { cliente_id, nombre, especie, raza, sexo, fecha_nacimiento, peso, color, microchip, alergias, observaciones } = req.body || {};
  if (!cliente_id || !nombre) return res.status(400).json({ ok: false, error: 'Propietario y nombre de la mascota son obligatorios' });
  const [result] = await pool.query(
    `INSERT INTO pacientes (cuenta_id, cliente_id, nombre, especie, raza, sexo, fecha_nacimiento, peso, color, microchip, alergias, observaciones)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [req.user.id, cliente_id, nombre, especie || '', raza || '', sexo || '', fecha_nacimiento || null,
     peso || null, color || '', microchip || '', alergias || '', observaciones || '']
  );
  res.json({ ok: true, id: result.insertId });
});

app.put('/api/pacientes/:id', verificarToken, requireCliente, async (req, res) => {
  const { nombre, especie, raza, sexo, fecha_nacimiento, peso, color, microchip, alergias, observaciones } = req.body || {};
  await pool.query(
    `UPDATE pacientes SET nombre=?, especie=?, raza=?, sexo=?, fecha_nacimiento=?, peso=?, color=?, microchip=?, alergias=?, observaciones=?
     WHERE id=? AND cuenta_id=?`,
    [nombre, especie || '', raza || '', sexo || '', fecha_nacimiento || null, peso || null,
     color || '', microchip || '', alergias || '', observaciones || '', req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

app.delete('/api/pacientes/:id', verificarToken, requireCliente, async (req, res) => {
  await pool.query('DELETE FROM pacientes WHERE id=? AND cuenta_id=?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ── Agenda (citas) ───────────────────────────────────────────
app.get('/api/citas', verificarToken, requireCliente, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT ci.*, c.nombre AS cliente_nombre, pa.nombre AS paciente_nombre
     FROM citas ci
     LEFT JOIN clientes c ON c.id = ci.cliente_id
     LEFT JOIN pacientes pa ON pa.id = ci.paciente_id
     WHERE ci.cuenta_id=? ORDER BY ci.fecha ASC, ci.hora ASC`, [req.user.id]
  );
  res.json({ ok: true, citas: rows });
});

app.post('/api/citas', verificarToken, requireCliente, async (req, res) => {
  const { cliente_id, paciente_id, fecha, hora, motivo, notas } = req.body || {};
  if (!fecha) return res.status(400).json({ ok: false, error: 'La fecha es obligatoria' });
  const [result] = await pool.query(
    `INSERT INTO citas (cuenta_id, cliente_id, paciente_id, fecha, hora, motivo, notas)
     VALUES (?,?,?,?,?,?,?)`,
    [req.user.id, cliente_id || null, paciente_id || null, fecha, hora || null, motivo || '', notas || '']
  );
  res.json({ ok: true, id: result.insertId });
});

app.put('/api/citas/:id', verificarToken, requireCliente, async (req, res) => {
  const { fecha, hora, motivo, notas, estado } = req.body || {};
  await pool.query(
    `UPDATE citas SET
       fecha = COALESCE(?, fecha), hora = COALESCE(?, hora),
       motivo = COALESCE(?, motivo), notas = COALESCE(?, notas),
       estado = COALESCE(?, estado)
     WHERE id=? AND cuenta_id=?`,
    [fecha ?? null, hora ?? null, motivo ?? null, notas ?? null, estado ?? null, req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

app.delete('/api/citas/:id', verificarToken, requireCliente, async (req, res) => {
  await pool.query('DELETE FROM citas WHERE id=? AND cuenta_id=?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});




// ── Búsqueda global (paciente, tutor, teléfono) ────────────────
app.get('/api/buscar', verificarToken, requireCliente, async (req, res) => {
  const term = (req.query.q || '').trim();
  if (!term) return res.json({ ok: true, clientes: [], pacientes: [] });
  const like = `%${term}%`;
  const [clientes] = await pool.query(
    `SELECT id, nombre, telefono FROM clientes WHERE cuenta_id=? AND (nombre LIKE ? OR telefono LIKE ?) LIMIT 6`,
    [req.user.id, like, like]
  );
  const [pacientes] = await pool.query(
    `SELECT pa.id, pa.nombre, pa.especie, c.nombre AS cliente_nombre
     FROM pacientes pa JOIN clientes c ON c.id = pa.cliente_id
     WHERE pa.cuenta_id=? AND pa.nombre LIKE ? LIMIT 6`,
    [req.user.id, like]
  );
  res.json({ ok: true, clientes, pacientes });
});

// ── Historia clínica (consultas) ───────────────────────────────
app.get('/api/historias/:paciente_id', verificarToken, requireCliente, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM historias WHERE paciente_id=? AND cuenta_id=? ORDER BY fecha DESC, id DESC`,
    [req.params.paciente_id, req.user.id]
  );
  res.json({ ok: true, historias: rows });
});

app.post('/api/historias', verificarToken, requireCliente, async (req, res) => {
  const { paciente_id, fecha, motivo, anamnesis, peso, temperatura, fc, fr, diagnostico, tratamiento, recomendaciones, proximo_control } = req.body || {};
  if (!paciente_id || !fecha) return res.status(400).json({ ok: false, error: 'Paciente y fecha son obligatorios' });
  const [result] = await pool.query(
    `INSERT INTO historias (cuenta_id, paciente_id, fecha, motivo, anamnesis, peso, temperatura, fc, fr, diagnostico, tratamiento, recomendaciones, proximo_control)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [req.user.id, paciente_id, fecha, motivo || '', anamnesis || '', peso || null, temperatura || null,
     fc || '', fr || '', diagnostico || '', tratamiento || '', recomendaciones || '', proximo_control || null]
  );
  res.json({ ok: true, id: result.insertId });
});

app.delete('/api/historias/:id', verificarToken, requireCliente, async (req, res) => {
  await pool.query('DELETE FROM historias WHERE id=? AND cuenta_id=?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ── Inventario básico ────────────────────────────────────────
app.get('/api/productos', verificarToken, requireCliente, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM productos WHERE cuenta_id=? ORDER BY nombre ASC', [req.user.id]);
  res.json({ ok: true, productos: rows });
});

app.post('/api/productos', verificarToken, requireCliente, async (req, res) => {
  const { nombre, categoria, precio_venta, precio_compra, stock, stock_minimo } = req.body || {};
  if (!nombre) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio' });
  const [result] = await pool.query(
    `INSERT INTO productos (cuenta_id, nombre, categoria, precio_venta, precio_compra, stock, stock_minimo)
     VALUES (?,?,?,?,?,?,?)`,
    [req.user.id, nombre, categoria || '', precio_venta || 0, precio_compra || 0, stock || 0, stock_minimo || 0]
  );
  res.json({ ok: true, id: result.insertId });
});

app.put('/api/productos/:id', verificarToken, requireCliente, async (req, res) => {
  const { nombre, categoria, precio_venta, precio_compra, stock, stock_minimo } = req.body || {};
  await pool.query(
    `UPDATE productos SET nombre=?, categoria=?, precio_venta=?, precio_compra=?, stock=?, stock_minimo=?
     WHERE id=? AND cuenta_id=?`,
    [nombre, categoria || '', precio_venta || 0, precio_compra || 0, stock || 0, stock_minimo || 0, req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

app.delete('/api/productos/:id', verificarToken, requireCliente, async (req, res) => {
  await pool.query('DELETE FROM productos WHERE id=? AND cuenta_id=?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ── Ventas / facturación ─────────────────────────────────────
app.get('/api/ventas', verificarToken, requireCliente, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT v.*, c.nombre AS cliente_nombre, pa.nombre AS paciente_nombre
     FROM ventas v
     LEFT JOIN clientes c ON c.id = v.cliente_id
     LEFT JOIN pacientes pa ON pa.id = v.paciente_id
     WHERE v.cuenta_id=? ORDER BY v.id DESC`, [req.user.id]
  );
  res.json({ ok: true, ventas: rows });
});

app.post('/api/ventas', verificarToken, requireCliente, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { cliente_id, paciente_id, items, descuento, metodo_pago, estado_pago } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ ok: false, error: 'Agrega al menos un producto o servicio' });
    }

    await conn.beginTransaction();

    let subtotal = 0;
    for (const item of items) {
      subtotal += Number(item.precio) * Number(item.cantidad || 1);
      if (item.producto_id) {
        await conn.query(
          'UPDATE productos SET stock = GREATEST(stock - ?, 0) WHERE id=? AND cuenta_id=?',
          [item.cantidad || 1, item.producto_id, req.user.id]
        );
      }
    }
    const total = Math.max(subtotal - Number(descuento || 0), 0);

    const [result] = await conn.query(
      `INSERT INTO ventas (cuenta_id, cliente_id, paciente_id, items_json, subtotal, descuento, total, metodo_pago, estado_pago)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [req.user.id, cliente_id || null, paciente_id || null, JSON.stringify(items),
       subtotal, descuento || 0, total, metodo_pago || 'efectivo', estado_pago || 'pagado']
    );

    await conn.commit();
    res.json({ ok: true, id: result.insertId, total });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    conn.release();
  }
});

app.delete('/api/ventas/:id', verificarToken, requireCliente, async (req, res) => {
  await pool.query('DELETE FROM ventas WHERE id=? AND cuenta_id=?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ── Dashboard resumen (cliente) ───────────────────────────────
app.get('/api/resumen', verificarToken, requireCliente, async (req, res) => {
  const uid = req.user.id;
  const [[{ totalClientes }]] = await pool.query('SELECT COUNT(*) AS totalClientes FROM clientes WHERE cuenta_id=?', [uid]);
  const [[{ totalPacientes }]] = await pool.query('SELECT COUNT(*) AS totalPacientes FROM pacientes WHERE cuenta_id=?', [uid]);
  const [[{ citasHoy }]] = await pool.query('SELECT COUNT(*) AS citasHoy FROM citas WHERE cuenta_id=? AND fecha=CURDATE()', [uid]);
  const [[{ enEspera }]] = await pool.query(`SELECT COUNT(*) AS enEspera FROM citas WHERE cuenta_id=? AND fecha=CURDATE() AND estado='en_espera'`, [uid]);
  const [[{ ventasMes }]] = await pool.query(
    `SELECT COALESCE(SUM(total),0) AS ventasMes FROM ventas
     WHERE cuenta_id=? AND MONTH(created_at)=MONTH(CURDATE()) AND YEAR(created_at)=YEAR(CURDATE())`, [uid]
  );
  const [[{ ventasHoy }]] = await pool.query(
    `SELECT COALESCE(SUM(total),0) AS ventasHoy FROM ventas WHERE cuenta_id=? AND DATE(created_at)=CURDATE()`, [uid]
  );
  const [[{ stockBajo }]] = await pool.query('SELECT COUNT(*) AS stockBajo FROM productos WHERE cuenta_id=? AND stock <= stock_minimo', [uid]);
  const [proximasCitas] = await pool.query(
    `SELECT ci.*, c.nombre AS cliente_nombre, pa.nombre AS paciente_nombre
     FROM citas ci LEFT JOIN clientes c ON c.id=ci.cliente_id LEFT JOIN pacientes pa ON pa.id=ci.paciente_id
     WHERE ci.cuenta_id=? AND ci.fecha=CURDATE() AND ci.estado NOT IN ('cancelada','atendida')
     ORDER BY ci.hora ASC LIMIT 6`, [uid]
  );
  const alertas = Number(stockBajo);
  res.json({ ok: true, totalClientes, totalPacientes, citasHoy, enEspera, ventasMes, ventasHoy, stockBajo, alertas, proximasCitas });
});

// ── Salud del servicio ───────────────────────────────────────
app.get('/', (req, res) => res.json({ ok: true, servicio: 'Vetcore API' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🐾 Vetcore API corriendo en el puerto ${PORT}`));