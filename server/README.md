# IPTV Server

Backend + frontend IPTV berbasis **Node.js + Express + MySQL**. Menggantikan versi
lama yang 100% client-side (fetch M3U di browser + localStorage). Sekarang:

- **Database MySQL** (`iptv` @ 192.168.18.142) sebagai sumber kebenaran channel.
- **Importer** menggabungkan beberapa sumber M3U (dedup via hash URL).
- **Health-checker** mengecek tiap URL stream (HTTP manifest check) dan menandai
  channel mati → **hanya channel `active` yang ditampilkan**.
- **REST API** menyajikan channel aktif; **frontend di-serve backend** (satu deploy).

## Arsitektur
```
sumber M3U (index.m3u lokal + iptv-org Indonesia)
      │  importer (parse + gabung + dedup)
      ▼
  MySQL iptv (iptv_channels, iptv_sources, iptv_check_logs)   user: iptv (hanya DB iptv)
      ▲                       │
      │ health-checker        │ REST API  →  frontend (hanya status='active')
      │ (cron 30 mnt)         ▼
      │ update status   http://<host>:4300
```

## Endpoint
| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/channels?category=&country=&search=&limit=&offset=` | Channel **aktif** saja |
| GET | `/api/channels/:id` | Detail channel aktif |
| GET | `/api/categories` | Kategori (punya channel aktif) |
| GET | `/api/countries` | Negara (punya channel aktif) |
| GET | `/api/stats` | Ringkas status katalog |
| GET | `/health` | Health check |
| GET | `/api/admin/sources` | Daftar sumber (butuh `x-admin-token` bila `ADMIN_TOKEN` diset) |
| POST | `/api/admin/import` | Trigger import sekarang |
| POST | `/api/admin/check` | Trigger health-check sekarang |
| POST | `/api/admin/sources` | Tambah sumber M3U baru |

## Setup lokal
```bash
cd server
cp .env.example .env      # isi DB_PASS user iptv
npm install
npm run migrate           # buat tabel (idempotent)
npm run seed-sources      # seed sumber awal
npm run import            # gabung + simpan channel
npm run check             # cek mati/hidup → set status
npm start                 # http://localhost:4300
```

## Deploy (Docker, mis. server 192.168.18.141)
```bash
cd server
# .env berisi kredensial DB iptv (TIDAK ikut ke image; dibaca compose via env_file)
docker compose up -d --build
# container: migrate + seed idempotent saat start, lalu server + scheduler
#   scheduler: import tiap 6 jam, health-check tiap 30 menit
docker compose logs -f iptv-server
```

## Database
- Server: `192.168.18.142` · database `iptv` · user `iptv` (**GRANT hanya `iptv.*`**).
- Tabel: `iptv_channels`, `iptv_sources`, `iptv_check_logs` (schema di `scripts/schema.sql`).

## Env penting (`.env`)
| Var | Default | Keterangan |
|---|---|---|
| `PORT` | 4300 | port HTTP |
| `DB_*` | — | koneksi MySQL iptv |
| `CHECK_TIMEOUT_MS` | 8000 | timeout cek per channel |
| `CHECK_CONCURRENCY` | 20 | jumlah cek paralel |
| `CHECK_FAIL_THRESHOLD` | 2 | gagal beruntun sebelum ditandai `dead` |
| `CHECK_CRON` | `*/30 * * * *` | jadwal health-check |
| `IMPORT_CRON` | `0 */6 * * *` | jadwal import |
| `RUN_ON_START` | true | jalankan import+check ~30s setelah start |
| `ADMIN_TOKEN` | (kosong) | bila diisi, endpoint `/api/admin/*` butuh header `x-admin-token` |

## Menambah sumber channel
```bash
curl -X POST http://<host>:4300/api/admin/sources \
  -H 'Content-Type: application/json' \
  -d '{"name":"Free-TV ID","url":"https://.../playlist.m3u8","countryCode":"ID","priority":50}'
curl -X POST http://<host>:4300/api/admin/import   # tarik + gabung
```
