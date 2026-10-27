/* eslint-disable no-console */
// Jalankan import semua sumber sekali (CLI). Pemakaian: npm run import
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { importAll } = require('../src/services/importer');
const channelRepo = require('../src/repositories/channelRepository');

(async () => {
  const r = await importAll();
  const stat = await channelRepo.countByStatus();
  console.log('[Import] Selesai:', JSON.stringify(r.results));
  console.log('[Import] Total channel di DB:', stat.total, '| status:', JSON.stringify(stat));
  process.exit(0);
})().catch(err => { console.error('[Import] GAGAL:', err.message); process.exit(1); });
