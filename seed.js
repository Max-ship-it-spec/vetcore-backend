// ══════════════════════════════════════════════════════════════
// Crea la cuenta ADMIN inicial de Vetcore (el super-admin que
// crea las cuentas de los clientes/clínicas y les asigna plan).
// Uso:  npm run seed
// ══════════════════════════════════════════════════════════════
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');

async function seed() {
  const email = process.env.ADMIN_EMAIL || 'admin@vetcore.com';
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';

  const [existe] = await pool.query('SELECT id FROM usuarios WHERE email=?', [email]);
  if (existe.length) {
    console.log(`⚠️  Ya existe una cuenta admin con el email ${email}. No se creó ninguna nueva.`);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO usuarios (rol, nombre, email, password_hash, activo)
     VALUES ('admin', 'Administrador Vetcore', ?, ?, 1)`,
    [email, hash]
  );

  console.log('✅ Cuenta admin creada correctamente:');
  console.log(`   Email:    ${email}`);
  console.log(`   Password: ${password}`);
  console.log('   Cámbiala luego de tu primer inicio de sesión.');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Error creando la cuenta admin:', err.message);
  process.exit(1);
});