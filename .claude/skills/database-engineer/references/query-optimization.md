# Query Optimization Reference

## EXPLAIN ANALYZE — Cara Baca

```sql
-- Selalu gunakan opsi lengkap untuk diagnosis akurat
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT u.id, u.email, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.status = 'active'
GROUP BY u.id, u.email
ORDER BY order_count DESC
LIMIT 20;
```

### Anatomy Output EXPLAIN
```
Gather  (cost=1234.56..5678.90 rows=100 width=48) (actual time=12.345..45.678 rows=95 loops=1)
  ->  Hash Join  (cost=... rows=...) (actual time=... rows=... loops=...)
        Hash Cond: (o.user_id = u.id)
        Buffers: shared hit=1234 read=567
        ->  Seq Scan on orders o  (cost=...) (actual time=...) rows=50000 loops=1)
        ->  Hash  (...)
              ->  Index Scan using idx_users_status on users u

cost=startup..total  → estimated cost unit (bukan ms)
rows=N               → estimated row count
actual time=ms       → real execution time in ms
loops=N              → berapa kali node ini dieksekusi
shared hit=N         → pages dari buffer cache (memory) — bagus
shared read=N        → pages dari disk — mahal
```

### Node Types dan Interpretasinya
```
Sequential Scan (Seq Scan)
  → Baca seluruh tabel row by row
  → OK: tabel kecil (< 1000 row) atau query butuh > 20% rows
  → MASALAH: tabel besar dengan filter ketat → perlu index

Index Scan
  → Pakai index untuk cari rows, lalu fetch dari heap
  → Bagus untuk selective queries (< 5-10% rows)
  → Bisa lambat kalau rows yang diambil banyak (random I/O)

Index Only Scan
  → Semua kolom yang dibutuhkan ada di index (covering index)
  → Paling efisien — tidak perlu baca heap sama sekali

Bitmap Index Scan + Bitmap Heap Scan
  → Kumpulkan semua row locations dari index dulu, lalu baca heap secara berurutan
  → Lebih efisien dari Index Scan kalau rows banyak

Nested Loop Join
  → Untuk setiap row di outer → cari di inner
  → Bagus: outer kecil + index di inner
  → BURUK: outer besar → O(n×m)

Hash Join
  → Build hash table dari sisi kecil, probe dengan sisi besar
  → Bagus untuk medium-large datasets tanpa index
  → Butuh memory (work_mem)

Merge Join
  → Kedua sisi sudah terurut (sorted), merge bersamaan
  → Efisien kalau data sudah terurut atau ada index

Sort (external)
  → Sort spill ke disk karena work_mem tidak cukup
  → Fix: naikkan work_mem atau tambahkan index
```

---

## Slow Query Diagnosis — Workflow

```sql
-- Step 1: Temukan slow queries
SELECT
  query,
  calls,
  round(mean_exec_time::numeric, 2) AS mean_ms,
  round(total_exec_time::numeric, 2) AS total_ms,
  round(stddev_exec_time::numeric, 2) AS stddev_ms,
  rows / calls AS avg_rows
FROM pg_stat_statements
WHERE calls > 100
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Step 2: Cek apakah statistik stale
SELECT
  schemaname,
  tablename,
  n_live_tup,
  n_dead_tup,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE tablename = 'orders';

-- Kalau last_analyze lama atau n_dead_tup tinggi:
ANALYZE orders;
VACUUM ANALYZE orders;

-- Step 3: Cek missing indexes
SELECT
  schemaname,
  tablename,
  attname,
  n_distinct,
  correlation
FROM pg_stats
WHERE tablename = 'orders'
ORDER BY n_distinct DESC;

-- Step 4: Cek index usage
SELECT
  indexrelname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE relname = 'orders'
ORDER BY idx_scan DESC;
```

---

## Common Query Anti-Patterns dan Solusinya

### 1. Fungsi di Kolom WHERE
```sql
-- ❌ Index pada email tidak dipakai
SELECT * FROM users WHERE LOWER(email) = 'user@example.com';
SELECT * FROM users WHERE DATE(created_at) = '2026-01-01';
SELECT * FROM users WHERE EXTRACT(YEAR FROM created_at) = 2026;

-- ✅ Solusi: functional index
CREATE INDEX idx_users_email_lower ON users (LOWER(email));
SELECT * FROM users WHERE LOWER(email) = 'user@example.com';

-- ✅ Atau: range query menghindari fungsi di kolom
SELECT * FROM users
WHERE created_at >= '2026-01-01' AND created_at < '2026-01-02';

SELECT * FROM users
WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01';
```

### 2. LIKE dengan Leading Wildcard
```sql
-- ❌ Full table scan — index tidak bisa dipakai
SELECT * FROM products WHERE name LIKE '%laptop%';

-- ✅ Solusi 1: trigram index (pg_trgm) untuk contains search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);
SELECT * FROM products WHERE name ILIKE '%laptop%';

-- ✅ Solusi 2: Full-text search untuk natural language
CREATE INDEX idx_products_fts ON products USING GIN (to_tsvector('english', name || ' ' || description));
SELECT * FROM products
WHERE to_tsvector('english', name || ' ' || description) @@ plainto_tsquery('english', 'laptop gaming');

-- ✅ LIKE tanpa leading wildcard — bisa pakai index normal
SELECT * FROM users WHERE email LIKE 'john%';  -- index bisa dipakai
```

### 3. N+1 Queries
```sql
-- ❌ N+1: 1 query orders + 1 query per order untuk ambil user
-- Application code:
-- orders = SELECT * FROM orders LIMIT 100
-- for order in orders:
--   user = SELECT * FROM users WHERE id = order.user_id  ← 100 queries!

-- ✅ Fix: JOIN dalam satu query
SELECT
  o.id,
  o.total,
  o.status,
  u.id AS user_id,
  u.name AS user_name,
  u.email AS user_email
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.status = 'pending'
LIMIT 100;

-- ✅ Atau: WHERE IN untuk batch fetch di application layer
-- order_ids = [1, 2, 3, ..., 100]
-- SELECT * FROM users WHERE id = ANY($1::uuid[])
```

### 4. Pagination dengan OFFSET Besar
```sql
-- ❌ OFFSET 100000 harus scan dan buang 100k rows
SELECT id, title, created_at FROM posts
ORDER BY created_at DESC
LIMIT 20 OFFSET 100000;

-- ✅ Keyset pagination — pakai nilai terakhir sebagai cursor
-- Simpan created_at dan id dari row terakhir di halaman sebelumnya
SELECT id, title, created_at FROM posts
WHERE (created_at, id) < ('2026-01-15 10:30:00'::timestamptz, 'last-seen-uuid'::uuid)
ORDER BY created_at DESC, id DESC
LIMIT 20;

-- ✅ Atau dengan WHERE id < last_id (kalau id ordered)
SELECT id, title, created_at FROM posts
WHERE id < $last_id
ORDER BY id DESC
LIMIT 20;
```

### 5. COUNT(*) yang Lambat
```sql
-- ❌ COUNT(*) exact pada tabel besar = full scan
SELECT COUNT(*) FROM orders;  -- lambat untuk tabel dengan jutaan rows

-- ✅ Estimasi cepat dari pg_stat
SELECT reltuples::bigint AS estimated_count
FROM pg_class
WHERE relname = 'orders';

-- ✅ COUNT dengan filter — pastikan ada index
SELECT COUNT(*) FROM orders WHERE status = 'pending';
-- Pastikan ada index: CREATE INDEX ON orders (status)

-- ✅ Materialized count untuk dashboard
CREATE TABLE stats_cache (
  key        VARCHAR(100) PRIMARY KEY,
  value      BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Update via trigger atau background job
```

### 6. Subquery vs JOIN
```sql
-- ❌ Correlated subquery — dieksekusi sekali per row outer
SELECT id, name,
  (SELECT COUNT(*) FROM orders WHERE user_id = users.id) AS order_count
FROM users;

-- ✅ JOIN dengan aggregation — jauh lebih efisien
SELECT
  u.id,
  u.name,
  COALESCE(o.order_count, 0) AS order_count
FROM users u
LEFT JOIN (
  SELECT user_id, COUNT(*) AS order_count
  FROM orders
  GROUP BY user_id
) o ON o.user_id = u.id;

-- ✅ Window function alternatif
SELECT
  id,
  name,
  COUNT(o.id) OVER (PARTITION BY u.id) AS order_count
FROM users u
LEFT JOIN orders o ON o.user_id = u.id;
```

---

## Query Tuning — PostgreSQL Config

```sql
-- Cek konfigurasi yang relevan untuk query performance
SHOW work_mem;           -- Memory untuk sort, hash (default 4MB, sering terlalu kecil)
SHOW shared_buffers;     -- Buffer cache (rekomendasi: 25% RAM)
SHOW effective_cache_size; -- Hint ke planner tentang OS cache (rekomendasi: 75% RAM)
SHOW random_page_cost;   -- Cost asumsi random I/O (default 4.0, untuk SSD set 1.1-1.5)
SHOW seq_page_cost;      -- Cost sequential scan (default 1.0)

-- Set work_mem untuk session kalau query butuh lebih banyak memory
SET work_mem = '256MB';
EXPLAIN ANALYZE SELECT ... ORDER BY ...;

-- ✅ Rekomendasi umum (sesuaikan dengan RAM server):
-- shared_buffers = 25% RAM
-- effective_cache_size = 75% RAM
-- work_mem = RAM / (max_connections * 2)  -- hati-hati, per sort operation
-- random_page_cost = 1.1  -- untuk SSD
-- default_statistics_target = 100  -- lebih akurat untuk planner estimates
```

---

## Window Functions — Power Queries

```sql
-- Running total
SELECT
  id,
  amount,
  SUM(amount) OVER (
    PARTITION BY user_id
    ORDER BY created_at
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_total
FROM transactions;

-- Rank per kategori
SELECT
  id,
  product_name,
  category,
  price,
  RANK() OVER (PARTITION BY category ORDER BY price DESC) AS price_rank,
  DENSE_RANK() OVER (PARTITION BY category ORDER BY price DESC) AS dense_rank
FROM products;

-- Lag/Lead untuk perbandingan periode
SELECT
  date,
  revenue,
  LAG(revenue, 1) OVER (ORDER BY date) AS prev_revenue,
  revenue - LAG(revenue, 1) OVER (ORDER BY date) AS growth,
  ROUND(
    (revenue - LAG(revenue, 1) OVER (ORDER BY date)) /
    NULLIF(LAG(revenue, 1) OVER (ORDER BY date), 0) * 100, 2
  ) AS growth_pct
FROM daily_revenue
ORDER BY date;

-- First/Last value per group
SELECT DISTINCT
  user_id,
  FIRST_VALUE(id) OVER (PARTITION BY user_id ORDER BY created_at) AS first_order_id,
  LAST_VALUE(id) OVER (
    PARTITION BY user_id
    ORDER BY created_at
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
  ) AS last_order_id
FROM orders;
```

---

## CTE vs Subquery vs Temp Table

```sql
-- CTE (WITH clause) — readability + reuse
-- PostgreSQL 12+: CTE di-inline oleh planner (bukan optimization fence)
WITH active_users AS (
  SELECT id, email FROM users WHERE status = 'active' AND deleted_at IS NULL
),
user_orders AS (
  SELECT user_id, COUNT(*) as count, SUM(total) as revenue
  FROM orders WHERE created_at > NOW() - INTERVAL '30 days'
  GROUP BY user_id
)
SELECT
  au.id, au.email,
  COALESCE(uo.count, 0) as order_count,
  COALESCE(uo.revenue, 0) as revenue
FROM active_users au
LEFT JOIN user_orders uo ON uo.user_id = au.id;

-- Temp table — untuk query complex multi-step atau data yang di-reuse banyak
CREATE TEMP TABLE temp_active_users AS
  SELECT id, email FROM users WHERE status = 'active';

CREATE INDEX ON temp_active_users (id);  -- bisa index temp table!

SELECT t.*, o.order_count
FROM temp_active_users t
JOIN (SELECT user_id, COUNT(*) as order_count FROM orders GROUP BY user_id) o
  ON o.user_id = t.id;

DROP TABLE temp_active_users;  -- cleanup (atau otomatis saat session berakhir)
```
