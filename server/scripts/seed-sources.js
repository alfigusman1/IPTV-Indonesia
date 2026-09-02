/* eslint-disable no-console */
// Seed sumber playlist awal (idempotent). Fokus Indonesia:
//   1. Kurasi lokal (index.m3u yang sudah ada) — priority tertinggi (menang dedup)
//   2. iptv-org Indonesia — menambah channel ID lain
// Pemakaian: npm run seed-sources
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const sourceRepo = require('../src/repositories/sourceRepository');

const SOURCES = [
  { name: 'Kurasi Lokal (index.m3u)', url: 'file:data/index.m3u', type: 'm3u_file', countryCode: 'ID', priority: 1 },
  { name: 'iptv-org Indonesia', url: 'https://iptv-org.github.io/iptv/countries/id.m3u', type: 'm3u_url', countryCode: 'ID', priority: 100 },
];

(async () => {
  for (const s of SOURCES) {
    const row = await sourceRepo.upsert(s);
    console.log(`[Seed] Sumber siap: #${row.id} ${row.name} (${row.url})`);
  }
  console.log('[Seed] Selesai.');
  process.exit(0);
})().catch(err => { console.error('[Seed] GAGAL:', err.message); process.exit(1); });
