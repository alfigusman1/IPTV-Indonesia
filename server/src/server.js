/* eslint-disable no-console */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const app = require('./app');
const scheduler = require('./scheduler');
const { pool } = require('./config/db');

const PORT = parseInt(process.env.PORT, 10) || 4300;

const server = app.listen(PORT, async () => {
  console.log(`
╔══════════════════════════════════════════╗
║            I P T V   S E R V E R           ║
╚══════════════════════════════════════════╝
  Port     : ${PORT}
  DB       : ${process.env.DB_USER}@${process.env.DB_HOST}/${process.env.DB_NAME}
  Env      : ${process.env.NODE_ENV || 'development'}
  API      : http://localhost:${PORT}/api/channels
  Health   : http://localhost:${PORT}/health
════════════════════════════════════════════`);
  // pastikan DB reachable
  try { await pool.query('SELECT 1'); console.log('[DB] Terhubung.'); }
  catch (e) { console.error('[DB] Gagal konek:', e.message); }
  scheduler.start();
});

const shutdown = (sig) => {
  console.log(`[Server] ${sig} — shutdown...`);
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 8000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
