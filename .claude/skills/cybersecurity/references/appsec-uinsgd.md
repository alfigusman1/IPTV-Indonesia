# AppSec UINSGD — Model Ancaman, Temuan Berulang, Cara Audit

Sistem akademik & administrasi kampus: SSO (Keycloak → api/master), 8 backend Express, superapps SvelteKit,
data pribadi mahasiswa/pegawai, keuangan (UKT, VA bank), aset BMN. Penyerang realistis: mahasiswa/pegawai yang
sudah login (insider dengan akun sah), publik internet untuk endpoint publik/penyewa.

## 1. Permukaan serangan utama

| Area | Risiko kunci |
|---|---|
| SSO & token | mint token tanpa auth, refresh token menandatangani payload klien, login-CSRF/session fixation callback SSO, JWT tanpa pin algoritma |
| ACL | halaman/endpoint admin hanya `isAuth` tanpa `checkAccess`; level mahasiswa ter-grant permission tulis; hardcode nama level |
| Query | `ORDER BY ${input}`, kolom filter dinamis, LIMIT tanpa batas, query lintas schema |
| IDOR | aksi pada record milik user lain (ujian CBT, formulir UKT, unit aset) tanpa cek kepemilikan/scope unit |
| File | upload tanpa whitelist/ukuran/ACL ke bucket `public-read` (stored XSS via .html/.svg), hapus objek arbitrer |
| Proxy frontend | 401 diperlakukan salah (logout palsu / token objek ditulis ke cookie), backend dipanggil langsung dari browser |
| Infra | `trust proxy=true` → IP spoof; prod berbagi DB/akun dgn dev; secret di repo/image; CI tanpa Trivy |

## 2. Katalog temuan nyata (pola untuk dicari ulang)

- `POST /auth/token/create` mint JWT tanpa autentikasi di 5 backend (dihapus 2026-09-23); refresh token
  self-escalation (payload kini dibangun ulang dari DB).
- Session fixation `/auth/keycloak` (ditutup dgn nonce/state).
- Mahasiswa mengakses halaman admin superapps (guard per-halaman `isModuleRouteAllowed` + migrasi ACL).
- SIPUKT: mahasiswa bisa set UKT sendiri (permission level 27), write handler tanpa scope.
- CBT: token Damba hardcode, endpoint debug tanpa auth, IDOR tes.js, SQLi `hasil-ujian`, kunci jawaban bocor.
- Sarpras: SQLi `order_by` publik `/objek-sewa/public` + CRUD generik, upload/hapus tanpa ACL (diperbaiki 3.0.0).

Grep cepat saat audit modul baru:
```
grep -rn "ORDER BY \${" controllers helpers
grep -rn "jwt.sign(" controllers | grep -v "algorithm"
grep -rn "router\.\(get\|post\|put\|delete\)(" routes | grep -v "isAuth\|optionalAuth\|requireKey"
grep -rn "acl: 'public-read'" helpers
grep -rn "prod_\w*\`\.\|\${.*SCHEMA" controllers helpers
```

## 3. Aturan uji

- **Read-only dulu.** PoC eksploit hanya di salinan DB (`tmp_*`) / container lokal yang diarahkan ke salinan.
  `dev_sarpras`, `dev_ppid` = produksi; DB server 192.168.18.181 dipakai bersama.
- Jangan menjalankan payload `SLEEP`/blind SQLi ke endpoint yang memakai DB produksi.
- Bukti = `file:baris` + request/response dari lingkungan uji. Bedakan "terbukti" vs "dari pembacaan kode".
- Perubahan kode keamanan besar WAJIB lewat build Docker + uji container sebelum push (pernah menjatuhkan prod).

## 4. Format laporan (Bahasa Indonesia)

```
## [SEC-NN] Judul singkat
Severity: KRITIKAL/TINGGI/SEDANG/RENDAH · CVSS 3.1: x.x (vektor) · CWE-xxx
Lokasi: api/<modul>/controllers/x.js:42 (route publik/terautentikasi?)
Dampak: apa yang bisa dicapai penyerang realistis (mahasiswa login / publik)
Bukti: kode / request uji (lingkungan mana)
Perbaikan: perubahan konkret + titik terpusat bila pola berulang (helper/factory)
```
Urutkan dari paling berisiko; pisahkan temuan yang perlu keputusan user (perubahan perilaku produksi, data).

## 5. Kontrol yang sudah menjadi standar proyek

- `jwt.verify(..., { algorithms: ['HS256'] })` + sesi di `tbs_jwt`/Redis.
- 401 hanya untuk token (pesan mengandung "token"), 403 untuk izin.
- `safeOrderBy` / `clampLimit` / `withTransaction` / audit log append-only (sarpras sebagai acuan).
- Upload: folder → modul ACL, whitelist ekstensi, batas ukuran; dokumen resmi privat.
- CI: eslint + jest + `npm audit --omit=dev --audit-level=high` + Trivy CRITICAL.
