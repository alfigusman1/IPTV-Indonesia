const channelRepo = require('../repositories/channelRepository');
const { q } = require('../config/db');

const TIMEOUT_MS     = parseInt(process.env.CHECK_TIMEOUT_MS, 10) || 8000;
const CONCURRENCY    = parseInt(process.env.CHECK_CONCURRENCY, 10) || 20;
const FAIL_THRESHOLD = parseInt(process.env.CHECK_FAIL_THRESHOLD, 10) || 2;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Ambil teks (untuk manifest .m3u8). Return { res, text }.
async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': UA, Accept: '*/*' } });
    const text = res.ok ? await res.text() : null;
    return { res, text };
  } finally { clearTimeout(timer); }
}

// Cek satu URL benar-benar terjangkau (2xx/206). Untuk segmen/media (bukan manifest).
async function reachable(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': UA, Range: 'bytes=0-2047', Accept: '*/*' } });
    try { await res.body?.cancel(); } catch (_) {}
    return { ok: res.ok || res.status === 206, status: res.status };
  } catch (_) {
    return { ok: false, status: null };
  } finally { clearTimeout(timer); }
}

const firstUrlLine = (text) =>
  text.split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith('#')) || null;

// Cek "hidup" secara BERLAPIS untuk HLS (menghindari false-positive seperti "Indosiar 2":
// manifest 200 tapi segmen mati). manifest → variant (bila master playlist) → SEGMEN
// benar-benar terjangkau. Non-HLS: cek reachability langsung.
async function checkOne(url) {
  const start = Date.now();
  const isHls = /\.m3u8(\?|$)/i.test(url) || /\/m3u8/i.test(url);
  try {
    if (!isHls) {
      const r = await reachable(url);
      return { ok: r.ok, httpStatus: r.status, latencyMs: Date.now() - start };
    }

    // Lapis 1: manifest
    const m = await fetchText(url);
    if (!m.res.ok || !m.text || !m.text.includes('#EXTM3U')) {
      return { ok: false, httpStatus: m.res.status, latencyMs: Date.now() - start };
    }
    let firstUrl = firstUrlLine(m.text);
    if (!firstUrl) return { ok: false, httpStatus: m.res.status, latencyMs: Date.now() - start }; // manifest kosong

    let mediaUrl = new URL(firstUrl, url).toString();

    // Lapis 2: bila master playlist (variant .m3u8), ambil variant → cari segmen.
    if (/\.m3u8(\?|$)/i.test(mediaUrl) || /#EXT-X-STREAM-INF/i.test(m.text)) {
      const v = await fetchText(mediaUrl);
      if (!v.res.ok || !v.text || !v.text.includes('#EXTM3U')) {
        return { ok: false, httpStatus: v.res.status, latencyMs: Date.now() - start };
      }
      const seg = firstUrlLine(v.text);
      if (!seg) return { ok: false, httpStatus: v.res.status, latencyMs: Date.now() - start };
      mediaUrl = new URL(seg, mediaUrl).toString();
    }

    // Lapis 3: segmen benar-benar terjangkau?
    const r = await reachable(mediaUrl);
    return { ok: r.ok, httpStatus: m.res.status, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, httpStatus: null, latencyMs: Date.now() - start, error: err.message };
  }
}

// Worker pool sederhana untuk membatasi konkurensi.
async function runPool(items, worker, concurrency) {
  let idx = 0;
  const results = [];
  async function run() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

// Cek sekumpulan channel & update status di DB. limit = maks channel per putaran.
async function checkAll({ limit = 1000 } = {}) {
  const channels = await channelRepo.getForCheck(limit);
  if (!channels.length) return { checked: 0, active: 0, dead: 0 };

  let active = 0, dead = 0;
  await runPool(channels, async (ch) => {
    const r = await checkOne(ch.stream_url);
    await channelRepo.applyCheckResult(ch.id, r, FAIL_THRESHOLD);
    // log ringkas (fire-and-forget)
    q('INSERT INTO iptv_check_logs (channel_id,status,http_status,latency_ms,message) VALUES (?,?,?,?,?)',
      [ch.id, r.ok ? 'ok' : 'fail', r.httpStatus ?? null, r.latencyMs ?? null, r.error ? String(r.error).slice(0, 250) : null])
      .catch(() => {});
    if (r.ok) active++; else dead++;
  }, CONCURRENCY);

  // eslint-disable-next-line no-console
  console.log(`[HealthCheck] ${channels.length} dicek → ${active} ok, ${dead} gagal.`);
  return { checked: channels.length, active, dead };
}

// Prune log lama (>7 hari) agar tabel tidak menumpuk.
async function pruneLogs() {
  await q('DELETE FROM iptv_check_logs WHERE checked_at < NOW() - INTERVAL 7 DAY').catch(() => {});
}

module.exports = { checkAll, checkOne, pruneLogs };
