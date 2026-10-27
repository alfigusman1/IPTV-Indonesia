const router = require('express').Router();
const { Readable } = require('stream');
const dns = require('dns').promises;

// Stream-proxy HLS: browser memutar lewat /api/stream?url=<URL asli> agar terhindar
// dari blokir CORS (backend me-relay + menambah header CORS). Manifest .m3u8 ditulis
// ulang sehingga variant/segmen ikut lewat proxy. Bukan bypass geo untuk CDN yang
// memblokir IP server — hanya melewati CORS.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PROXY_TIMEOUT_MS = 20000;

// ── Proteksi SSRF: tolak host privat/loopback/link-local ────────────────────
function isPrivateIp(ip) {
  const h = String(ip).toLowerCase();
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  if (/^(127\.|10\.|169\.254\.|0\.)/.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  const m = /^172\.(\d+)\./.exec(h);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  return false;
}
function isPrivateHost(host) {
  const h = String(host).toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return isPrivateIp(h);
  return false;
}
async function safeTarget(u) {
  let url;
  try { url = new URL(u); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  if (isPrivateHost(url.hostname)) return null;
  try { const { address } = await dns.lookup(url.hostname); if (isPrivateIp(address)) return null; } catch (_) { /* biarkan fetch gagal alami */ }
  return url;
}

const proxyUrl = (abs) => '/api/stream?url=' + encodeURIComponent(abs);

// Tulis ulang manifest: URL variant/segmen + URI="..." (KEY/MEDIA/MAP) → lewat proxy.
function rewriteManifest(text, base) {
  return text.split('\n').map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (m, uri) => {
        try { return `URI="${proxyUrl(new URL(uri, base).toString())}"`; } catch (_) { return m; }
      });
    }
    try { return proxyUrl(new URL(t, base).toString()); } catch (_) { return line; }
  }).join('\n');
}

router.get('/stream', async (req, res) => {
  const target = await safeTarget(req.query.url || '');
  if (!target) return res.status(400).json({ success: false, message: 'URL tidak valid / tidak diizinkan.' });

  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Range');
  res.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT_MS);
  req.on('close', () => ctrl.abort());

  try {
    const headers = { 'User-Agent': UA, Accept: '*/*' };
    if (req.headers.range) headers.Range = req.headers.range;
    // Referer = origin URL target (banyak CDN cek referer, bukan hanya CORS)
    headers.Referer = target.origin + '/';

    const up = await fetch(target.toString(), { headers, redirect: 'follow', signal: ctrl.signal });
    const ct = (up.headers.get('content-type') || '').toLowerCase();
    const isM3U8 = /mpegurl|vnd\.apple/.test(ct) || /\.m3u8($|\?)/i.test(target.pathname);

    if (isM3U8) {
      const text = await up.text();
      res.status(up.ok ? 200 : up.status);
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-cache');
      return res.send(rewriteManifest(text, target.toString()));
    }

    // Relay byte (segmen .ts/.aac, kunci .key) — streaming, tak di-buffer penuh.
    res.status(up.status);
    ['content-type', 'content-length', 'accept-ranges', 'content-range'].forEach((h) => {
      const v = up.headers.get(h); if (v) res.set(h, v);
    });
    if (up.body) Readable.fromWeb(up.body).pipe(res);
    else res.end();
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ success: false, message: err.message });
    else res.end();
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;
