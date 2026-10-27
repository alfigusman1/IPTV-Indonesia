# MySQL 8 di UINSGD — Konvensi & Jebakan Nyata

Server: **MySQL 8.0.46** @ `192.168.18.181:3306`. Klien lokal: `C:/xampp/mysql/bin/mysql.exe` / `mysqldump.exe`
(**klien MariaDB** — lihat jebakan §4). Kredensial ada di `api/<modul>/.env` (`DB_HOST/DB_USER/DB_PASS/DB_NAME`);
ambil dengan `grep '^DB_PASS='`, jangan `cat` seluruh `.env`.

## 1. Lingkungan & database

| Modul | DB dev | DB prod |
|---|---|---|
| master, damba(pmb), bank, beasiswa, sipukt, lms | `dev_*` | `prod_*` (terpisah) |
| **sarpras, ppid** | `dev_sarpras`, `dev_ppid` | **sama** (k8s memakai dev_*) |

Selalu cek `api/<modul>/k8s/02-secret.yaml` sebelum mengasumsikan ada `prod_*`. Migrasi ke `dev_sarpras`/`dev_ppid`
= langsung produksi → butuh persetujuan eksplisit user.

## 2. Konvensi skema

- Prefix tabel: `tbs_*` (setting/master/RBAC), `tbsar_*` (aset sarpras), `tbp_*`/`tbd_*` (pmb/damba);
  view: `view*_` (`viewsar_*`, `viewd_*`, `views_*`).
- PK: `ids_*` (tabel referensi/setting), `idsp_*` (entitas aset sarpras), `id_*` (tabel baru transaksi).
- Kolom audit standar: `created_by INT NOT NULL`, `date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  `updated_by INT NOT NULL` (tanpa default — aplikasi WAJIB mengisi), `date_updated ... ON UPDATE CURRENT_TIMESTAMP`.
- Flag: `status ENUM('YA','TIDAK')`. Soft delete aset: `deleted_at DATETIME NULL`, `deleted_by INT NULL`.
- RBAC: `tbs_modul`, `tbs_level`, `tbs_grup`, `tbs_hak_akses(ids_level, ids_modul, permission CSV)`.
  Permission granular boleh (mis. `lihat_pic`, `kunci`, `finalisasi`, `putuskan`).
- Charset tabel lama `utf8mb3_general_ci` — tabel baru samakan agar JOIN string tidak memicu konversi collation.
- Audit append-only (`tbsar_audit_log`, `*_histori`, `tbsar_opname_scan`): tanpa UPDATE/DELETE dari aplikasi.

## 3. DDL aman di MySQL 8

```sql
-- Kolom nullable / default konstan: metadata-only
ALTER TABLE t ADD COLUMN x INT NULL, ALGORITHM=INSTANT;
-- MODIFY tipe / NOT NULL / tambah UNIQUE: rebuild tabel (COPY/INPLACE) — murah hanya bila tabel kecil/kosong
ALTER TABLE t MODIFY COLUMN y INT NULL;   -- cek COUNT(*) dulu
```
- `ADD UNIQUE` gagal bila ada duplikat → cek `GROUP BY ... HAVING COUNT(*)>1` sebelum migrasi.
- UNIQUE mengizinkan banyak NULL (berguna utk kunci opsional mis. `(kode_barang, nup_siman)`).
- FK otomatis membuat indeks pada kolom anak; FK baru ke tabel besar = lock → jadwalkan.
- **VIEW membekukan daftar kolom saat dibuat** (`SELECT *` diekspansi). Setelah `ADD COLUMN`, recreate view yang
  perlu kolom baru (ambil `SHOW CREATE VIEW`, sisipkan kolom, `CREATE OR REPLACE VIEW`). Hapus prefix
  `` `nama_db`. `` dari definisi agar portabel ke DB salinan.
- `ONLY_FULL_GROUP_BY` aktif: kolom non-agregat boleh bila bergantung fungsional pada PK yang di-GROUP BY.
- `INSERT ... ON DUPLICATE KEY UPDATE x = VALUES(x)` masih jalan di 8.0 (deprecated) — boleh, konsisten dgn kode lama.

## 4. Backup & restore (jebakan klien MariaDB)

```bash
export MYSQL_PWD="$(grep -E '^DB_PASS=' .env | cut -d= -f2- | tr -d '"')"
/c/xampp/mysql/bin/mysqldump.exe -h 192.168.18.181 -u <user> --single-transaction --routines --triggers \
  --no-tablespaces <db> > backup.sql
```
- Dump/klien MariaDB menulis nilai untuk kolom **STORED GENERATED** (`tbs_sso_mapping.ids_grup_master_key`) →
  restore ke MySQL 8 gagal ERROR 3105. Saat restore: `grep -v '^INSERT INTO \`tbs_sso_mapping\`'`, lalu masukkan
  baris tabel itu dari file terpisah yang hanya berisi kolom non-generated.
- Restore gagal di tengah dapat meninggalkan DB tanpa view → selalu restore ke DB baru (`tmp_*`), bukan menimpa.

## 5. Alur migrasi wajib

1. File SQL di repo: `api/<modul>/databases/migration_vNN_<topik>.sql` (sarpras) atau `sql/YYYY-MM-DD_<topik>.sql`.
   Aditif; bagian INSERT referensi idempoten (`INSERT ... SELECT ... WHERE NOT EXISTS` / `ON DUPLICATE KEY`).
2. Bandingkan skema target (`information_schema.COLUMNS/STATISTICS/REFERENTIAL_CONSTRAINTS`) dgn asumsi migrasi;
   untuk ID referensi eksplisit, bandingkan isi tabel dev vs prod.
3. Backup tepat sebelum migrasi (§4).
4. Uji di salinan: `CREATE DATABASE tmp_x` → restore backup → jalankan semua migrasi berurutan → uji aplikasi
   (container lokal dgn `DB_NAME=tmp_x`). Hapus `tmp_x` setelah selesai.
5. Eksekusi ke DB target (izin user) → verifikasi (`SHOW TABLES`, hitung baris view kunci) → baru deploy kode.

## 6. Query & performa

- Kode aplikasi: SQL mentah `mysql2` parameterized. ORDER BY / nama kolom dari input → allow-list
  (`helper.safeOrderBy`), LIMIT dibatasi.
- COUNT pada view berat (subquery korelasi) → hitung dari tabel dasar bila tanpa filter.
- Operasi massal (impor ±90 ribu baris): set-based `INSERT ... SELECT` / `UPDATE ... JOIN` dalam satu transaksi,
  batch `INSERT` multi-row 500 baris; hindari loop per baris dari Node.
- `EXPLAIN ANALYZE` tersedia (8.0.18+). Indeks komposit urut kolom equality → range → sort.
- Akses data modul lain: **REST API modul pemiliknya** (`tbs_token_aplikasi`), bukan query lintas schema
  (grant user prod tidak mengizinkan, sudah pernah menyebabkan outage).
