/* eslint-disable no-console */
const cron = require('node-cron');
const { importAll } = require('./services/importer');
const { checkAll, pruneLogs } = require('./services/healthChecker');

const CHECK_CRON  = process.env.CHECK_CRON  || '*/30 * * * *'; // tiap 30 menit
const IMPORT_CRON = process.env.IMPORT_CRON || '0 */6 * * *';  // tiap 6 jam
const RUN_ON_START = String(process.env.RUN_ON_START || 'true') === 'true';

let running = { import: false, check: false };

async function safeImport() {
  if (running.import) return;
  running.import = true;
  try { await importAll(); } catch (e) { console.error('[Scheduler] import error:', e.message); }
  finally { running.import = false; }
}

async function safeCheck() {
  if (running.check) return;
  running.check = true;
  try { await checkAll({ limit: 5000 }); await pruneLogs(); }
  catch (e) { console.error('[Scheduler] check error:', e.message); }
  finally { running.check = false; }
}

function start() {
  cron.schedule(IMPORT_CRON, safeImport);
  cron.schedule(CHECK_CRON, safeCheck);
  console.log(`[Scheduler] import cron="${IMPORT_CRON}", check cron="${CHECK_CRON}".`);

  if (RUN_ON_START) {
    // Catch-up: import dulu (30s), lalu check (90s) — ditunda agar server siap.
    setTimeout(() => { safeImport().then(() => safeCheck()); }, 30 * 1000);
    console.log('[Scheduler] catch-up import+check dijadwalkan ~30s setelah start.');
  }
}

module.exports = { start, safeImport, safeCheck };
