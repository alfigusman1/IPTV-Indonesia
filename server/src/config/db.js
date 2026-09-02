const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'iptv',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'iptv',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

// Helper query ringkas: q(sql, params) → rows.
async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

module.exports = { pool, q };
