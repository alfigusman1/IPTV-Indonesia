/* eslint-disable no-console */
// Terapkan scripts/schema.sql ke DB iptv (idempotent — semua CREATE TABLE IF NOT EXISTS).
// Pemakaian: npm run migrate
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME,
    multipleStatements: true,
  });
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(sql);
  const [t] = await conn.query('SHOW TABLES');
  console.log('[Migrate] OK. Tabel:', t.map(r => Object.values(r)[0]).join(', '));
  await conn.end();
})().catch(err => { console.error('[Migrate] GAGAL:', err.message); process.exit(1); });
