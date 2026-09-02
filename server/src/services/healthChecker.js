const channelRepo = require('../repositories/channelRepository');
const { q } = require('../config/db');

const TIMEOUT_MS     = parseInt(process.env.CHECK_TIMEOUT_MS, 10) || 8000;
const CONCURRENCY    = parseInt(process.env.CHECK_CONCURRENCY, 10) || 20;
const FAIL_THRESHOLD = parseInt(process.env.CHECK_FAIL_THRESHOLD, 10) || 2;

const UA = 'Mozilla/5.0 (compatible; IPTV-HealthChecker/1.0)';

// Cek satu URL stream via HTTP. "hidup" = manifest/stream reachable (2xx) dan,
// bila terbaca, berisi penanda HLS (#EXTM3U) atau content-type media.
async function checkOne(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Range: 'bytes=0-4095', Accept: '*/*' },
    });
    const latencyMs = Date.now() - start;
    const httpStatus = res.status;
    const ct = (res.headers.get('content-type') || '').toLowerCase();

    if (!res.ok && res.status !== 206) {
      try { await res.body?.cancel(); } catch (_) {}
      return { ok: false, httpStatus, latencyMs };
    }

    // Content-type media/manifest → reachable, tak perlu baca body.
    if (/mpegurl|mpeg-url|octet-stream|mp2t|video\//.test(ct)) {
      try { await res.body?.cancel(); } catch (_) {}
      return { ok: true, httpStatus, latencyMs };
    }

    // Selain itu, baca potongan awal untuk cari penanda HLS.
    const text = (await res.text()).slice(0, 1024);
    const ok = text.includes('#EXTM3U') || text.includes('#EXTINF') || res.ok;
    return { ok, httpStatus, latencyMs };
  } catch (err) {
    return { ok: false, httpStatus: null, latencyMs: Date.now() - start, error: err.message };
  } finally {
    clearTimeout(timer);
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
