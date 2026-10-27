# Replication & Scaling Reference

## PostgreSQL Replication

### Streaming Replication Setup
```bash
# postgresql.conf (primary)
wal_level = replica
max_wal_senders = 10
wal_keep_size = 1GB
synchronous_commit = on          # 'on' = sync, 'local' = async replica OK

# pg_hba.conf (primary) — izinkan replica connect
host  replication  replicator  10.0.0.2/32  scram-sha-256

# Buat replication user
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'strong-password';

# Setup replica (jalankan sebagai postgres user)
pg_basebackup -h primary-host -U replicator -D /var/lib/postgresql/data \
  --wal-method=stream --checkpoint=fast --progress

# postgresql.conf (replica)
primary_conninfo = 'host=primary-host port=5432 user=replicator password=xxx'
hot_standby = on               # Izinkan read queries di replica
hot_standby_feedback = on      # Cegah primary vacuum data yang masih dibaca replica
```

### Monitor Replication
```sql
-- Di primary: cek status semua replica
SELECT
  client_addr,
  state,
  sent_lsn,
  write_lsn,
  flush_lsn,
  replay_lsn,
  (sent_lsn - replay_lsn) AS replication_lag_bytes,
  write_lag,
  flush_lag,
  replay_lag,
  sync_state
FROM pg_stat_replication;

-- Di replica: cek lag
SELECT
  now() - pg_last_xact_replay_timestamp() AS replication_delay,
  pg_is_in_recovery() AS is_replica,
  pg_last_wal_receive_lsn() AS received_lsn,
  pg_last_wal_replay_lsn() AS replayed_lsn;

-- Alert jika lag > threshold (misalnya > 30 detik)
```

### Read Replica — Routing Queries
```javascript
// Application-level read/write splitting
const primaryPool = new Pool({ host: 'primary.db.internal', ...config });
const replicaPool = new Pool({ host: 'replica.db.internal', ...config });

// ✅ Write → primary, Read → replica
async function getUser(id) {
  return replicaPool.query('SELECT * FROM users WHERE id = $1', [id]);
}

async function createUser(data) {
  return primaryPool.query('INSERT INTO users ... RETURNING *', [...data]);
}

// ✅ Read-after-write: langsung baca dari primary jika baru saja write
async function updateAndFetchUser(id, data) {
  await primaryPool.query('UPDATE users SET ... WHERE id = $1', [...data, id]);
  // Baca dari primary untuk dapat data terbaru (avoid replication lag)
  return primaryPool.query('SELECT * FROM users WHERE id = $1', [id]);
}
```

---

## Connection Pooling

### PgBouncer — Wajib untuk Production
```ini
; pgbouncer.ini

[databases]
mydb = host=127.0.0.1 port=5432 dbname=mydb

[pgbouncer]
listen_port = 5432
listen_addr = 0.0.0.0
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt

; Mode: session, transaction, statement
; Transaction mode: paling umum — connection dilepas setelah transaction selesai
pool_mode = transaction

; Jumlah koneksi ke PostgreSQL (server side)
max_client_conn = 1000      ; Max koneksi dari aplikasi ke PgBouncer
default_pool_size = 20      ; Koneksi aktual ke PostgreSQL per database+user
min_pool_size = 5
reserve_pool_size = 5

; Timeout
server_idle_timeout = 600
client_idle_timeout = 0
query_timeout = 0
```

### Sizing Connection Pool
```
Formula dasar:
  pool_size = (num_cores * 2) + effective_spindle_count

Untuk SSD (effective_spindle = 1):
  4 core → pool_size = 9
  8 core → pool_size = 17
  16 core → pool_size = 33

Jangan naif set max_connections = 500 di PostgreSQL:
- Setiap koneksi = ~5-10MB RAM
- 500 koneksi = 2.5-5GB hanya untuk koneksi
- Context switching mahal
- PgBouncer handle ribuan app connections → pool kecil ke PostgreSQL

Monitoring:
  SELECT count(*), state FROM pg_stat_activity GROUP BY state;
  -- idle: koneksi nganggur (sign: pool terlalu besar atau perlu pgbouncer)
  -- active: sedang query
  -- idle in transaction: berbahaya! koneksi hold transaction lama
```

---

## Table Partitioning

### Range Partitioning (paling umum untuk time-series)
```sql
-- Parent table
CREATE TABLE events (
  id         UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Buat partisi per bulan
CREATE TABLE events_2026_01 PARTITION OF events
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE events_2026_02 PARTITION OF events
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

-- Index di partisi (otomatis kalau dibuat di parent)
CREATE INDEX ON events (user_id, created_at DESC);
-- → Otomatis buat index di setiap partisi

-- Primary key harus include partition key
ALTER TABLE events ADD PRIMARY KEY (id, created_at);

-- Otomasi buat partisi bulan depan (jalankan via cron)
CREATE OR REPLACE FUNCTION create_monthly_partition(target_date DATE)
RETURNS void AS $$
DECLARE
  start_date DATE := DATE_TRUNC('month', target_date);
  end_date   DATE := start_date + INTERVAL '1 month';
  table_name TEXT := 'events_' || TO_CHAR(start_date, 'YYYY_MM');
BEGIN
  EXECUTE FORMAT(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF events FOR VALUES FROM (%L) TO (%L)',
    table_name, start_date, end_date
  );
END;
$$ LANGUAGE plpgsql;

-- Hapus partisi lama (data retention)
DROP TABLE events_2024_01;  -- Jauh lebih cepat dari DELETE!
```

### List Partitioning
```sql
-- Partisi berdasarkan nilai diskrit
CREATE TABLE orders (
  id      UUID NOT NULL,
  region  VARCHAR(20) NOT NULL,
  total   NUMERIC(12,2) NOT NULL
) PARTITION BY LIST (region);

CREATE TABLE orders_asia    PARTITION OF orders FOR VALUES IN ('ID', 'SG', 'MY', 'TH');
CREATE TABLE orders_europe  PARTITION OF orders FOR VALUES IN ('DE', 'FR', 'UK', 'NL');
CREATE TABLE orders_default PARTITION OF orders DEFAULT;  -- catch-all
```

### Kapan Partisi Membantu
```
✅ Partisi berguna ketika:
- Tabel > beberapa ratus GB
- Query hampir selalu filter pada partition key (created_at, region)
- Butuh hapus data lama dengan cepat (DROP PARTITION vs DELETE)
- Perlu load data ke partisi terpisah (bulk load)

❌ Partisi TIDAK membantu (bahkan bisa merugikan) ketika:
- Query tidak filter pada partition key (planner harus scan semua partisi)
- Tabel kecil atau medium
- Banyak cross-partition query (JOIN antar partisi mahal)
- UPDATE yang mengubah nilai partition key (row harus pindah partisi)
```

---

## Sharding — Horizontal Scaling

### Kapan Sharding Diperlukan
```
Coba dulu sebelum sharding:
1. Optimize queries dan indexes
2. Add read replicas untuk read-heavy workload
3. Vertical scaling (bigger machine)
4. Caching (Redis)
5. Partitioning

Sharding adalah pilihan terakhir karena:
- Kompleksitas sangat tinggi
- Cross-shard queries sulit dan lambat
- Distributed transactions bermasalah
- Schema migrations jauh lebih ribet

Tanda butuh sharding:
- Write throughput sudah maksimal di satu node
- Data terlalu besar untuk satu machine (> beberapa TB hot data)
- Single-shard queries sudah optimal tapi masih lambat
```

### Sharding Strategies
```
Hash Sharding:
  shard_id = hash(user_id) % num_shards
  Pro: distribusi merata
  Con: rebalancing sulit saat tambah shard, range queries mahal

Range Sharding:
  shard_0: user_id 1 - 1,000,000
  shard_1: user_id 1,000,001 - 2,000,000
  Pro: range queries efisien
  Con: hotspot jika traffic tidak merata

Directory Sharding:
  lookup_table: user_id → shard_id
  Pro: fleksibel, bisa rebalance
  Con: lookup table bisa jadi bottleneck

Consistent Hashing:
  Pro: minimal redistribution saat tambah/hapus shard
  Con: implementasi lebih kompleks
```

### Citus — PostgreSQL Distributed
```sql
-- Citus: ekstensi PostgreSQL untuk distributed queries
-- Data di-distribute tapi SQL tetap sama

-- Setup
CREATE EXTENSION citus;

-- Distribute tabel berdasarkan shard key
SELECT create_distributed_table('orders', 'user_id');
SELECT create_distributed_table('order_items', 'user_id');  -- co-locate!

-- Query berjalan seperti biasa — Citus route ke shard yang tepat
SELECT COUNT(*), SUM(total) FROM orders WHERE user_id = $1;

-- Cross-shard aggregation (lebih lambat, tapi tetap bisa)
SELECT DATE_TRUNC('day', created_at), SUM(total)
FROM orders
GROUP BY 1
ORDER BY 1;
```

---

## High Availability

### Failover dengan Patroni
```yaml
# patroni.yml — HA PostgreSQL dengan automatic failover
scope: postgres-cluster
namespace: /db/
name: node1

restapi:
  listen: 0.0.0.0:8008
  connect_address: 10.0.0.1:8008

etcd:
  hosts: etcd1:2379,etcd2:2379,etcd3:2379

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576  # 1MB max lag untuk failover
  initdb:
    - encoding: UTF8
    - data-checksums

postgresql:
  listen: 0.0.0.0:5432
  connect_address: 10.0.0.1:5432
  data_dir: /var/lib/postgresql/data
  parameters:
    max_connections: 200
    shared_buffers: 4GB
    wal_level: replica
    hot_standby: on
    wal_log_hints: on
```

### RTO dan RPO
```
RTO (Recovery Time Objective) — Berapa lama boleh down?
RPO (Recovery Point Objective) — Berapa banyak data boleh hilang?

Strategi berdasarkan RTO/RPO:

RTO < 30 detik, RPO < beberapa detik:
→ Patroni/Repmgr dengan synchronous replication + automatic failover

RTO < 5 menit, RPO < 1 menit:
→ Streaming replication + manual failover + WAL shipping

RTO < 1 jam, RPO < 1 jam:
→ Continuous WAL archiving ke S3 + PITR

RTO < 24 jam, RPO < 24 jam:
→ Daily backup + restore
```
