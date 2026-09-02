/* eslint-disable no-console */
// Seed sumber playlist awal (idempotent). Fokus Indonesia:
//   1. Kurasi lokal (index.m3u yang sudah ada) — priority tertinggi (menang dedup)
//   2. iptv-org Indonesia — menambah channel ID lain
// Pemakaian: npm run seed-sources
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const sourceRepo = require('../src/repositories/sourceRepository');

const SOURCES = [
  // Indonesia (priority kecil = didahulukan saat dedup)
  { name: 'Kurasi Lokal (index.m3u)', url: 'file:data/index.m3u', type: 'm3u_file', countryCode: 'ID', priority: 1 },
  { name: 'iptv-org Indonesia', url: 'https://iptv-org.github.io/iptv/countries/id.m3u', type: 'm3u_url', countryCode: 'ID', priority: 100 },
  // Korea (channel Korea muncul juga)
  { name: 'iptv-org Korea', url: 'https://iptv-org.github.io/iptv/countries/kr.m3u', type: 'm3u_url', countryCode: 'KR', priority: 120 },
  // Semua channel dari iptv-org & Free-TV (country_code null → ambil semua negara,
  // negara diambil dari tag tvg-country tiap channel). Channel mati disaring health-check.
  { name: 'iptv-org Global (semua)', url: 'https://iptv-org.github.io/iptv/index.m3u', type: 'm3u_url', countryCode: null, priority: 200 },
  { name: 'Free-TV', url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8', type: 'm3u_url', countryCode: null, priority: 210 },
];

(async () => {
  for (const s of SOURCES) {
    const row = await sourceRepo.upsert(s);
    console.log(`[Seed] Sumber siap: #${row.id} ${row.name} (${row.url})`);
  }
  console.log('[Seed] Selesai.');
  process.exit(0);
})().catch(err => { console.error('[Seed] GAGAL:', err.message); process.exit(1); });
