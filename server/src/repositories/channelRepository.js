const crypto = require('crypto');
const { pool, q } = require('../config/db');

const urlHash = (url) => crypto.createHash('sha1').update(String(url).trim()).digest('hex');

const channelRepo = {
  urlHash,

  // Upsert massal (dedup via url_hash). Metadata (nama/logo/kategori/negara/source)
  // di-refresh; field kesehatan (status/last_checked/fail_count) DIPERTAHANKAN agar
  // hasil health-check tidak hilang saat re-import. Diproses per batch.
  async bulkUpsert(channels, sourceId = null) {
    if (!channels.length) return 0;
    const BATCH = 200;
    let affected = 0;
    for (let i = 0; i < channels.length; i += BATCH) {
      const slice = channels.slice(i, i + BATCH);
      const values = [];
      const params = [];
      for (const c of slice) {
        values.push('(?,?,?,?,?,?,?,?,?,?)');
        params.push(
          c.name, c.stream_url, urlHash(c.stream_url), c.tvg_id || null,
          c.logo || null, c.category || null, c.country || null,
          c.country_code || null, c.group_title || null, sourceId,
        );
      }
      const r = await q(
        `INSERT INTO iptv_channels
           (name,stream_url,url_hash,tvg_id,logo,category,country,country_code,group_title,source_id)
         VALUES ${values.join(',')}
         ON DUPLICATE KEY UPDATE
           name=VALUES(name), tvg_id=VALUES(tvg_id), logo=VALUES(logo),
           category=VALUES(category), country=VALUES(country),
           country_code=VALUES(country_code), group_title=VALUES(group_title),
           source_id=COALESCE(source_id, VALUES(source_id)), updated_at=NOW()`,
        params,
      );
      affected += r.affectedRows || 0;
    }
    return affected;
  },

  // Channel untuk publik: hanya yang status='active' & tidak disembunyikan.
  async listActive({ category, country, search, limit = 500, offset = 0 } = {}) {
    const where = ["status='active'", 'is_hidden=0'];
    const params = [];
    if (category) { where.push('category=?'); params.push(category); }
    if (country)  { where.push('country_code=?'); params.push(country); }
    if (search)   { where.push('name LIKE ?'); params.push(`%${search}%`); }
    params.push(Number(limit), Number(offset));
    return q(
      `SELECT id,name,stream_url,tvg_id,logo,category,country,country_code,group_title,
              status,last_ok_at
         FROM iptv_channels WHERE ${where.join(' AND ')}
        ORDER BY country_code, name LIMIT ? OFFSET ?`,
      params,
    );
  },

  // Untuk admin/semua status.
  async listAll({ status, limit = 1000, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (status) { where.push('status=?'); params.push(status); }
    params.push(Number(limit), Number(offset));
    return q(
      `SELECT * FROM iptv_channels ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      params,
    );
  },

  async getById(id) {
    const rows = await q('SELECT * FROM iptv_channels WHERE id=? LIMIT 1', [id]);
    return rows[0] || null;
  },

  // Channel yang perlu dicek (paling lama dicek dulu). Batasi jumlah per batch.
  async getForCheck(limit = 500) {
    return q(
      `SELECT id, stream_url FROM iptv_channels
        WHERE is_hidden=0
        ORDER BY (last_checked_at IS NULL) DESC, last_checked_at ASC
        LIMIT ?`,
      [Number(limit)],
    );
  },

  // Update hasil check satu channel. failThreshold: berapa gagal beruntun → 'dead'.
  async applyCheckResult(id, { ok, httpStatus, latencyMs }, failThreshold = 2) {
    if (ok) {
      await q(
        `UPDATE iptv_channels
            SET status='active', fail_count=0, http_status=?, check_ms=?,
                last_checked_at=NOW(), last_ok_at=NOW()
          WHERE id=?`,
        [httpStatus ?? null, latencyMs ?? null, id],
      );
    } else {
      // PENTING: evaluasi `status` SEBELUM menaikkan fail_count. Di MySQL, SET
      // dievaluasi kiri→kanan dan ekspresi berikutnya melihat nilai kolom yang sudah
      // ter-update; jadi status harus dihitung lebih dulu memakai fail_count lama
      // (agar butuh benar-benar `failThreshold` kali gagal beruntun sebelum 'dead').
      await q(
        `UPDATE iptv_channels
            SET status=IF(fail_count+1 >= ?, 'dead', status),
                fail_count=fail_count+1,
                http_status=?, check_ms=?, last_checked_at=NOW()
          WHERE id=?`,
        [failThreshold, httpStatus ?? null, latencyMs ?? null, id],
      );
    }
  },

  async countByStatus() {
    const rows = await q('SELECT status, COUNT(*) AS n FROM iptv_channels GROUP BY status');
    const out = { active: 0, dead: 0, unknown: 0, checking: 0, total: 0 };
    rows.forEach(r => { out[r.status] = r.n; out.total += r.n; });
    return out;
  },

  async distinctCountries() {
    return q(
      `SELECT country_code, MAX(country) AS country, COUNT(*) AS n
         FROM iptv_channels WHERE status='active' AND is_hidden=0 AND country_code IS NOT NULL
        GROUP BY country_code ORDER BY country`,
    );
  },

  async distinctCategories() {
    return q(
      `SELECT category, COUNT(*) AS n FROM iptv_channels
        WHERE status='active' AND is_hidden=0 AND category IS NOT NULL
        GROUP BY category ORDER BY n DESC`,
    );
  },

  // Set semua channel milik source menjadi 'checking' bila belum pernah dicek (opsional).
  async pool() { return pool; },
};

module.exports = channelRepo;
