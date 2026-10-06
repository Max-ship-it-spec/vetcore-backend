// ══════════════════════════════════════════════════════════════
// VETCORE — Backend API (Node.js + Express + MySQL)
// Modelo: 1 empresa (clínica) → cuentas de rol (propietario / veterinario / recepcion)
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
// Envuelve los handlers async: si algo falla responde 500 en vez de dejar la petición colgada
const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((e) => {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  });

function firmarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, rol: usuario.rol, empresa_id: usuario.empresa_id },
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

// Cualquiera de las cuentas de una empresa (propietario/veterinario/recepcion)
function requireEmpresa(req, res, next) {
  if (!req.user.empresa_id) return res.status(403).json({ ok: false, error: 'Esta cuenta no pertenece a ninguna clínica' });
  next();
}

// Restringe a roles específicos dentro de una empresa. Uso: requireRoles('propietario','recepcion')
function requireRoles(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.user.empresa_id || !rolesPermitidos.includes(req.user.rol)) {
      return res.status(403).json({ ok: false, error: 'Tu rol no tiene acceso a esta función' });
    }
    next();
  };
}

async function usuarioPublico(row) {
  const { password_hash, ...resto } = row;
  return resto;
}

// Devuelve el id si es un veterinario activo de esa empresa, null si no se envió, false si es inválido
async function vetValido(id, empresaId) {
  if (!id) return null;
  const [r] = await pool.query(
    `SELECT id FROM usuarios WHERE id=? AND empresa_id=? AND rol='veterinario' AND activo=1`,
    [id, empresaId]
  );
  return r.length ? Number(id) : false;
}

// Rango de fechas para caja y reportes. El propietario elige; los demás solo ven el día de hoy.
async function resolverRango(req) {
  const [[f]] = await pool.query(
    `SELECT DATE_FORMAT(CURDATE(),'%Y-%m-%d') AS hoy, DATE_FORMAT(CURDATE(),'%Y-%m-01') AS inicio_mes`
  );
  const limitado = req.user.rol !== 'propietario';
  const valida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  let desde = f.hoy, hasta = f.hoy;
  if (!limitado) {
    desde = valida(req.query.desde) ? req.query.desde : f.inicio_mes;
    hasta = valida(req.query.hasta) ? req.query.hasta : f.hoy;
  }
  return { desde, hasta, limitado };
}
// ── STOCK POR ALMACÉN ────────────────────────────────────────
async function almacenPrincipal(db, empresaId) {
  const [r] = await db.query(`SELECT id FROM almacenes WHERE empresa_id=? ORDER BY es_principal DESC, id ASC LIMIT 1`, [empresaId]);
  if (r.length) return r[0].id;
  const [ins] = await db.query(`INSERT INTO almacenes (empresa_id, nombre, es_principal) VALUES (?, 'Principal', 1)`, [empresaId]);
  return ins.insertId;
}

// Suma/resta stock en un almacén, mantiene productos.stock (total) y registra el kardex
async function moverStock(conn, { empresaId, productoId, almacenId, delta, tipo, motivo, usuarioId, docId = null }) {
  await conn.query(
    `INSERT INTO stock_almacen (empresa_id, producto_id, almacen_id, stock) VALUES (?,?,?,0)
     ON DUPLICATE KEY UPDATE stock = stock`, [empresaId, productoId, almacenId]);
  const [[fila]] = await conn.query(
    `SELECT stock FROM stock_almacen WHERE producto_id=? AND almacen_id=? FOR UPDATE`, [productoId, almacenId]);
  if (Number(fila.stock) + delta < 0) throw new Error('Stock insuficiente en el almacén seleccionado');
  await conn.query(`UPDATE stock_almacen SET stock = stock + ? WHERE producto_id=? AND almacen_id=?`, [delta, productoId, almacenId]);
  await conn.query(`UPDATE productos SET stock = stock + ? WHERE id=? AND empresa_id=?`, [delta, productoId, empresaId]);
  const [[p]] = await conn.query(`SELECT stock FROM productos WHERE id=?`, [productoId]);
  await conn.query(
    `INSERT INTO movimientos_stock (empresa_id, producto_id, almacen_id, tipo, cantidad, saldo, motivo, documento_id, usuario_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [empresaId, productoId, almacenId, tipo, delta, p.stock, motivo || '', docId, usuarioId]);
}

// Las ventas descuentan primero del almacén principal y luego de los demás
async function descontarVenta(conn, empresaId, productoId, cantidad, usuarioId) {
  let falta = Number(cantidad);
  const [filas] = await conn.query(
    `SELECT sa.almacen_id, sa.stock FROM stock_almacen sa JOIN almacenes a ON a.id = sa.almacen_id
     WHERE sa.empresa_id=? AND sa.producto_id=? AND sa.stock>0 ORDER BY a.es_principal DESC, a.id ASC`,
    [empresaId, productoId]);
  for (const f of filas) {
    if (falta <= 0) break;
    const tomar = Math.min(falta, Number(f.stock));
    await moverStock(conn, { empresaId, productoId, almacenId: f.almacen_id, delta: -tomar, tipo: 'venta', motivo: 'Venta', usuarioId });
    falta -= tomar;
  }
}

function datosProducto(b) {
  const cero = (x) => x === 0 || x === '0';
  return {
    nombre: String(b.nombre || '').trim(),
    codigo_barras: b.codigo_barras || '', marca: b.marca || '', proveedor: b.proveedor || '',
    linea: b.linea || '', categoria: b.categoria || '', subcategoria: b.subcategoria || '',
    presentacion: b.presentacion || '', contenido: b.contenido || '', unidad_medida: b.unidad_medida || 'UND',
    precio_compra: Number(b.precio_compra) || 0, precio_venta: Number(b.precio_venta) || 0,
    stock_minimo: parseInt(b.stock_minimo) || 0, stock_maximo: parseInt(b.stock_maximo) || 0,
    disponible_venta: cero(b.disponible_venta) ? 0 : 1,
    frecuencia_dias: b.frecuencia_dias ? parseInt(b.frecuencia_dias) : null,
    activo: cero(b.activo) ? 0 : 1,
  };
}



// ── AUTH ─────────────────────────────────────────────────────
// Login único: cada cuenta (admin, propietario, veterinario, recepcion) tiene su propio email+password
app.post('/api/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, error: 'Email y contraseña requeridos' });

  const [rows] = await pool.query(
    `SELECT u.*, e.nombre_clinica, e.activo AS empresa_activa, p.nombre AS plan_nombre, p.modulos AS plan_modulos
     FROM usuarios u
     LEFT JOIN empresas e ON e.id = u.empresa_id
     LEFT JOIN planes p ON p.id = e.plan_id
     WHERE u.email=? LIMIT 1`, [email]
  );
  const usuario = rows[0];
  if (!usuario) return res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
  if (!usuario.activo) return res.status(403).json({ ok: false, error: 'Esta cuenta está desactivada' });
  if (usuario.empresa_id && !usuario.empresa_activa) return res.status(403).json({ ok: false, error: 'La clínica está desactivada' });

  const valido = await bcrypt.compare(password, usuario.password_hash);
  if (!valido) return res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });

  const token = firmarToken(usuario);
  res.json({ ok: true, token, usuario: await usuarioPublico(usuario) });
}));

app.get('/api/auth/me', verificarToken, ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.*, e.nombre_clinica, p.nombre AS plan_nombre, p.modulos AS plan_modulos
     FROM usuarios u
     LEFT JOIN empresas e ON e.id = u.empresa_id
     LEFT JOIN planes p ON p.id = e.plan_id
     WHERE u.id=? LIMIT 1`, [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ ok: false, error: 'No encontrado' });
  res.json({ ok: true, usuario: await usuarioPublico(rows[0]) });
}));

// Cambiar la propia contraseña (cualquier cuenta)
app.put('/api/auth/password', verificarToken, ah(async (req, res) => {
  const { actual, nueva } = req.body || {};
  if (!actual || !nueva || String(nueva).length < 6) {
    return res.status(400).json({ ok: false, error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  const [rows] = await pool.query('SELECT password_hash FROM usuarios WHERE id=?', [req.user.id]);
  if (!rows[0] || !(await bcrypt.compare(actual, rows[0].password_hash || ''))) {
    return res.status(400).json({ ok: false, error: 'La contraseña actual no es correcta' });
  }
  const hash = await bcrypt.hash(String(nueva), 10);
  await pool.query('UPDATE usuarios SET password_hash=? WHERE id=?', [hash, req.user.id]);
  res.json({ ok: true });
}));

// ── PLANES (lectura pública para el formulario del admin) ─────
app.get('/api/planes', ah(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM planes ORDER BY precio ASC');
  res.json({ ok: true, planes: rows });
}));

// ══════════════════════════════════════════════════════════════
// ADMIN — gestión de empresas (clínicas) y sus cuentas de rol
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/empresas', verificarToken, requireAdmin, ah(async (req, res) => {
  const [empresas] = await pool.query(
    `SELECT e.*, p.nombre AS plan_nombre, p.precio AS plan_precio
     FROM empresas e LEFT JOIN planes p ON p.id = e.plan_id
     ORDER BY e.id DESC`
  );
  const [cuentas] = await pool.query(
    `SELECT id, empresa_id, rol, nombre, email, activo FROM usuarios WHERE empresa_id IS NOT NULL`
  );
  const porEmpresa = empresas.map(e => ({ ...e, cuentas: cuentas.filter(c => c.empresa_id === e.id) }));
  res.json({ ok: true, empresas: porEmpresa });
}));

app.get('/api/admin/stats', verificarToken, requireAdmin, ah(async (req, res) => {
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM empresas`);
  const [[{ activas }]] = await pool.query(`SELECT COUNT(*) AS activas FROM empresas WHERE activo=1`);
  const [porPlan] = await pool.query(
    `SELECT p.nombre AS plan, COUNT(*) AS total, SUM(p.precio) AS ingreso_mensual
     FROM empresas e JOIN planes p ON p.id=e.plan_id
     WHERE e.activo=1 GROUP BY p.id`
  );
  res.json({ ok: true, total, activas, porPlan });
}));

// Crea una empresa nueva + su cuenta de propietario (obligatoria) + veterinario/recepcion (opcionales)
app.post('/api/admin/empresas', verificarToken, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { nombre_clinica, plan_id, propietario, veterinario, recepcion } = req.body || {};
    if (!nombre_clinica || !plan_id || !propietario?.email || !propietario?.password) {
      return res.status(400).json({ ok: false, error: 'Nombre de clínica, plan y los datos del propietario son obligatorios' });
    }

    const emails = [propietario, veterinario, recepcion].filter(Boolean).map(c => c.email);
    const [dupes] = await conn.query('SELECT email FROM usuarios WHERE email IN (?)', [emails]);
    if (dupes.length) return res.status(400).json({ ok: false, error: `Email ya registrado: ${dupes[0].email}` });

    await conn.beginTransaction();

    const [empresaResult] = await conn.query(
      'INSERT INTO empresas (nombre_clinica, plan_id, activo) VALUES (?,?,1)',
      [nombre_clinica, plan_id]
    );
    const empresaId = empresaResult.insertId;

    async function crearCuenta(datos, rol) {
      if (!datos?.email || !datos?.password) return null;
      const hash = await bcrypt.hash(datos.password, 10);
      const [r] = await conn.query(
        'INSERT INTO usuarios (empresa_id, rol, nombre, email, telefono, password_hash, activo) VALUES (?,?,?,?,?,?,1)',
        [empresaId, rol, datos.nombre || '', datos.email, datos.telefono || '', hash]
      );
      return r.insertId;
    }

    const propietarioId = await crearCuenta(propietario, 'propietario');
    const veterinarioId = await crearCuenta(veterinario, 'veterinario');
    const recepcionId = await crearCuenta(recepcion, 'recepcion');

    await conn.commit();
    res.json({ ok: true, empresa_id: empresaId, propietario_id: propietarioId, veterinario_id: veterinarioId, recepcion_id: recepcionId });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    conn.release();
  }
});

// Agrega una cuenta suelta a una empresa que ya existe
app.post('/api/admin/empresas/:id/cuentas', verificarToken, requireAdmin, ah(async (req, res) => {
  const { rol, nombre, email, telefono, password } = req.body || {};
  if (!['propietario', 'veterinario', 'recepcion'].includes(rol)) return res.status(400).json({ ok: false, error: 'Rol inválido' });
  if (!email || !password) return res.status(400).json({ ok: false, error: 'Email y contraseña son obligatorios' });
  const [existe] = await pool.query('SELECT id FROM usuarios WHERE email=?', [email]);
  if (existe.length) return res.status(400).json({ ok: false, error: 'Ese email ya está registrado' });
  const hash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    'INSERT INTO usuarios (empresa_id, rol, nombre, email, telefono, password_hash, activo) VALUES (?,?,?,?,?,?,1)',
    [req.params.id, rol, nombre || '', email, telefono || '', hash]
  );
  res.json({ ok: true, id: result.insertId });
}));

app.put('/api/admin/cuentas/:id', verificarToken, requireAdmin, ah(async (req, res) => {
  const { nombre, telefono, activo, password } = req.body || {};
  await pool.query(
    `UPDATE usuarios SET
       nombre = COALESCE(?, nombre), telefono = COALESCE(?, telefono), activo = COALESCE(?, activo)
     WHERE id=? AND rol != 'admin'`,
    [nombre ?? null, telefono ?? null, (activo === undefined ? null : activo), req.params.id]
  );
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(`UPDATE usuarios SET password_hash=? WHERE id=? AND rol != 'admin'`, [hash, req.params.id]);
  }
  res.json({ ok: true });
}));

app.delete('/api/admin/cuentas/:id', verificarToken, requireAdmin, ah(async (req, res) => {
  await pool.query(`DELETE FROM usuarios WHERE id=? AND rol != 'admin'`, [req.params.id]);
  res.json({ ok: true });
}));

app.put('/api/admin/empresas/:id', verificarToken, requireAdmin, ah(async (req, res) => {
  const { nombre_clinica, plan_id, activo } = req.body || {};
  await pool.query(
    `UPDATE empresas SET
       nombre_clinica = COALESCE(?, nombre_clinica), plan_id = COALESCE(?, plan_id), activo = COALESCE(?, activo)
     WHERE id=?`,
    [nombre_clinica ?? null, plan_id ?? null, (activo === undefined ? null : activo), req.params.id]
  );
  res.json({ ok: true });
}));

app.delete('/api/admin/empresas/:id', verificarToken, requireAdmin, ah(async (req, res) => {
  await pool.query('DELETE FROM usuarios WHERE empresa_id=?', [req.params.id]);
  await pool.query('DELETE FROM empresas WHERE id=?', [req.params.id]);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════
// PERSONAL — el propietario ve y administra a su equipo (las cuentas las crea el admin)
// ══════════════════════════════════════════════════════════════
app.get('/api/personal', verificarToken, requireRoles('propietario'), ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, rol, nombre, email, activo FROM usuarios
     WHERE empresa_id=? ORDER BY FIELD(rol,'propietario','veterinario','recepcion'), nombre`,
    [req.user.empresa_id]
  );
  res.json({ ok: true, personal: rows });
}));

app.put('/api/personal/:id', verificarToken, requireRoles('propietario'), ah(async (req, res) => {
  const { nombre, activo, password } = req.body || {};
  const [r] = await pool.query(
    `UPDATE usuarios SET nombre = COALESCE(?, nombre), activo = COALESCE(?, activo)
     WHERE id=? AND empresa_id=? AND rol IN ('veterinario','recepcion')`,
    [nombre ?? null, (activo === undefined ? null : activo), req.params.id, req.user.empresa_id]
  );
  if (!r.affectedRows) return res.status(404).json({ ok: false, error: 'Cuenta no encontrada' });
  if (password) {
    const hash = await bcrypt.hash(String(password), 10);
    await pool.query(
      `UPDATE usuarios SET password_hash=? WHERE id=? AND empresa_id=? AND rol IN ('veterinario','recepcion')`,
      [hash, req.params.id, req.user.empresa_id]
    );
  }
  res.json({ ok: true });
}));

// Veterinarios activos de la clínica (para asignar citas y atenciones) — lo ven los 3 roles
app.get('/api/veterinarios', verificarToken, requireEmpresa, ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, nombre FROM usuarios WHERE empresa_id=? AND rol='veterinario' AND activo=1 ORDER BY nombre`,
    [req.user.empresa_id]
  );
  res.json({ ok: true, veterinarios: rows });
}));

// ══════════════════════════════════════════════════════════════
// CONFIGURACIÓN Y RESPALDO — solo propietario (lectura de configuración: todos)
// ══════════════════════════════════════════════════════════════
app.get('/api/configuracion', verificarToken, requireEmpresa, ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT e.nombre_clinica, p.nombre AS plan_nombre
     FROM empresas e LEFT JOIN planes p ON p.id = e.plan_id WHERE e.id=?`,
    [req.user.empresa_id]
  );
  res.json({ ok: true, configuracion: rows[0] || {} });
}));

app.put('/api/configuracion', verificarToken, requireRoles('propietario'), ah(async (req, res) => {
  const nombre = String((req.body || {}).nombre_clinica || '').trim();
  if (!nombre) return res.status(400).json({ ok: false, error: 'El nombre de la clínica es obligatorio' });
  await pool.query('UPDATE empresas SET nombre_clinica=? WHERE id=?', [nombre, req.user.empresa_id]);
  res.json({ ok: true, nombre_clinica: nombre });
}));

app.get('/api/respaldo', verificarToken, requireRoles('propietario'), ah(async (req, res) => {
  const tablas = ['clientes', 'pacientes', 'citas', 'historias', 'productos', 'ventas', 'atenciones'];
  const datos = {};
  for (const t of tablas) {
    const [rows] = await pool.query(`SELECT * FROM ${t} WHERE empresa_id=?`, [req.user.empresa_id]);
    datos[t] = rows;
  }
  res.setHeader('Content-Disposition', 'attachment; filename="respaldo-vetcore.json"');
  res.json({ ok: true, generado: new Date().toISOString(), datos });
}));

// ══════════════════════════════════════════════════════════════
// ATENCIONES — episodio central del flujo veterinario
// El veterinario solo ve las atenciones que tiene asignadas.
// ══════════════════════════════════════════════════════════════
app.get('/api/atenciones', verificarToken, requireEmpresa, ah(async (req, res) => {
  const params = [req.user.empresa_id];
  let filtro = '';
  if (req.user.rol === 'veterinario') { filtro = ' AND a.veterinario_id=?'; params.push(req.user.id); }
  const recientes = req.query.recientes === '1';
  const [rows] = await pool.query(
    `SELECT a.*, pa.nombre AS paciente_nombre, c.nombre AS cliente_nombre,
            u.nombre AS staff_nombre, v.nombre AS veterinario_nombre
     FROM atenciones a
     JOIN pacientes pa ON pa.id=a.paciente_id
     JOIN clientes c ON c.id=a.cliente_id
     LEFT JOIN usuarios u ON u.id=a.staff_id
     LEFT JOIN usuarios v ON v.id=a.veterinario_id
     WHERE a.empresa_id=?${filtro}${recientes ? '' : " AND a.estado != 'cerrada'"}
     ORDER BY ${recientes ? 'a.created_at DESC LIMIT 8' : "FIELD(a.prioridad,'emergencia','urgente','prioritario','normal'), a.created_at ASC"}`,
    params
  );
  res.json({ ok: true, atenciones: rows });
}));

app.post('/api/atenciones', verificarToken, requireEmpresa, ah(async (req, res) => {
  const { paciente_id, cliente_id, cita_id, origen, prioridad, veterinario_id } = req.body || {};
  if (!paciente_id || !cliente_id) return res.status(400).json({ ok: false, error: 'Paciente y cliente son obligatorios' });
  // Si la crea un veterinario, queda asignada a él automáticamente
  const vetId = req.user.rol === 'veterinario' ? req.user.id : await vetValido(veterinario_id, req.user.empresa_id);
  if (vetId === false) return res.status(400).json({ ok: false, error: 'Veterinario no válido' });
  const [result] = await pool.query(
    `INSERT INTO atenciones (empresa_id, staff_id, veterinario_id, paciente_id, cliente_id, cita_id, origen, prioridad, estado)
     VALUES (?,?,?,?,?,?,?,?, 'llegada')`,
    [req.user.empresa_id, req.user.id, vetId, paciente_id, cliente_id, cita_id || null, origen || 'sin_cita', prioridad || 'normal']
  );
  res.json({ ok: true, id: result.insertId });
}));

// "Asignar veterinario" — recepción y propietario
app.put('/api/atenciones/:id/asignar', verificarToken, requireRoles('propietario', 'recepcion'), ah(async (req, res) => {
  const vetId = await vetValido((req.body || {}).veterinario_id, req.user.empresa_id);
  if (vetId === false) return res.status(400).json({ ok: false, error: 'Veterinario no válido' });
  await pool.query('UPDATE atenciones SET veterinario_id=? WHERE id=? AND empresa_id=?', [vetId, req.params.id, req.user.empresa_id]);
  res.json({ ok: true });
}));

// Recepción no puede pasar la atención a las etapas clínicas (consulta, diagnóstico, tratamiento)
app.put('/api/atenciones/:id/estado', verificarToken, requireEmpresa, ah(async (req, res) => {
  const { estado } = req.body || {};
  const estadosValidos = ['llegada','triaje','espera','consulta','diagnostico','tratamiento','venta','seguimiento','cerrada'];
  if (!estadosValidos.includes(estado)) return res.status(400).json({ ok: false, error: 'Estado inválido' });
  if (req.user.rol === 'recepcion' && ['consulta','diagnostico','tratamiento'].includes(estado)) {
    return res.status(403).json({ ok: false, error: 'Recepción no puede pasar la atención a etapas clínicas' });
  }
  const params = [estado, req.params.id, req.user.empresa_id];
  let filtro = '';
  if (req.user.rol === 'veterinario') { filtro = ' AND veterinario_id=?'; params.push(req.user.id); }
  await pool.query(`UPDATE atenciones SET estado=? WHERE id=? AND empresa_id=?${filtro}`, params);
  res.json({ ok: true });
}));

app.put('/api/atenciones/:id/vincular', verificarToken, requireEmpresa, ah(async (req, res) => {
  const { historia_id, venta_id } = req.body || {};
  await pool.query(
    `UPDATE atenciones SET historia_id=COALESCE(?,historia_id), venta_id=COALESCE(?,venta_id) WHERE id=? AND empresa_id=?`,
    [historia_id || null, venta_id || null, req.params.id, req.user.empresa_id]
  );
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════
// CLIENTES — los 3 roles leen y crean/editan; borrar: propietario y recepción
// ══════════════════════════════════════════════════════════════
app.get('/api/clientes', verificarToken, requireEmpresa, ah(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM clientes WHERE empresa_id=? ORDER BY id DESC', [req.user.empresa_id]);
  res.json({ ok: true, clientes: rows });
}));

app.post('/api/clientes', verificarToken, requireRoles('propietario', 'recepcion', 'veterinario'), ah(async (req, res) => {
  const { nombre, telefono, email, direccion, documento } = req.body || {};
  if (!nombre) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio' });
  const [result] = await pool.query(
    `INSERT INTO clientes (empresa_id, nombre, telefono, email, direccion, documento) VALUES (?,?,?,?,?,?)`,
    [req.user.empresa_id, nombre, telefono || '', email || '', direccion || '', documento || '']
  );
  res.json({ ok: true, id: result.insertId });
}));

app.put('/api/clientes/:id', verificarToken, requireRoles('propietario', 'recepcion', 'veterinario'), ah(async (req, res) => {
  const { nombre, telefono, email, direccion, documento } = req.body || {};
  await pool.query(
    `UPDATE clientes SET nombre=?, telefono=?, email=?, direccion=?, documento=? WHERE id=? AND empresa_id=?`,
    [nombre, telefono || '', email || '', direccion || '', documento || '', req.params.id, req.user.empresa_id]
  );
  res.json({ ok: true });
}));

app.delete('/api/clientes/:id', verificarToken, requireRoles('propietario', 'recepcion'), ah(async (req, res) => {
  await pool.query('DELETE FROM clientes WHERE id=? AND empresa_id=?', [req.params.id, req.user.empresa_id]);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════
// PACIENTES (mascotas) — los 3 roles leen y crean/editan; borrar: propietario y recepción
// ══════════════════════════════════════════════════════════════
app.get('/api/pacientes', verificarToken, requireEmpresa, ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT pa.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
     FROM pacientes pa JOIN clientes c ON c.id = pa.cliente_id
     WHERE pa.empresa_id=? ORDER BY pa.id DESC`, [req.user.empresa_id]
  );
  res.json({ ok: true, pacientes: rows });
}));

app.post('/api/pacientes/:id/foto', verificarToken, requireRoles('propietario', 'recepcion', 'veterinario'), upload.single('foto'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió ninguna imagen' });
  const result = await subirACloudinary(req.file.buffer, 'vetcore/pacientes');
  await pool.query('UPDATE pacientes SET foto_url=? WHERE id=? AND empresa_id=?', [result.secure_url, req.params.id, req.user.empresa_id]);
  res.json({ ok: true, foto_url: result.secure_url });
}));

app.post('/api/pacientes', verificarToken, requireRoles('propietario', 'recepcion', 'veterinario'), ah(async (req, res) => {
  const { cliente_id, nombre, especie, raza, sexo, fecha_nacimiento, peso, color, microchip, alergias, observaciones } = req.body || {};
  if (!cliente_id || !nombre) return res.status(400).json({ ok: false, error: 'Propietario y nombre de la mascota son obligatorios' });
  const [result] = await pool.query(
    `INSERT INTO pacientes (empresa_id, cliente_id, nombre, especie, raza, sexo, fecha_nacimiento, peso, color, microchip, alergias, observaciones)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [req.user.empresa_id, cliente_id, nombre, especie || '', raza || '', sexo || '', fecha_nacimiento || null,
     peso || null, color || '', microchip || '', alergias || '', observaciones || '']
  );
  res.json({ ok: true, id: result.insertId });
}));

app.put('/api/pacientes/:id', verificarToken, requireRoles('propietario', 'recepcion', 'veterinario'), ah(async (req, res) => {
  const { nombre, especie, raza, sexo, fecha_nacimiento, peso, color, microchip, alergias, observaciones } = req.body || {};
  await pool.query(
    `UPDATE pacientes SET nombre=?, especie=?, raza=?, sexo=?, fecha_nacimiento=?, peso=?, color=?, microchip=?, alergias=?, observaciones=?
     WHERE id=? AND empresa_id=?`,
    [nombre, especie || '', raza || '', sexo || '', fecha_nacimiento || null, peso || null,
     color || '', microchip || '', alergias || '', observaciones || '', req.params.id, req.user.empresa_id]
  );
  res.json({ ok: true });
}));

app.delete('/api/pacientes/:id', verificarToken, requireRoles('propietario', 'recepcion'), ah(async (req, res) => {
  await pool.query('DELETE FROM pacientes WHERE id=? AND empresa_id=?', [req.params.id, req.user.empresa_id]);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════
// AGENDA (citas) — propietario y recepción crean/editan.
// El veterinario solo ve las citas asignadas a él.
// Filtros: ?hoy=1  ?pendientes=1
// ══════════════════════════════════════════════════════════════
app.get('/api/citas', verificarToken, requireEmpresa, ah(async (req, res) => {
  const params = [req.user.empresa_id];
  let filtro = '';
  if (req.user.rol === 'veterinario') { filtro += ' AND ci.veterinario_id=?'; params.push(req.user.id); }
  if (req.query.hoy === '1') filtro += ' AND ci.fecha = CURDATE()';
  if (req.query.pendientes === '1') filtro += " AND ci.estado IN ('pendiente','confirmada') AND ci.fecha >= CURDATE()";
  const [rows] = await pool.query(
    `SELECT ci.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, pa.nombre AS paciente_nombre, v.nombre AS veterinario_nombre
     FROM citas ci
     LEFT JOIN clientes c ON c.id = ci.cliente_id
     LEFT JOIN pacientes pa ON pa.id = ci.paciente_id
     LEFT JOIN usuarios v ON v.id = ci.veterinario_id
     WHERE ci.empresa_id=?${filtro} ORDER BY ci.fecha ASC, ci.hora ASC`, params
  );
  res.json({ ok: true, citas: rows });
}));

app.post('/api/citas', verificarToken, requireRoles('propietario', 'recepcion', 'veterinario'), ah(async (req, res) => {
  const { cliente_id, paciente_id, veterinario_id, fecha, hora, motivo, notas } = req.body || {};
  if (!fecha) return res.status(400).json({ ok: false, error: 'La fecha es obligatoria' });
  // Si lo crea un veterinario, la cita queda asignada a él
  const vetId = req.user.rol === 'veterinario' ? req.user.id : await vetValido(veterinario_id, req.user.empresa_id);
  if (vetId === false) return res.status(400).json({ ok: false, error: 'Veterinario no válido' });
  const [result] = await pool.query(
    `INSERT INTO citas (empresa_id, cliente_id, paciente_id, veterinario_id, fecha, hora, motivo, notas) VALUES (?,?,?,?,?,?,?,?)`,
    [req.user.empresa_id, cliente_id || null, paciente_id || null, vetId, fecha, hora || null, motivo || '', notas || '']
  );
  res.json({ ok: true, id: result.insertId });
}));

app.put('/api/citas/:id', verificarToken, requireRoles('propietario', 'recepcion'), ah(async (req, res) => {
  const { fecha, hora, motivo, notas, estado, veterinario_id } = req.body || {};
  const vetId = await vetValido(veterinario_id, req.user.empresa_id);
  if (vetId === false) return res.status(400).json({ ok: false, error: 'Veterinario no válido' });
  await pool.query(
    `UPDATE citas SET fecha=COALESCE(?,fecha), hora=COALESCE(?,hora), motivo=COALESCE(?,motivo), notas=COALESCE(?,notas),
       estado=COALESCE(?,estado), veterinario_id=COALESCE(?,veterinario_id)
     WHERE id=? AND empresa_id=?`,
    [fecha ?? null, hora ?? null, motivo ?? null, notas ?? null, estado ?? null, vetId, req.params.id, req.user.empresa_id]
  );
  res.json({ ok: true });
}));


// El veterinario inicia / finaliza SU cita: pendiente → en proceso (atendiendo) → finalizado (atendida)
// También sincroniza la atención vinculada (consulta → cerrada)
app.put('/api/citas/:id/estado', verificarToken, requireRoles('propietario', 'veterinario'), ah(async (req, res) => {
  const { estado } = req.body || {};
  if (!['atendiendo', 'atendida'].includes(estado)) return res.status(400).json({ ok: false, error: 'Estado inválido' });

  const eid = req.user.empresa_id;
  const params = [req.params.id, eid];
  let filtro = '';
  if (req.user.rol === 'veterinario') { filtro = ' AND veterinario_id=?'; params.push(req.user.id); }
  const [rows] = await pool.query(`SELECT * FROM citas WHERE id=? AND empresa_id=?${filtro}`, params);
  const cita = rows[0];
  if (!cita) return res.status(404).json({ ok: false, error: 'Cita no encontrada' });
  if (['cancelada', 'no_asistio'].includes(cita.estado)) {
    return res.status(400).json({ ok: false, error: 'No se puede cambiar una cita cancelada' });
  }

  await pool.query('UPDATE citas SET estado=? WHERE id=?', [estado, cita.id]);

  // Conexión con Atenciones
  if (cita.paciente_id && cita.cliente_id) {
    const [at] = await pool.query(
      'SELECT id FROM atenciones WHERE cita_id=? AND empresa_id=? ORDER BY id DESC LIMIT 1', [cita.id, eid]);
    const estadoAt = estado === 'atendiendo' ? 'consulta' : 'cerrada';
    if (at.length) {
      await pool.query('UPDATE atenciones SET estado=? WHERE id=?', [estadoAt, at[0].id]);
    } else if (estado === 'atendiendo') {
      await pool.query(
        `INSERT INTO atenciones (empresa_id, staff_id, veterinario_id, paciente_id, cliente_id, cita_id, origen, prioridad, estado)
         VALUES (?,?,?,?,?,?, 'con_cita', 'normal', 'consulta')`,
        [eid, req.user.id, cita.veterinario_id || req.user.id, cita.paciente_id, cita.cliente_id, cita.id]);
    }
  }
  res.json({ ok: true });
}));


app.delete('/api/citas/:id', verificarToken, requireRoles('propietario', 'recepcion'), ah(async (req, res) => {
  await pool.query('DELETE FROM citas WHERE id=? AND empresa_id=?', [req.params.id, req.user.empresa_id]);
  res.json({ ok: true });
}));

// ── Búsqueda global ─────────────────────────────────────────
app.get('/api/buscar', verificarToken, requireEmpresa, ah(async (req, res) => {
  const term = (req.query.q || '').trim();
  if (!term) return res.json({ ok: true, clientes: [], pacientes: [] });
  const like = `%${term}%`;
  const [clientes] = await pool.query(
    `SELECT id, nombre, telefono FROM clientes WHERE empresa_id=? AND (nombre LIKE ? OR telefono LIKE ?) LIMIT 6`,
    [req.user.empresa_id, like, like]
  );
  const [pacientes] = await pool.query(
    `SELECT pa.id, pa.nombre, pa.especie, c.nombre AS cliente_nombre
     FROM pacientes pa JOIN clientes c ON c.id = pa.cliente_id
     WHERE pa.empresa_id=? AND pa.nombre LIKE ? LIMIT 6`,
    [req.user.empresa_id, like]
  );
  res.json({ ok: true, clientes, pacientes });
}));

// ══════════════════════════════════════════════════════════════
// HISTORIA CLÍNICA — propietario y veterinario escriben.
// Recepción solo consulta y NO ve diagnóstico, tratamiento ni medicamentos.
// ══════════════════════════════════════════════════════════════
app.get('/api/historias/:paciente_id', verificarToken, requireRoles('propietario', 'veterinario', 'recepcion'), ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM historias WHERE paciente_id=? AND empresa_id=? ORDER BY fecha DESC, id DESC`,
    [req.params.paciente_id, req.user.empresa_id]
  );
  const historias = req.user.rol === 'recepcion'
    ? rows.map(h => ({ ...h, diagnostico: '', tratamiento: '', medicamentos: '' }))
    : rows;
  res.json({ ok: true, historias });
}));

app.post('/api/historias', verificarToken, requireRoles('propietario', 'veterinario'), ah(async (req, res) => {
  const { paciente_id, fecha, motivo, anamnesis, peso, temperatura, fc, fr, diagnostico, tratamiento, medicamentos, recomendaciones, proximo_control } = req.body || {};
  if (!paciente_id || !fecha) return res.status(400).json({ ok: false, error: 'Paciente y fecha son obligatorios' });
  const [result] = await pool.query(
    `INSERT INTO historias (empresa_id, paciente_id, fecha, motivo, anamnesis, peso, temperatura, fc, fr, diagnostico, tratamiento, medicamentos, recomendaciones, proximo_control)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [req.user.empresa_id, paciente_id, fecha, motivo || '', anamnesis || '', peso || null, temperatura || null,
     fc || '', fr || '', diagnostico || '', tratamiento || '', medicamentos || '', recomendaciones || '', proximo_control || null]
  );
  res.json({ ok: true, id: result.insertId });
}));

app.delete('/api/historias/:id', verificarToken, requireRoles('propietario', 'veterinario'), ah(async (req, res) => {
  await pool.query('DELETE FROM historias WHERE id=? AND empresa_id=?', [req.params.id, req.user.empresa_id]);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════
// INVENTARIO — propietario y recepción crean/editan; veterinario consulta; borrar: propietario
// ══════════════════════════════════════════════════════════════
app.get('/api/productos', verificarToken, requireRoles('propietario', 'recepcion', 'veterinario'), ah(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM productos WHERE empresa_id=? ORDER BY nombre ASC', [req.user.empresa_id]);
  res.json({ ok: true, productos: rows });
}));
app.post('/api/productos', verificarToken, requireRoles('propietario', 'recepcion'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const d = datosProducto(req.body || {});
    if (!d.nombre) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio' });
    const inicial = parseInt((req.body || {}).stock_inicial) || 0;
    const eid = req.user.empresa_id;
    await conn.beginTransaction();
    const [r] = await conn.query('INSERT INTO productos SET ?', [{ ...d, empresa_id: eid, stock: 0 }]);
    if (inicial > 0) {
      const alm = await almacenPrincipal(conn, eid);
      await moverStock(conn, { empresaId: eid, productoId: r.insertId, almacenId: alm, delta: inicial, tipo: 'carga', motivo: 'Stock inicial', usuarioId: req.user.id });
    }
    await conn.commit();
    res.json({ ok: true, id: r.insertId });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ ok: false, error: e.message });
  } finally { conn.release(); }
});

// El stock NO se edita aquí: se cambia con cargar/descargar stock
app.put('/api/productos/:id', verificarToken, requireRoles('propietario', 'recepcion'), ah(async (req, res) => {
  const d = datosProducto(req.body || {});
  if (!d.nombre) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio' });
  await pool.query('UPDATE productos SET ? WHERE id=? AND empresa_id=?', [d, req.params.id, req.user.empresa_id]);
  res.json({ ok: true });
}));

app.delete('/api/productos/:id', verificarToken, requireRoles('propietario'), ah(async (req, res) => {
  await pool.query('DELETE FROM stock_almacen WHERE producto_id=? AND empresa_id=?', [req.params.id, req.user.empresa_id]);
  await pool.query('DELETE FROM productos WHERE id=? AND empresa_id=?', [req.params.id, req.user.empresa_id]);
  res.json({ ok: true });
}));

app.get('/api/productos/:id/kardex', verificarToken, requireRoles('propietario', 'recepcion', 'veterinario'), ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT m.*, a.nombre AS almacen_nombre, u.nombre AS usuario_nombre
     FROM movimientos_stock m
     LEFT JOIN almacenes a ON a.id = m.almacen_id
     LEFT JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.producto_id=? AND m.empresa_id=? ORDER BY m.id DESC LIMIT 200`,
    [req.params.id, req.user.empresa_id]);
  res.json({ ok: true, movimientos: rows });
}));

// ── ALMACENES ────────────────────────────────────────────────
app.get('/api/almacenes', verificarToken, requireEmpresa, ah(async (req, res) => {
  await almacenPrincipal(pool, req.user.empresa_id);
  const [rows] = await pool.query('SELECT id, nombre, es_principal FROM almacenes WHERE empresa_id=? ORDER BY es_principal DESC, nombre', [req.user.empresa_id]);
  res.json({ ok: true, almacenes: rows });
}));

app.post('/api/almacenes', verificarToken, requireRoles('propietario'), ah(async (req, res) => {
  const nombre = String((req.body || {}).nombre || '').trim();
  if (!nombre) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio' });
  const [r] = await pool.query('INSERT INTO almacenes (empresa_id, nombre) VALUES (?,?)', [req.user.empresa_id, nombre]);
  res.json({ ok: true, id: r.insertId });
}));

// Stock por almacén: cada producto × cada almacén (con 0 si no hay)
app.get('/api/stock-almacen', verificarToken, requireRoles('propietario', 'recepcion', 'veterinario'), ah(async (req, res) => {
  const eid = req.user.empresa_id;
  await almacenPrincipal(pool, eid);
  const [rows] = await pool.query(
    `SELECT p.id AS producto_id, p.nombre, p.precio_compra, p.precio_venta,
            a.id AS almacen_id, a.nombre AS almacen, COALESCE(sa.stock,0) AS stock
     FROM productos p
     JOIN almacenes a ON a.empresa_id = p.empresa_id
     LEFT JOIN stock_almacen sa ON sa.producto_id = p.id AND sa.almacen_id = a.id
     WHERE p.empresa_id=? ORDER BY p.nombre, a.es_principal DESC, a.id`, [eid]);
  res.json({ ok: true, filas: rows });
}));

// ── CARGAS / DESCARGAS DE STOCK ──────────────────────────────
app.get('/api/stock-documentos', verificarToken, requireRoles('propietario', 'recepcion'), ah(async (req, res) => {
  const tipo = req.query.tipo === 'descarga' ? 'descarga' : 'carga';
  const [rows] = await pool.query(
    `SELECT d.id, d.numero, d.tipo, d.motivo, d.tipo_operacion, d.responsable, d.total, d.created_at,
            a.nombre AS almacen_nombre, u.nombre AS registrado_por
     FROM stock_documentos d
     LEFT JOIN almacenes a ON a.id = d.almacen_id
     LEFT JOIN usuarios u ON u.id = d.usuario_id
     WHERE d.empresa_id=? AND d.tipo=? ORDER BY d.id DESC LIMIT 200`, [req.user.empresa_id, tipo]);
  res.json({ ok: true, documentos: rows });
}));

app.get('/api/stock-documentos/:id', verificarToken, requireRoles('propietario', 'recepcion'), ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT d.*, a.nombre AS almacen_nombre, u.nombre AS registrado_por
     FROM stock_documentos d
     LEFT JOIN almacenes a ON a.id = d.almacen_id
     LEFT JOIN usuarios u ON u.id = d.usuario_id
     WHERE d.id=? AND d.empresa_id=?`, [req.params.id, req.user.empresa_id]);
  if (!rows[0]) return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
  let items = [];
  try { items = typeof rows[0].items_json === 'string' ? JSON.parse(rows[0].items_json) : (rows[0].items_json || []); } catch (e) {}
  res.json({ ok: true, documento: { ...rows[0], items_json: undefined, items } });
}));

app.post('/api/stock-documentos', verificarToken, requireRoles('propietario', 'recepcion'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const eid = req.user.empresa_id;
    const { tipo, almacen_id, motivo, tipo_operacion, responsable, items } = req.body || {};
    if (!['carga', 'descarga'].includes(tipo)) return res.status(400).json({ ok: false, error: 'Tipo inválido' });
    if (!String(motivo || '').trim()) return res.status(400).json({ ok: false, error: 'El motivo es obligatorio' });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ ok: false, error: 'Agrega al menos un producto' });
    const [alm] = await conn.query('SELECT id FROM almacenes WHERE id=? AND empresa_id=?', [almacen_id, eid]);
    if (!alm.length) return res.status(400).json({ ok: false, error: 'Almacén no válido' });

    await conn.beginTransaction();
    const [[{ n }]] = await conn.query('SELECT COALESCE(MAX(numero),0)+1 AS n FROM stock_documentos WHERE empresa_id=? AND tipo=?', [eid, tipo]);
    const [ins] = await conn.query(
      `INSERT INTO stock_documentos (empresa_id, numero, tipo, almacen_id, motivo, tipo_operacion, responsable, usuario_id, items_json, total)
       VALUES (?,?,?,?,?,?,?,?,'[]',0)`,
      [eid, n, tipo, almacen_id, String(motivo).trim(), tipo_operacion || '', responsable || '', req.user.id]);
    const docId = ins.insertId;

    const detalle = []; let total = 0;
    for (const it of items) {
      const cant = parseInt(it.cantidad);
      if (!cant || cant < 1) throw new Error('Cantidad inválida');
      const [[p]] = await conn.query('SELECT * FROM productos WHERE id=? AND empresa_id=?', [it.producto_id, eid]);
      if (!p) throw new Error('Producto no encontrado');
      let pc = Number(p.precio_compra), pv = Number(p.precio_venta);
      if (tipo === 'carga') {
        if (it.precio_compra !== undefined && it.precio_compra !== '') pc = Number(it.precio_compra) || 0;
        if (it.precio_venta !== undefined && it.precio_venta !== '') pv = Number(it.precio_venta) || 0;
        await conn.query('UPDATE productos SET precio_compra=?, precio_venta=? WHERE id=? AND empresa_id=?', [pc, pv, p.id, eid]);
      }
      await moverStock(conn, {
        empresaId: eid, productoId: p.id, almacenId: almacen_id, delta: tipo === 'carga' ? cant : -cant,
        tipo, motivo: String(motivo).trim(), usuarioId: req.user.id, docId
      });
      detalle.push({ producto_id: p.id, codigo_barras: p.codigo_barras, nombre: p.nombre, precio_compra: pc, precio_venta: pv, cantidad: cant });
      total += pc * cant;
    }
    await conn.query('UPDATE stock_documentos SET items_json=?, total=? WHERE id=?', [JSON.stringify(detalle), total, docId]);
    await conn.commit();
    res.json({ ok: true, id: docId, numero: n });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ ok: false, error: e.message });
  } finally { conn.release(); }
});

// ══════════════════════════════════════════════════════════════
// VENTAS / COBROS — los 3 roles crean y consultan; borrar: propietario y recepción
// ══════════════════════════════════════════════════════════════
app.get('/api/ventas', verificarToken, requireRoles('propietario', 'recepcion', 'veterinario'), ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT v.*, c.nombre AS cliente_nombre, pa.nombre AS paciente_nombre
     FROM ventas v
     LEFT JOIN clientes c ON c.id = v.cliente_id
     LEFT JOIN pacientes pa ON pa.id = v.paciente_id
     WHERE v.empresa_id=? ORDER BY v.id DESC`, [req.user.empresa_id]
  );
  res.json({ ok: true, ventas: rows });
}));

app.post('/api/ventas', verificarToken, requireRoles('propietario', 'recepcion', 'veterinario'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { cliente_id, paciente_id, items, descuento, metodo_pago, estado_pago } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ ok: false, error: 'Agrega al menos un producto o servicio' });

    await conn.beginTransaction();
    let subtotal = 0;
    for (const item of items) {
      subtotal += Number(item.precio) * Number(item.cantidad || 1);
      if (item.producto_id) {
        await descontarVenta(conn, req.user.empresa_id, item.producto_id, Number(item.cantidad || 1), req.user.id);
      }
    }
    const total = Math.max(subtotal - Number(descuento || 0), 0);
    const estado = estado_pago === 'pendiente' ? 'pendiente' : 'pagado';
    const [result] = await conn.query(
      `INSERT INTO ventas (empresa_id, cliente_id, paciente_id, items_json, subtotal, descuento, total, metodo_pago, estado_pago)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [req.user.empresa_id, cliente_id || null, paciente_id || null, JSON.stringify(items),
       subtotal, descuento || 0, total, metodo_pago || 'efectivo', estado]
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

// "Registrar pago" de una venta que quedó pendiente
app.put('/api/ventas/:id/pago', verificarToken, requireRoles('propietario', 'recepcion', 'veterinario'), ah(async (req, res) => {
  const metodo = (req.body || {}).metodo_pago;
  await pool.query(
    `UPDATE ventas SET estado_pago='pagado', metodo_pago=COALESCE(?, metodo_pago) WHERE id=? AND empresa_id=?`,
    [metodo || null, req.params.id, req.user.empresa_id]
  );
  res.json({ ok: true });
}));

app.delete('/api/ventas/:id', verificarToken, requireRoles('propietario', 'recepcion'), ah(async (req, res) => {
  await pool.query('DELETE FROM ventas WHERE id=? AND empresa_id=?', [req.params.id, req.user.empresa_id]);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════
// FINANZAS / CAJA — propietario ve el rango completo; veterinario y recepción, solo hoy y totales
// ══════════════════════════════════════════════════════════════
app.get('/api/caja', verificarToken, requireEmpresa, ah(async (req, res) => {
  const { desde, hasta, limitado } = await resolverRango(req);
  const eid = req.user.empresa_id;
  const base = `FROM ventas WHERE empresa_id=? AND DATE(created_at) BETWEEN ? AND ?`;
  const [porMetodo] = await pool.query(
    `SELECT metodo_pago AS metodo, COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS total ${base} AND estado_pago='pagado' GROUP BY metodo_pago`,
    [eid, desde, hasta]
  );
  const [[pendiente]] = await pool.query(
    `SELECT COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS total ${base} AND estado_pago<>'pagado'`,
    [eid, desde, hasta]
  );
  let porDia = [];
  if (!limitado) {
    [porDia] = await pool.query(
      `SELECT DATE_FORMAT(created_at,'%Y-%m-%d') AS dia, COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS total
       ${base} AND estado_pago='pagado' GROUP BY DATE_FORMAT(created_at,'%Y-%m-%d') ORDER BY dia`,
      [eid, desde, hasta]
    );
  }
  const total = porMetodo.reduce((a, m) => a + Number(m.total || 0), 0);
  const cantidad = porMetodo.reduce((a, m) => a + Number(m.cantidad || 0), 0);
  res.json({ ok: true, desde, hasta, limitado, total, cantidad, porMetodo, pendiente, porDia });
}));

// ══════════════════════════════════════════════════════════════
// REPORTES — propietario ve el rango completo con extras; veterinario y recepción, solo hoy
// (el veterinario solo cuenta lo suyo)
// ══════════════════════════════════════════════════════════════
app.get('/api/reportes', verificarToken, requireEmpresa, ah(async (req, res) => {
  const { desde, hasta, limitado } = await resolverRango(req);
  const eid = req.user.empresa_id;
  const esVet = req.user.rol === 'veterinario';

  const pCitas = [eid, desde, hasta]; let fCitas = '';
  const pAt = [eid, desde, hasta]; let fAt = '';
  if (esVet) { fCitas = ' AND veterinario_id=?'; pCitas.push(req.user.id); fAt = ' AND veterinario_id=?'; pAt.push(req.user.id); }

  const [citasPorEstado] = await pool.query(
    `SELECT estado, COUNT(*) AS total FROM citas WHERE empresa_id=? AND fecha BETWEEN ? AND ?${fCitas} GROUP BY estado`, pCitas
  );
  const [atencionesPorEstado] = await pool.query(
    `SELECT estado, COUNT(*) AS total FROM atenciones WHERE empresa_id=? AND DATE(created_at) BETWEEN ? AND ?${fAt} GROUP BY estado`, pAt
  );

  const out = { ok: true, desde, hasta, limitado, citasPorEstado, atencionesPorEstado };

  if (!limitado) {
    const [[{ consultas }]] = await pool.query(
      `SELECT COUNT(*) AS consultas FROM historias WHERE empresa_id=? AND fecha BETWEEN ? AND ?`, [eid, desde, hasta]
    );
    const [porVeterinario] = await pool.query(
      `SELECT v.nombre AS veterinario, COUNT(*) AS total
       FROM atenciones a JOIN usuarios v ON v.id=a.veterinario_id
       WHERE a.empresa_id=? AND DATE(a.created_at) BETWEEN ? AND ? GROUP BY a.veterinario_id, v.nombre ORDER BY total DESC`,
      [eid, desde, hasta]
    );
    const [ventas] = await pool.query(
      `SELECT items_json FROM ventas WHERE empresa_id=? AND DATE(created_at) BETWEEN ? AND ? AND estado_pago='pagado' LIMIT 5000`,
      [eid, desde, hasta]
    );
    const mapa = {};
    for (const v of ventas) {
      let items = [];
      try { items = typeof v.items_json === 'string' ? JSON.parse(v.items_json) : (v.items_json || []); } catch (e) { items = []; }
      for (const it of items) {
        const k = it.nombre || '—';
        mapa[k] = mapa[k] || { nombre: k, cantidad: 0, total: 0 };
        mapa[k].cantidad += Number(it.cantidad || 1);
        mapa[k].total += Number(it.precio || 0) * Number(it.cantidad || 1);
      }
    }
    out.consultas = Number(consultas || 0);
    out.porVeterinario = porVeterinario;
    out.topProductos = Object.values(mapa).sort((a, b) => b.total - a.total).slice(0, 8);
  }
  res.json(out);
}));

// ══════════════════════════════════════════════════════════════
// DASHBOARD RESUMEN — solo propietario (el veterinario y recepción arman su inicio con citas, atenciones y caja)
// ══════════════════════════════════════════════════════════════
app.get('/api/resumen', verificarToken, requireRoles('propietario'), ah(async (req, res) => {
  const eid = req.user.empresa_id;
  const [[{ totalClientes }]] = await pool.query('SELECT COUNT(*) AS totalClientes FROM clientes WHERE empresa_id=?', [eid]);
  const [[{ totalPacientes }]] = await pool.query('SELECT COUNT(*) AS totalPacientes FROM pacientes WHERE empresa_id=?', [eid]);
  const [[{ citasHoy }]] = await pool.query('SELECT COUNT(*) AS citasHoy FROM citas WHERE empresa_id=? AND fecha=CURDATE()', [eid]);
  const [[{ enEspera }]] = await pool.query(`SELECT COUNT(*) AS enEspera FROM atenciones WHERE empresa_id=? AND estado IN ('llegada','triaje','espera')`, [eid]);
  const [[{ ventasMes }]] = await pool.query(
    `SELECT COALESCE(SUM(total),0) AS ventasMes FROM ventas WHERE empresa_id=? AND MONTH(created_at)=MONTH(CURDATE()) AND YEAR(created_at)=YEAR(CURDATE())`, [eid]
  );
  const [[{ ventasHoy }]] = await pool.query(`SELECT COALESCE(SUM(total),0) AS ventasHoy FROM ventas WHERE empresa_id=? AND DATE(created_at)=CURDATE()`, [eid]);
  const [[{ stockBajo }]] = await pool.query('SELECT COUNT(*) AS stockBajo FROM productos WHERE empresa_id=? AND stock <= stock_minimo', [eid]);
  const [proximasCitas] = await pool.query(
    `SELECT ci.*, c.nombre AS cliente_nombre, pa.nombre AS paciente_nombre
     FROM citas ci LEFT JOIN clientes c ON c.id=ci.cliente_id LEFT JOIN pacientes pa ON pa.id=ci.paciente_id
     WHERE ci.empresa_id=? AND ci.fecha=CURDATE() AND ci.estado NOT IN ('cancelada','atendida')
     ORDER BY ci.hora ASC LIMIT 6`, [eid]
  );
  const alertas = Number(stockBajo);
  res.json({ ok: true, totalClientes, totalPacientes, citasHoy, enEspera, ventasMes, ventasHoy, stockBajo, alertas, proximasCitas });
}));

// ── Salud del servicio ───────────────────────────────────────
app.get('/', (req, res) => res.json({ ok: true, servicio: 'Vetcore API' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🐾 Vetcore API corriendo en el puerto ${PORT}`));
