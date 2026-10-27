const { q } = require('../config/db');

const sourceRepo = {
  async getAll() {
    return q('SELECT * FROM iptv_sources ORDER BY priority, id');
  },

  async getEnabled() {
    return q('SELECT * FROM iptv_sources WHERE enabled=1 ORDER BY priority, id');
  },

  // Tambah/aktifkan sumber (idempotent via unique url).
  async upsert({ name, url, type = 'm3u_url', countryCode = null, priority = 100, enabled = 1, trusted = 0 }) {
    await q(
      `INSERT INTO iptv_sources (name,url,type,country_code,priority,enabled,trusted)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), type=VALUES(type),
         country_code=VALUES(country_code), priority=VALUES(priority),
         enabled=VALUES(enabled), trusted=VALUES(trusted), updated_at=NOW()`,
      [name, url, type, countryCode, priority, enabled, trusted ? 1 : 0],
    );
    const rows = await q('SELECT * FROM iptv_sources WHERE url=? LIMIT 1', [url]);
    return rows[0] || null;
  },

  async markImported(id, channelCount, error = null) {
    await q(
      'UPDATE iptv_sources SET last_imported_at=NOW(), channel_count=?, last_error=? WHERE id=?',
      [channelCount, error, id],
    );
  },
};

module.exports = sourceRepo;
