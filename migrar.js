require('dotenv').config();
const pool = require('./db');

(async () => {
  try {
    await pool.query('ALTER TABLE productos ADD COLUMN foto_url VARCHAR(500) NULL');
    console.log('✅ Columna foto_url creada');
  } catch (e) {
    console.log('❌', e.message);
  }
  process.exit();
})();
