# Backup & Recovery Reference

## Prinsip Dasar

```
Aturan backup yang tidak boleh dilanggar:
1. Backup yang tidak pernah di-test = tidak ada backup
2. Backup harus disimpan di lokasi BERBEDA dari database (off-site)
3. Enkripsi backup sebelum disimpan (data sensitif)
4. Monitor ukuran dan durasi backup — kalau berubah drastis, ada masalah
5. Dokumen dan test prosedur recovery, bukan hanya backup

RTO (Recovery Time Objective): Berapa lama sistem boleh down?
RPO (Recovery Point Objective): Berapa banyak data boleh hilang?

Strategi berdasarkan RPO:
  RPO = 0          → Synchronous replication (zero data loss)
  RPO < 1 menit    → WAL streaming replication
  RPO < 1 jam      → WAL archiving setiap beberapa menit
  RPO < 24 jam     → Daily backup
```

---

## PostgreSQL Backup Methods

### pg_dump — Logical Backup
```bash
# Backup single database (format custom — lebih baik dari SQL)
pg_dump \
  --format=custom \
  --compress=9 \
  --file=/backups/mydb_$(date +%Y%m%d_%H%M%S).dump \
  --dbname=postgresql://user:pass@localhost:5432/mydb

# Backup all databases
pg_dumpall \
  --file=/backups/all_$(date +%Y%m%d).sql \
  --host=localhost \
  --username=postgres

# Backup hanya schema (tanpa data)
pg_dump --schema-only --format=custom --file=schema.dump mydb

# Backup hanya data (tanpa schema)
pg_dump --data-only --format=custom --file=data.dump mydb

# Backup tabel tertentu saja
pg_dump --table=orders --table=order_items --format=custom --file=orders.dump mydb

# Restore
pg_restore \
  --dbname=postgresql://user:pass@localhost:5432/mydb_restored \
  --jobs=4 \           # Parallel restore — lebih cepat
  --verbose \
  /backups/mydb_20260115_120000.dump

# Restore hanya tabel tertentu
pg_restore --table=orders --dbname=mydb /backups/mydb.dump
```

### pg_basebackup — Physical Backup
```bash
# Physical backup (copy semua file)
# Lebih cepat untuk restore tapi tidak bisa pilih tabel/schema

pg_basebackup \
  --pgdata=/backups/base_$(date +%Y%m%d) \
  --format=tar \
  --gzip \
  --compress=9 \
  --wal-method=stream \  # Sertakan WAL yang dibutuhkan
  --checkpoint=fast \
  --progress \
  --host=localhost \
  --username=replicator

# Verifikasi backup
pg_verifybackup /backups/base_20260115/
```

### WAL Archiving — Untuk Point-in-Time Recovery
```bash
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://my-backup-bucket/wal/%f'
# %p = path ke file WAL
# %f = filename

# Verifikasi archive berhasil
archive_status = on
# Cek: SELECT * FROM pg_stat_archiver;

# Restore ke waktu tertentu (PITR)
# 1. Restore base backup
# 2. Buat recovery.conf (PostgreSQL 11 ke bawah) atau postgresql.conf (12+)

# postgresql.conf untuk PITR (PostgreSQL 12+)
restore_command = 'aws s3 cp s3://my-backup-bucket/wal/%f %p'
recovery_target_time = '2026-01-15 14:30:00+07'
recovery_target_action = 'promote'  # promote jadi primary setelah recovery

# Buat file recovery signal
touch /var/lib/postgresql/data/recovery.signal

# Start PostgreSQL — akan replay WAL sampai target time
pg_ctl start
```

---

## Backup Automation

### Script Backup + Upload ke S3
```bash
#!/bin/bash
set -euo pipefail

# Konfigurasi
DB_URL="${DATABASE_URL}"
S3_BUCKET="${BACKUP_S3_BUCKET}"
RETENTION_DAYS=30
BACKUP_DIR="/tmp/db-backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="backup_${DATE}.dump"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup..."

# 1. Dump database
pg_dump \
  --format=custom \
  --compress=9 \
  --file="${BACKUP_DIR}/${BACKUP_FILE}" \
  "${DB_URL}"

BACKUP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}" | cut -f1)
echo "[$(date)] Backup created: ${BACKUP_FILE} (${BACKUP_SIZE})"

# 2. Enkripsi (opsional tapi sangat direkomendasikan)
gpg --symmetric \
    --cipher-algo AES256 \
    --passphrase "${BACKUP_ENCRYPTION_KEY}" \
    --batch \
    --output "${BACKUP_DIR}/${BACKUP_FILE}.gpg" \
    "${BACKUP_DIR}/${BACKUP_FILE}"

rm "${BACKUP_DIR}/${BACKUP_FILE}"

# 3. Upload ke S3
aws s3 cp \
  "${BACKUP_DIR}/${BACKUP_FILE}.gpg" \
  "s3://${S3_BUCKET}/backups/${BACKUP_FILE}.gpg" \
  --storage-class STANDARD_IA

echo "[$(date)] Uploaded to S3"

# 4. Hapus backup lokal
rm "${BACKUP_DIR}/${BACKUP_FILE}.gpg"

# 5. Hapus backup S3 yang lebih lama dari retention
aws s3 ls "s3://${S3_BUCKET}/backups/" | \
  awk '{print $4}' | \
  while read -r file; do
    file_date=$(echo "$file" | grep -oP '\d{8}' | head -1)
    if [[ -n "$file_date" ]]; then
      age_days=$(( ($(date +%s) - $(date -d "${file_date}" +%s)) / 86400 ))
      if (( age_days > RETENTION_DAYS )); then
        aws s3 rm "s3://${S3_BUCKET}/backups/${file}"
        echo "[$(date)] Deleted old backup: ${file}"
      fi
    fi
  done

echo "[$(date)] Backup complete"

# 6. Kirim notifikasi (Slack / PagerDuty)
curl -s -X POST "${SLACK_WEBHOOK}" \
  -H 'Content-type: application/json' \
  --data "{\"text\": \"✅ DB Backup success: ${BACKUP_FILE} (${BACKUP_SIZE})\"}"
```

### Crontab
```bash
# Backup setiap hari jam 2 pagi
0 2 * * * /usr/local/bin/backup-db.sh >> /var/log/db-backup.log 2>&1

# Backup setiap 6 jam untuk RPO lebih ketat
0 */6 * * * /usr/local/bin/backup-db.sh >> /var/log/db-backup.log 2>&1
```

---

## Recovery Procedures

### Restore Full Database
```bash
# Step 1: Stop aplikasi (prevent write selama restore)
# Step 2: Drop dan recreate database
psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'mydb';"
psql -c "DROP DATABASE IF EXISTS mydb;"
psql -c "CREATE DATABASE mydb OWNER myuser;"

# Step 3: Restore
pg_restore \
  --dbname=mydb \
  --jobs=4 \
  --verbose \
  backup_20260115_120000.dump

# Step 4: Verifikasi
psql -d mydb -c "SELECT COUNT(*) FROM orders;"
psql -d mydb -c "SELECT MAX(created_at) FROM orders;"

# Step 5: Start aplikasi
```

### Restore Tabel Tertentu (Surgical Recovery)
```bash
# Skenario: tabel users ter-truncate tidak sengaja

# Step 1: Restore ke database temporary
pg_restore \
  --dbname=mydb_recovery \
  --table=users \
  backup_20260115_120000.dump

# Step 2: Compare dan merge
psql -c "
  INSERT INTO mydb.users
  SELECT r.* FROM mydb_recovery.users r
  WHERE NOT EXISTS (SELECT 1 FROM mydb.users u WHERE u.id = r.id);
"

# Step 3: Drop temporary database
psql -c "DROP DATABASE mydb_recovery;"
```

### Point-in-Time Recovery
```bash
# Skenario: data corrupt / ter-delete jam 14:30, perlu recover ke 14:25

# Step 1: Stop PostgreSQL
pg_ctl stop

# Step 2: Restore base backup
rm -rf /var/lib/postgresql/data
tar -xzf /backups/base_20260115.tar.gz -C /var/lib/postgresql/

# Step 3: Konfigurasi recovery
cat >> /var/lib/postgresql/data/postgresql.conf << EOF
restore_command = 'aws s3 cp s3://backup-bucket/wal/%f %p'
recovery_target_time = '2026-01-15 14:25:00+07'
recovery_target_action = 'promote'
EOF

touch /var/lib/postgresql/data/recovery.signal

# Step 4: Start dan monitor
pg_ctl start
tail -f /var/log/postgresql/postgresql.log
# Tunggu: "recovery stopping before commit of transaction..."
# Lalu: "database system is ready to accept connections"

# Step 5: Verifikasi data
psql -c "SELECT COUNT(*), MAX(created_at) FROM orders;"
```

---

## Monitoring Backup Health

```sql
-- Cek status WAL archiver
SELECT
  archived_count,
  last_archived_wal,
  last_archived_time,
  failed_count,
  last_failed_wal,
  last_failed_time,
  now() - last_archived_time AS time_since_last_archive
FROM pg_stat_archiver;

-- Alert jika archiving gagal atau terlalu lama
-- time_since_last_archive > 5 menit → investigasi
-- failed_count meningkat → archive_command bermasalah
```

```bash
# Script monitoring backup (jalankan via cron, alert jika gagal)
#!/bin/bash

# Cek backup terbaru di S3
LATEST_BACKUP=$(aws s3 ls "s3://${S3_BUCKET}/backups/" | sort | tail -1)
LATEST_DATE=$(echo "$LATEST_BACKUP" | awk '{print $1}')
BACKUP_AGE_HOURS=$(( ($(date +%s) - $(date -d "$LATEST_DATE" +%s)) / 3600 ))

if (( BACKUP_AGE_HOURS > 25 )); then
  # Alert: backup lebih dari 25 jam yang lalu
  curl -s -X POST "${PAGERDUTY_WEBHOOK}" \
    --data "{\"message\": \"🚨 DB backup is ${BACKUP_AGE_HOURS}h old! Last: ${LATEST_DATE}\"}"
  exit 1
fi

echo "Backup health OK. Latest: ${LATEST_DATE} (${BACKUP_AGE_HOURS}h ago)"
```

---

## Checklist Backup & Recovery

```
Setup:
□ Backup otomatis terjadwal (minimal harian)
□ WAL archiving aktif untuk PITR
□ Backup disimpan di lokasi berbeda (off-site / region lain)
□ Backup dienkripsi
□ Alert jika backup gagal atau lebih dari 25 jam tidak ada backup

Testing (minimal bulanan):
□ Test restore ke environment terpisah
□ Verifikasi data integrity setelah restore
□ Ukur waktu restore (update RTO documentation)
□ Test PITR ke timestamp tertentu
□ Dokumentasikan runbook recovery

Monitoring:
□ pg_stat_archiver dipantau
□ Ukuran backup dipantau (anomali = masalah)
□ Replication lag dipantau (jika pakai replica)
□ Disk space untuk WAL dipantau

Dokumentasi:
□ RTO dan RPO didokumentasikan
□ Runbook recovery ada dan up-to-date
□ Kontak on-call untuk incident tersedia
□ Recovery test terakhir didokumentasikan
```
