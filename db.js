const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'vetcore',
  waitForConnections: true,
  connectionLimit: 3,
  maxIdle: 2,
  idleTimeout: 30000,
  queueLimit: 0,
  timezone: 'Z',
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 20000,
});

module.exports = pool;