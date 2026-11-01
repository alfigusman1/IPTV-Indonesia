# Database Migrations Reference

## Prinsip Zero-Downtime Migration

```
Aturan utama:
1. Setiap migration harus bisa di-rollback
2. Pisahkan deployment kode dan deployment schema
3. Schema baru harus kompatibel dengan kode lama DAN kode baru
4. Gunakan expand-contract pattern untuk perubahan breaking

Urutan yang benar:
Phase 1 — Expand:  Tambah schema baru (backward compatible)
Phase 2 — Migrate: Deploy kode yang bisa baca schema lama DAN baru
Phase 3 — Contract: Hapus schema lama setelah semua instance update
```

---

## DDL Operations — Safe vs Unsafe

### Operasi AMAN (tidak lock atau lock sangat singkat)
```sql
-- ✅ Tambah kolom nullable
ALTER TABLE orders ADD COLUMN notes TEXT;

-- ✅ Tambah kolom dengan DEFAULT (PostgreSQL 11+)
-- PostgreSQL 11+: tidak rewrite tabel, hanya update catalog
ALTER TABLE orders ADD COLUMN is_gift BOOLEAN NOT NULL DEFAULT false;

-- ✅ Drop kolom (hanya update catalog, tidak rewrite)
ALTER TABLE orders DROP COLUMN legacy_field;

-- ✅ Tambah index tanpa lock
CREATE INDEX CONCURRENTLY idx_orders_status ON orders (status);

-- ✅ Tambah FK constraint (dua langkah)
-- Step 1: Tambah constraint NOT VALID (tidak scan data existing)
ALTER TABLE orders
  ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
  NOT VALID;
-- Step 2: Validate secara terpisah (Share lock, tidak exclusive)
ALTER TABLE orders VALIDATE CONSTRAINT fk_orders_user;

-- ✅ Rename kolom (PostgreSQL 9.6+: sangat cepat)
ALTER TABLE orders RENAME COLUMN old_name TO new_name;
```

### Operasi BERBAHAYA (butuh exclusive lock atau rewrite tabel)
```sql
-- ❌ Tambah kolom NOT NULL tanpa DEFAULT (rewrite tabel di PostgreSQL < 11)
ALTER TABLE orders ADD COLUMN required_field TEXT NOT NULL;
-- FIX: Tambah nullable dulu, backfill, lalu set NOT NULL

-- ❌ ALTER COLUMN TYPE yang tidak trivial (rewrite tabel)
ALTER TABLE orders ALTER COLUMN status TYPE INTEGER USING status::integer;
-- FIX: Tambah kolom baru, migrate data, switch, drop lama

-- ❌ SET NOT NULL pada kolom existing (full scan untuk validasi)
ALTER TABLE orders ALTER COLUMN user_id SET NOT NULL;
-- FIX: Gunakan CHECK CONSTRAINT NOT VALID dulu

-- ❌ CREATE INDEX tanpa CONCURRENTLY
CREATE INDEX idx_orders_status ON orders (status);

-- ❌ DROP INDEX tanpa CONCURRENTLY
DROP INDEX idx_orders_status;
-- FIX: DROP INDEX CONCURRENTLY idx_orders_status;

-- ❌ ADD CONSTRAINT (check) langsung
ALTER TABLE orders ADD CONSTRAINT check_total_positive CHECK (total > 0);
-- FIX: ADD CONSTRAINT ... NOT VALID, lalu VALIDATE CONSTRAINT
```

---

## Expand-Contract Pattern

### Contoh: Rename Kolom

```sql
-- ❌ JANGAN: Rename langsung = breaking change
ALTER TABLE users RENAME COLUMN full_name TO display_name;
-- Semua kode yang pakai full_name langsung error!

-- ✅ DO: Expand-Contract dalam 3 fase

-- FASE 1: Expand (tambah kolom baru, keep yang lama)
ALTER TABLE users ADD COLUMN display_name VARCHAR(255);

-- Sync data via trigger
CREATE OR REPLACE FUNCTION sync_display_name()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    NEW.display_name = COALESCE(NEW.display_name, NEW.full_name);
    NEW.full_name = COALESCE(NEW.full_name, NEW.display_name);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_user_name
BEFORE INSERT OR UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION sync_display_name();

-- Backfill data existing
UPDATE users SET display_name = full_name WHERE display_name IS NULL;
ALTER TABLE users ALTER COLUMN display_name SET NOT NULL;

-- FASE 2: Deploy kode baru yang pakai display_name
-- (kode lama masih pakai full_name — OK karena trigger sync)

-- FASE 3: Contract (hapus kolom lama + trigger)
DROP TRIGGER sync_user_name ON users;
DROP FUNCTION sync_display_name;
ALTER TABLE users DROP COLUMN full_name;
```

### Contoh: Ubah Tipe Kolom
```sql
-- ❌ JANGAN: ALTER COLUMN TYPE langsung di tabel besar
ALTER TABLE events ALTER COLUMN payload TYPE JSONB USING payload::jsonb;
-- Rewrite seluruh tabel = downtime!

-- ✅ DO: Tambah kolom baru, migrate bertahap, switch, drop

-- Step 1: Tambah kolom baru
ALTER TABLE events ADD COLUMN payload_jsonb JSONB;

-- Step 2: Backfill dalam batch (jangan satu query untuk tabel besar!)
DO $$
DECLARE
  batch_size INTEGER := 1000;
  last_id UUID := '00000000-0000-0000-0000-000000000000';
  rows_updated INTEGER;
BEGIN
  LOOP
    UPDATE events
    SET payload_jsonb = payload::jsonb
    WHERE id > last_id
      AND payload_jsonb IS NULL
    RETURNING id INTO last_id;

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    EXIT WHEN rows_updated < batch_size;

    PERFORM pg_sleep(0.1);  -- Jeda agar tidak overwhelm DB
  END LOOP;
END $$;

-- Step 3: Set NOT NULL setelah backfill selesai
UPDATE events SET payload_jsonb = '{}'::jsonb WHERE payload_jsonb IS NULL;
ALTER TABLE events ALTER COLUMN payload_jsonb SET NOT NULL;

-- Step 4: Switch aplikasi ke payload_jsonb, monitor
-- Step 5: Drop kolom lama
ALTER TABLE events DROP COLUMN payload;
ALTER TABLE events RENAME COLUMN payload_jsonb TO payload;
```

---

## Large Table Migration — Backfill Safely

```sql
-- ❌ JANGAN: Update seluruh tabel sekaligus
UPDATE orders SET tax_amount = total * 0.11 WHERE tax_amount IS NULL;
-- Untuk tabel dengan 50 juta rows: lock lama, log besar, disk I/O spike!

-- ✅ DO: Batch update dengan jeda

-- Python / pseudocode untuk batch update
-- Bisa juga dijalankan sebagai background job

DO $$
DECLARE
  batch_size  INT := 5000;
  updated     INT;
  total       INT := 0;
BEGIN
  LOOP
    UPDATE orders
    SET tax_amount = total * 0.11
    WHERE id IN (
      SELECT id FROM orders
      WHERE tax_amount IS NULL
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED  -- ✅ Skip rows locked oleh session lain
    );

    GET DIAGNOSTICS updated = ROW_COUNT;
    total := total + updated;

    EXIT WHEN updated = 0;

    RAISE NOTICE 'Updated % rows (total: %)', updated, total;
    PERFORM pg_sleep(0.05);  -- Jeda 50ms antar batch
  END LOOP;

  RAISE NOTICE 'Backfill complete. Total rows: %', total;
END $$;
```

---

## SET NOT NULL Safely

```sql
-- ❌ JANGAN: SET NOT NULL langsung (full table scan, lock lama)
ALTER TABLE users ALTER COLUMN phone SET NOT NULL;

-- ✅ DO: Gunakan CHECK CONSTRAINT dengan NOT VALID

-- Step 1: Pastikan tidak ada NULL dulu
SELECT COUNT(*) FROM users WHERE phone IS NULL;

-- Step 2: Tambah CHECK CONSTRAINT NOT VALID (tidak scan data existing)
ALTER TABLE users
  ADD CONSTRAINT users_phone_not_null CHECK (phone IS NOT NULL) NOT VALID;

-- Step 3: Validate secara terpisah (share lock, bukan exclusive)
-- Proses ini bisa lama tapi tidak block writes
ALTER TABLE users VALIDATE CONSTRAINT users_phone_not_null;

-- Step 4: Setelah validate, PostgreSQL tau kolom ini NOT NULL
-- Bisa convert ke actual NOT NULL constraint kalau mau
-- (tapi CHECK CONSTRAINT sudah cukup untuk query planner)
```

---

## Migration Tools Best Practices

### Struktur File Migration
```
migrations/
├── 001_create_users.sql
├── 002_create_orders.sql
├── 003_add_phone_to_users.sql
├── 004_create_order_items.sql
└── 005_add_index_orders_status.sql

Aturan penamaan:
- Nomor sequential atau timestamp prefix
- Nama deskriptif: verb + object (create_users, add_phone_to_users)
- Satu perubahan logis per file
- Jangan edit migration yang sudah di-deploy!
```

### Contoh Migration dengan Rollback
```sql
-- migration: 003_add_shipping_address_to_orders.sql
-- UP
ALTER TABLE orders
  ADD COLUMN shipping_address_line1 VARCHAR(255),
  ADD COLUMN shipping_address_line2 VARCHAR(255),
  ADD COLUMN shipping_city VARCHAR(100),
  ADD COLUMN shipping_postal_code VARCHAR(20),
  ADD COLUMN shipping_country CHAR(2);

COMMENT ON COLUMN orders.shipping_country IS 'ISO 3166-1 alpha-2 country code';

-- DOWN (rollback)
ALTER TABLE orders
  DROP COLUMN shipping_address_line1,
  DROP COLUMN shipping_address_line2,
  DROP COLUMN shipping_city,
  DROP COLUMN shipping_postal_code,
  DROP COLUMN shipping_country;
```

### Lock Timeout — Fail Fast daripada Block Lama
```sql
-- ✅ Set lock_timeout agar migration gagal cepat daripada menunggu lama
-- Jalankan di awal session migration

SET lock_timeout = '2s';     -- Gagal kalau tidak bisa dapat lock dalam 2 detik
SET statement_timeout = '30s'; -- Gagal kalau query berjalan > 30 detik

ALTER TABLE orders ADD COLUMN notes TEXT;
-- Kalau tabel sedang busy dan tidak bisa dapat lock dalam 2s → error, retry nanti
-- Lebih baik migration gagal dan retry daripada nunggu dan block semuanya
```

---

## Checklist Migration

```
Sebelum menulis migration:
□ Apakah operasi ini blocking? (cek tabel DDL Safe vs Unsafe di atas)
□ Berapa ukuran tabel? (> 1 juta rows → hati-hati ekstra)
□ Ada cara yang lebih aman? (CONCURRENTLY, NOT VALID, batch)
□ Apakah perlu lock_timeout?

Sebelum deploy ke production:
□ Test di staging dengan data yang representatif
□ Estimasi durasi migration di data production
□ Rollback plan sudah ada dan ditest
□ Monitoring aktif (disk space, lock waits, replication lag)
□ Jadwalkan di low-traffic window kalau memungkinkan

Setelah deploy:
□ Monitor replication lag (tidak boleh terlalu besar)
□ Verifikasi data integrity
□ Update dokumentasi schema
□ Hapus kode lama setelah migration stabil
```
