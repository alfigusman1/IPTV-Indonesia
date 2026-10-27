# Backend Express UINSGD (`api/<modul>`) — Pola Nyata

Node 20 · Express (4/5) · `mysql2` SQL mentah (tanpa ORM) · Redis (opsional, `REDIS_ACTIVE=ON`) · MinIO (S3) ·
eslint airbnb-base · Docker multi-stage (`--target production`). Ikuti pola modul yang sedang dikerjakan.

## 1. Struktur repo

```
server.js            # middleware global, rate limit, mount router di /<modul>, /health
routes/<x>.js        # isAuth → paramsid → validation → Controller.method
controllers/<x>.js   # const Controller = {}; ... module.exports = Controller;
middleware/          # isAuth.js (JWT + sesi tbs_jwt/Redis), validasi per resource, params-id.js
helpers/             # helper.js (runSQL, addCondition*, getPagination, upload), response.js (scXXX)
validation/is-empty.js
databases/ | sql/    # file migrasi SQL
k8s/, .circleci/, Dockerfile
```
Referensi kanonik: `api/master/controllers/modul.js` (controller manual), `api/sarpras/helpers/crud.js`
(factory CRUD + registry `config/resources.js`).

## 2. Kontrak respons

```json
{ "code": 200, "status": "success", "message": "", "data": { "data": [...], "pagination": { "totaldata": 843, "totalpagination": 43, "currentpage": 2 } } }
```
- Selalu lewat `response.sc200/sc400/sc401/sc403/sc404/sc409/sc500(message, data, res)`.
- List 0 baris cocok filter → **404 "Data not found."** (konvensi lama, frontend memperlakukannya sbg kosong).
- Query string list: `page`, `limit`, `order_by="kolom ASC|DESC"`, filter per kolom (`IN` = koma, `LIKE`, `BETWEEN a,b`).

## 3. Auth, sesi, ACL

- `isAuth`: header `Authorization: Bearer <jwt>`; verifikasi `jwt.verify(..., { algorithms: ['HS256'] })` +
  sesi aktif di `tbs_jwt` (`SESSIONS=DATABASE`) atau Redis. Mengisi `req.authIdsUser`, `req.authIdsLevel`, dst.
- Token modul diterbitkan lewat SSO dari token master (`/auth/sso`, mapping `tbs_sso_mapping`).
- ACL: `checkAccess(req, idsModul, 'read'|'create'|'update'|'delete'|'single'|<granular>)` ke
  `tbs_hak_akses`. Gagal → **403** "Access denied." (401 khusus token: pesan wajib mengandung "token").
- Scoping baris per unit (sarpras): klaim `ids_unit` di token → filter otomatis di `createCrud`.
- Endpoint publik: tanpa `isAuth` atau `optionalAuth` (respons berjenjang, data pribadi butuh permission granular).
- Jangan pernah membuat endpoint yang menerbitkan token tanpa autentikasi.

## 4. Query aman

```js
const orderBy = await helper.safeOrderBy(view, req.query.order_by, 'date_created DESC'); // allow-list kolom
const limit = helper.clampLimit(req.query.limit, 10, 1000);
helper.addConditionToQueries(queries, 'kode_barang', req.query.kode_barang, 'LIKE');
const rows = await helper.runSQL({ sql: `${queries.sqlRead} ORDER BY ${orderBy} LIMIT ?, ?`, param: [...queries.params, off, limit] });
```
- Nama tabel/kolom dalam template string hanya dari konstanta kode, tidak pernah dari input.
- Multi-langkah tulis → `helper.withTransaction(async q => { ... })` (sarpras) atau `connection.beginTransaction`.
- Data aset: soft delete (`deleted_at`) + audit (`helpers/audit.js`, `tbsar_audit_log`) dalam transaksi yang sama.
- Massal: set-based SQL / batch multi-row 500, bukan loop per baris.

## 5. Integrasi antar-modul

- Data milik modul lain → REST API modul tsb dengan token dari `tbs_token_aplikasi`
  (pola: `api/sipukt/helpers/application-auth.js` + `helpers/master.js`; `api/beasiswa/helpers/tokenAplikasi.js`).
- Dilarang query lintas schema (`` `prod_master`.`tbs_x` ``) — grant prod tidak mengizinkan.
- API baca-saja untuk sistem luar: kunci API ber-hash (contoh `api/sarpras/controllers/apiClient.js`, header `X-Api-Key`).

## 6. File, Excel, PDF

- Upload MinIO: `helper.upload(folder, allowedExt)` (multer-s3, `contentType` eksplisit, `contentDisposition: inline`,
  batas ukuran). Folder → modul ACL (`api/sarpras/routes/aws.js`). Objek privat (impor, PDF resmi) lewat
  `PutObjectCommand` ACL `private` + unduh via API.
- Excel: `xlsx` (SheetJS CDN tarball) — harus di `dependencies` bila dipakai runtime. Contoh registry impor/ekspor:
  `api/sipukt/helpers/{importRegistry,exportRegistry,excelImport,excelExport}.js`; parser header fleksibel:
  `api/sarpras/helpers/siman.js`.
- PDF resmi dibuat server: `pdfkit` (`api/sarpras/helpers/pdf.js`, `api/sipukt/helpers/pdf.js`). Proses berat
  (ratusan foto) → async: simpan status `PROSES`, kerjakan di `setImmediate`, status `SELESAI/GAGAL`.

## 7. Lint, test, rilis

- airbnb-base: tanpa `for...of`+`continue`, tanpa `await` di loop (pakai `reduce` berantai/`Promise.all`),
  `const { X } = process.env`. `npx eslint .` sebelum commit (CI menjalankan hal sama).
- Test: jest (`__tests__/`), mock `config/database`/`redis`/`aws` untuk unit test helper.
- Rilis: pull → bump `package.json` → `docker build --target production -t uinsgd/backend-<x>:local .` →
  `cd deploy/local && bash prepare-env.sh && docker compose -f docker-compose.backend.yml up -d --force-recreate backend-<x>`
  → `curl localhost:<port>/health` + uji endpoint baru → push `master`.
- Komentar kode pendek & fungsional; riwayat/alasan insiden disimpan di memory, bukan di kode.
