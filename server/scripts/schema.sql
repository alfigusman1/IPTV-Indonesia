-- Schema database `iptv` — dijalankan idempotent oleh scripts/migrate.js.
-- Semua tabel diprefiks `iptv_` agar aman bila DB dipakai bersama (walau user
-- iptv hanya diberi akses ke database iptv).

-- ── Sumber playlist (M3U) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iptv_sources (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(191)  NOT NULL,
  url              VARCHAR(1024) NOT NULL,
  type             ENUM('m3u_url','m3u_file','manual') NOT NULL DEFAULT 'm3u_url',
  country_code     VARCHAR(8)    NULL,          -- fallback bila channel tak punya tvg-country
  enabled          TINYINT(1)    NOT NULL DEFAULT 1,
  trusted          TINYINT(1)    NOT NULL DEFAULT 0,   -- 1 = channel selalu tampil (tak disaring health-check)
  priority         INT           NOT NULL DEFAULT 100, -- kecil = didahulukan saat dedup
  last_imported_at DATETIME      NULL,
  channel_count    INT           NOT NULL DEFAULT 0,
  last_error       VARCHAR(512)  NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_url (url(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Channel ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iptv_channels (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(255)  NOT NULL,
  stream_url      VARCHAR(2048) NOT NULL,
  url_hash        CHAR(40)      NOT NULL,        -- sha1(stream_url) untuk dedup
  tvg_id          VARCHAR(255)  NULL,
  logo            VARCHAR(2048) NULL,
  category        VARCHAR(64)   NULL,            -- news, entertainment, sports, ...
  country         VARCHAR(100)  NULL,
  country_code    VARCHAR(8)    NULL,
  group_title     VARCHAR(191)  NULL,
  source_id       INT           NULL,
  status          ENUM('active','dead','unknown','checking') NOT NULL DEFAULT 'unknown',
  last_checked_at DATETIME      NULL,
  last_ok_at      DATETIME      NULL,
  fail_count      INT           NOT NULL DEFAULT 0,
  check_ms        INT           NULL,            -- latency cek terakhir (ms)
  http_status     INT           NULL,            -- HTTP status cek terakhir
  is_hidden       TINYINT(1)    NOT NULL DEFAULT 0, -- override manual sembunyikan
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_url_hash (url_hash),
  KEY idx_status (status),
  KEY idx_category (category),
  KEY idx_country (country_code),
  KEY idx_source (source_id),
  KEY idx_status_checked (status, last_checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Log health-check (retensi pendek, untuk audit) ───────────────────────────
CREATE TABLE IF NOT EXISTS iptv_check_logs (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  channel_id  INT          NOT NULL,
  status      VARCHAR(16)  NOT NULL,
  http_status INT          NULL,
  latency_ms  INT          NULL,
  message     VARCHAR(255) NULL,
  checked_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_channel (channel_id, checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Perlebar kolom untuk instalasi lama (idempotent — MODIFY aman diulang).
-- Beberapa sumber (iptv-org global) punya URL/logo panjang > 1024 char.
ALTER TABLE iptv_channels MODIFY stream_url VARCHAR(2048) NOT NULL;
ALTER TABLE iptv_channels MODIFY logo VARCHAR(2048) NULL;
ALTER TABLE iptv_channels MODIFY name VARCHAR(255) NOT NULL;
ALTER TABLE iptv_channels MODIFY tvg_id VARCHAR(255) NULL;
