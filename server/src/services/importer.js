const fs = require('fs');
const path = require('path');
const { parseM3U } = require('./m3uParser');
const sourceRepo = require('../repositories/sourceRepository');
const channelRepo = require('../repositories/channelRepository');

const FETCH_TIMEOUT_MS = 20000;

// Ambil isi M3U dari URL http(s) atau file lokal (url berawalan "file:").
async function fetchSourceContent(url) {
  if (url.startsWith('file:')) {
    const rel = url.slice('file:'.length);
    // relatif terhadap root server (tempat package.json) → aman di dalam image Docker.
    const abs = path.isAbsolute(rel) ? rel : path.join(__dirname, '..', '..', rel);
    return fs.readFileSync(abs, 'utf8');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Import satu sumber → jumlah channel yang di-upsert.
async function importSource(source) {
  const content = await fetchSourceContent(source.url);
  const channels = parseM3U(content, { defaultCountryCode: source.country_code });
  // Bila fokus Indonesia: sumber ber-country_code 'ID' hanya ambil channel ID
  // (iptv-org id.m3u sudah ID semua; ini jaring pengaman untuk sumber campuran).
  const filtered = source.country_code
    ? channels.filter(c => !c.country_code || c.country_code === source.country_code)
    : channels;
  const affected = await channelRepo.bulkUpsert(filtered, source.id);
  await sourceRepo.markImported(source.id, filtered.length, null);
  return { source: source.name, parsed: channels.length, imported: filtered.length, affected };
}

// Import SEMUA sumber enabled (urut priority — priority kecil menang saat dedup
// karena diimpor lebih dulu & source_id di-set pertama via COALESCE).
async function importAll() {
  const sources = await sourceRepo.getEnabled();
  const results = [];
  for (const source of sources) {
    try {
      const r = await importSource(source);
      results.push(r);
      // eslint-disable-next-line no-console
      console.log(`[Import] ${r.source}: parse ${r.parsed}, simpan ${r.imported}`);
    } catch (err) {
      await sourceRepo.markImported(source.id, 0, err.message).catch(() => {});
      results.push({ source: source.name, error: err.message });
      // eslint-disable-next-line no-console
      console.error(`[Import] ${source.name} GAGAL: ${err.message}`);
    }
  }
  const totalImported = results.reduce((s, r) => s + (r.imported || 0), 0);
  return { sources: sources.length, totalImported, results };
}

module.exports = { importAll, importSource, fetchSourceContent };
