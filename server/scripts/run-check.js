/* eslint-disable no-console */
// Jalankan health-check sekali (CLI). Pemakaian: npm run check
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { checkAll } = require('../src/services/healthChecker');
const channelRepo = require('../src/repositories/channelRepository');

(async () => {
  const r = await checkAll({ limit: 5000 });
  const stat = await channelRepo.countByStatus();
  console.log('[Check] Hasil:', JSON.stringify(r));
  console.log('[Check] Status katalog:', JSON.stringify(stat));
  process.exit(0);
})().catch(err => { console.error('[Check] GAGAL:', err.message); process.exit(1); });
