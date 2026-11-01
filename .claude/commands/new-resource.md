Buat resource CRUD baru untuk backend `api/<modul>` UINSGD (gunakan agent `resource-generator`).

Nama resource yang diminta: **$ARGUMENTS**

Sebelum membuat file, tanyakan informasi berikut:
1. **Nama tabel MySQL** yang akan digunakan (e.g. `tbs_jenis_kendaraan`)
2. **Kolom-kolom utama** tabel tersebut beserta tipe datanya
3. **Nomor `ids_modul`** untuk resource ini — cek di tabel `tbs_modul` database
4. **URL path** (kebab-case) yang akan digunakan di router (e.g. `jenis-kendaraan`)

Tanyakan juga **modul tujuan** (master, sarpras, damba, …). Untuk **api/sarpras** cukup tambah entri `config/resources.js` + migrasi `tbs_modul`/`tbs_hak_akses`.

Untuk modul lain, setelah info terkumpul buat 4 file berikut mengikuti pola `api/master/controllers/modul.js`:

1. `routes/$ARGUMENTS.js`
2. `controllers/$ARGUMENTS.js`
3. `middleware/$ARGUMENTS.js`
4. `validation/$ARGUMENTS.js`

Kemudian tampilkan snippet yang harus ditambahkan ke `server.js` untuk mendaftarkan route baru.

**Jika nama resource mengandung underscore** (e.g. `jenis_kendaraan`), gunakan kebab-case untuk URL path (`jenis-kendaraan`) dan ikuti konvensi penamaan variabel yang ada di server.js (e.g. `jenis_kendaraanRoutes`).
