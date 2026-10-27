# Indexing Strategy Reference

## Jenis Index dan Kapan Dipakai

```
Index Type    Operator            Kapan Pakai
────────────────────────────────────────────────────────────────────
B-tree        =, <, >, <=, >=    Default. Equality, range, ORDER BY, LIKE 'prefix%'
              BETWEEN, IN
              IS NULL/NOT NULL

Hash          =                  Equality saja. Jarang lebih baik dari B-tree.

GIN           @>, <@, @@         Array, JSONB, full-text search, pg_trgm
              &&, ?

GiST          <<, &&, @>, <->    Geometri, range types, full-text, nearest-neighbor

BRIN          range queries       Tabel sangat besar dengan data fisik terurut
                                  (log tables, time-series). Sangat kecil tapi kasar.

SP-GiST       =, <<, <@          Data non-balanced (IP, geometri, teks prefix)
```

---

## B-tree Index Patterns

### Single Column Index
```sql
-- Basic index untuk equality dan range
CREATE INDEX idx_orders_user_id ON orders (user_id);
CREATE INDEX idx_orders_created_at ON orders (created_at DESC);

-- Index pada expression (functional index)
CREATE INDEX idx_users_email_lower ON users (LOWER(email));
CREATE INDEX idx_orders_year ON orders (EXTRACT(YEAR FROM created_at));
```

### Composite Index — Urutan Kolom Sangat Penting
```sql
-- Rule: Equality columns dulu, Range column terakhir

-- Query: WHERE status = 'active' AND created_at > '2026-01-01' ORDER BY created_at
-- ✅ Index yang benar: status dulu (equality), created_at kedua (range + ORDER BY)
CREATE INDEX idx_orders_status_created ON orders (status, created_at DESC);

-- Query: WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC
CREATE INDEX idx_orders_user_status_created ON orders (user_id, status, created_at DESC);

-- Index ini bisa melayani:
-- WHERE user_id = $1
-- WHERE user_id = $1 AND status = $2
-- WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC
-- Tapi TIDAK efisien untuk: WHERE status = $1 (leading column tidak ada)
```

### Partial Index — Index Hanya Sebagian Data
```sql
-- Index hanya untuk baris yang relevan — jauh lebih kecil dan cepat

-- Hanya index active users (sering di-query, dibanding soft-deleted)
CREATE INDEX idx_users_email_active ON users (email)
  WHERE deleted_at IS NULL;

-- Hanya index pending orders
CREATE INDEX idx_orders_created_pending ON orders (created_at DESC)
  WHERE status = 'pending';

-- Index untuk nilai non-null saja
CREATE INDEX idx_users_phone ON users (phone)
  WHERE phone IS NOT NULL;

-- Manfaat partial index:
-- - Lebih kecil → fit di memory lebih mudah
-- - Update lebih cepat (hanya update jika row match condition)
-- - Lebih selective → lebih efisien
```

### Covering Index — Include Kolom Tambahan
```sql
-- Index Only Scan: semua kolom yang dibutuhkan ada di index

-- Query: SELECT id, email, name FROM users WHERE status = 'active'
-- ❌ Index biasa: Index Scan (baca heap untuk ambil name)
CREATE INDEX idx_users_status ON users (status);

-- ✅ Covering index: Index Only Scan (tidak perlu baca heap)
CREATE INDEX idx_users_status_covering ON users (status)
  INCLUDE (id, email, name);

-- INCLUDE vs kolom biasa di index:
-- - INCLUDE: tidak bisa dipakai di WHERE/ORDER BY, tapi ada di leaf node
-- - Kolom biasa: bisa dipakai di WHERE/ORDER BY
```

---

## GIN Index — JSONB, Array, Full-Text

```sql
-- JSONB — query fleksibel
CREATE INDEX idx_products_attributes ON products USING GIN (attributes);

-- Query yang bisa pakai GIN index:
SELECT * FROM products WHERE attributes @> '{"color": "red"}';
SELECT * FROM products WHERE attributes ? 'color';  -- key exists
SELECT * FROM products WHERE attributes ?| ARRAY['color', 'size'];  -- any key exists

-- Array
CREATE INDEX idx_posts_tags ON posts USING GIN (tags);
SELECT * FROM posts WHERE tags @> ARRAY['postgresql', 'indexing'];
SELECT * FROM posts WHERE tags && ARRAY['postgresql', 'redis'];

-- Full-text search
CREATE INDEX idx_products_fts ON products
  USING GIN (to_tsvector('english', name || ' ' || COALESCE(description, '')));

SELECT * FROM products
WHERE to_tsvector('english', name || ' ' || COALESCE(description, ''))
      @@ plainto_tsquery('english', 'gaming laptop');

-- pg_trgm — LIKE/ILIKE contains search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);
SELECT * FROM products WHERE name ILIKE '%gaming%';
SELECT * FROM products WHERE name % 'laptop';  -- similarity search
```

---

## Index Maintenance

### Monitor Index Usage
```sql
-- Index yang tidak pernah dipakai — kandidat untuk dihapus
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;

-- Index yang paling sering dipakai
SELECT
  indexrelname AS index_name,
  relname AS table_name,
  idx_scan AS times_used,
  idx_tup_read AS tuples_read,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC
LIMIT 20;
```

### Index Bloat
```sql
-- Cek bloat index (index yang perlu di-REINDEX)
SELECT
  indexrelname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
  pg_size_pretty(pg_relation_size(indrelid)) AS table_size
FROM pg_stat_user_indexes
JOIN pg_index USING (indexrelid)
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 20;

-- Rebuild index tanpa lock (PostgreSQL 12+)
REINDEX INDEX CONCURRENTLY idx_orders_user_id;

-- Rebuild semua index di tabel
REINDEX TABLE CONCURRENTLY orders;
```

### Membuat Index di Production
```sql
-- ✅ SELALU gunakan CONCURRENTLY di production
-- Tanpa CONCURRENTLY: exclusive lock → downtime
-- Dengan CONCURRENTLY: tidak ada lock, tapi lebih lambat dan butuh 2 table scan

CREATE INDEX CONCURRENTLY idx_orders_status ON orders (status);

-- Kalau CONCURRENTLY gagal di tengah jalan:
-- Index akan ada dalam state INVALID
SELECT indexname, indisvalid FROM pg_indexes
JOIN pg_class ON pg_class.relname = indexname
WHERE tablename = 'orders' AND indisvalid = false;

-- Drop dan buat ulang
DROP INDEX CONCURRENTLY idx_orders_status;
CREATE INDEX CONCURRENTLY idx_orders_status ON orders (status);
```

---

## Index Decision Framework

```
Pertanyaan untuk menentukan index:

1. Kolom ini sering muncul di WHERE clause?
   → Ya, dan cardinality tinggi (banyak nilai unik) → B-tree index

2. Tabel ini dibaca dengan filter status/type tertentu?
   → Ya, dan sebagian kecil rows match → Partial index

3. Query butuh kolom tambahan selain filter?
   → Pertimbangkan covering index (INCLUDE)

4. Query di kolom JSONB atau array?
   → GIN index

5. Query LIKE '%search%' atau full-text search?
   → pg_trgm GIN atau tsvector GIN

6. ORDER BY sering dipakai berbarengan dengan filter?
   → Composite index dengan ORDER direction yang sama

7. Tabel sangat besar (> 100GB) dengan data append-only?
   → BRIN index bisa jauh lebih kecil dari B-tree

Kapan TIDAK membuat index:
- Tabel kecil (< 10.000 rows) — seq scan lebih cepat
- Kolom dengan cardinality sangat rendah (boolean, status 2 nilai) → partial index lebih baik
- Tabel yang write-heavy (banyak INSERT/UPDATE) — setiap index memperlambat write
- Kolom yang tidak pernah dipakai di WHERE/JOIN/ORDER BY
```

---

## Composite vs Beberapa Single Index

```sql
-- Contoh tabel: orders dengan query umum:
-- 1. WHERE user_id = $1
-- 2. WHERE user_id = $1 AND status = $2
-- 3. WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC
-- 4. WHERE status = $1 ORDER BY created_at DESC

-- ✅ Strategi optimal:
CREATE INDEX idx_orders_user_status_created ON orders (user_id, status, created_at DESC);
-- Melayani query 1, 2, 3

CREATE INDEX idx_orders_status_created ON orders (status, created_at DESC);
-- Melayani query 4

-- PostgreSQL bisa gunakan Bitmap AND/OR untuk combine beberapa index:
-- WHERE user_id = $1 OR status = $2
-- → Bitmap Index Scan idx_user + Bitmap Index Scan idx_status → BitmapOr → Bitmap Heap Scan
-- Tapi lebih baik ada composite index kalau query ini sering

-- Aturan: buat composite index untuk query yang paling sering dan paling lambat dulu
-- Monitor pg_stat_statements, prioritaskan berdasarkan total_time
```
