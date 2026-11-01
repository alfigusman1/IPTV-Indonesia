# Svelte 5 + SvelteKit 2 di UINSGD (frontend/superapps)

Referensi praktis untuk stack frontend utama proyek. Prioritaskan pola di sini di atas pola React generik.

## 1. Reaktivitas Svelte 5 (runes)

```svelte
<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';

	let { config, embedded = false }: { config: CrudConfig; embedded?: boolean } = $props();
	let items = $state<Row[]>([]);
	const total = $derived(items.length);              // turunan: $derived, BUKAN $effect + assignment
	const dipilih = new SvelteSet<number>();            // koleksi reaktif (lint: svelte/prefer-svelte-reactivity)

	$effect(() => {
		void config.endpoint;                            // baca dependensi secara eksplisit
		fetchData();
		return () => controller.abort();                 // selalu cleanup listener/timer
	});
</script>
```

| Kebutuhan | Pola Svelte 5 | Hindari |
|---|---|---|
| State lokal | `$state` | variabel biasa (tidak reaktif) |
| Nilai turunan | `$derived` / `$derived.by` | `$effect` yang meng-assign state |
| Koleksi mutable | `SvelteSet`, `SvelteMap` | `new Set()` + re-assign |
| State lintas komponen | modul `*.svelte.ts` (`src/lib/stores/*-auth.svelte.ts`) | store writable baru tanpa alasan |
| Props | `$props()` + tipe eksplisit | `export let` (Svelte 4) |
| Event | atribut `onclick={...}` | `on:click` (Svelte 4) |
| List | `{#each items as it (it.id)}` (WAJIB key) | `{#each}` tanpa key |

Data tabel non-reaktif (mis. cache debounce scanner) cukup objek biasa `Record<string, number>`.

## 2. Arsitektur data & auth

- Browser **tidak pernah** memanggil `api/*` langsung. Semua lewat proxy SvelteKit:
  `src/routes/api/<modul>/[...path]/+server.ts` (JSON) — token modul diambil dari cookie httpOnly / `locals`.
  Unduhan biner & multipart: route khusus (mis. `src/routes/api/sarpras/raw/[...path]/+server.ts`,
  `api/sarpras/aws/upload/[folder]/+server.ts`).
- Token modul (`token_sarpras`, `token_ppid`, …) ditukar dari token master di **`hooks.server.ts handle()`**.
  - JANGAN `cookies.set()` di `load` setelah `await` lambat → prod error
    "Cannot use cookies.set(...) after the response has been generated".
  - JANGAN impor `$env/dynamic/*` di `hooks.server.ts` (adapter-node TLA deadlock → container exit 13).
    Di hooks pakai `$env/static/*` atau `process.env`.
- Tanpa sesi master yang sah, hooks menghapus semua cookie modul (disengaja).
- Proxy server-side memakai `PUBLIC_<MODUL>_API_BASE_URL` = DNS container di lokal
  (`http://backend-sarpras:5005/sarpras`); master/damba dipakai client-side → `localhost`.

## 3. Penanganan error HTTP (konvensi backend UINSGD)

| Status | Arti | Perilaku frontend |
|---|---|---|
| 401 + pesan mengandung "token" | sesi/token tidak valid | `isSessionInvalidMessage()` (`src/lib/services/api-errors.ts`) → `handleFetch` bersihkan cookie → redirect `/login?error=session_expired` |
| 401/403 "Access denied." | hak akses kurang, sesi masih valid | toast error / `AccessDeniedDialog`, JANGAN logout |
| 404 pada list | 0 baris cocok filter (konvensi `helpers/crud.js`) | tampilkan tabel kosong, bukan toast error |
| 409 | konflik (masih dipakai, duplikat) | tampilkan pesan backend apa adanya |

Proxy yang menukar ulang token setelah 401 wajib memakai `result.token`, bukan objek hasil exchange.

## 4. Akses halaman & menu (ACL dinamis)

- Peta `href → ids_modul` di `src/lib/config/menu/<modul>.ts` (`*_MENU_MODUL`).
- Sidebar difilter dari `GET /api/<modul>/hak-akses/my-moduls`; halaman dijaga di `+layout.server.ts`
  memakai `isModuleRouteAllowed` (`src/lib/server/moduleAccessGuard.ts`). Jangan hardcode nama level.
- Halaman baru di grup `(app)/<modul>/` WAJIB didaftarkan di `*_MENU_MODUL` agar ikut ter-guard.

## 5. Halaman CRUD config-driven (sarpras)

- `CrudConfig` di `src/lib/config/sarpras/resources.ts` + `CrudPage.svelte`; route dinamis `(app)/sarpras/[resource]`.
- Opsi: `rowActions`, `headerActions`, `detailChildren`, `detailFileResource`, `softDelete` (toggle "Lihat Terhapus"
  + aksi Pulihkan), `disableCreate/noEdit/noDelete`.
- Halaman kustom (dashboard, scanner, cetak) cukup impor `$lib/components/sarpras/bmn.css` + helper
  `$lib/services/sarpras/bmn.ts` (`api`, `list`, `upload`, `rawUrl`, `compressImage`).

## 6. Offline & PWA terbatas

- Antrian offline per fitur di IndexedDB (contoh: `src/lib/services/sarpras/opname-queue.ts`), idempoten lewat
  `client_uuid` (crypto.randomUUID) — server menolak duplikat, retry aman.
- Service worker HANYA ber-scope sempit (`/sarpras-opname-sw.js`, scope `/sarpras/opname/`), jangan SW global
  untuk seluruh superapps (banyak modul, risiko cache sesi).

## 7. Lint & verifikasi

- ESLint 10 (flat config): aturan `svelte/require-each-key`, `svelte/prefer-svelte-reactivity`,
  `svelte/no-navigation-without-resolve` (pakai `resolve('/(app)/...', params)`; link API/unduhan →
  `<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->`). Formatter `unix/compact` tidak tersedia.
- `svelte-check` punya error lama (tipe ikon lucide di `config/menu/*`, `src/lib/template/*`) → bandingkan
  jumlah dengan baseline; jangan menambah error baru di file yang disentuh.
- Rilis: `npm run build` → `docker build` LANGSUNG di folder repo dengan build-arg lokal (compose tidak punya
  `build:`, `docker compose build` = no-op) → cek image ID berubah → `docker compose ... up -d --force-recreate`
  → `docker exec frontend-superapp grep -rl "<penanda>" build`.

## 8. Cetak & dokumen

- Cetak label/laporan sederhana: CSS `@page` + `@media print` di halaman (ukuran dalam `mm`).
- Dokumen resmi (DBR, berita acara): dibuat **server-side** (pdfkit di backend), frontend hanya membuka lewat
  proxy raw. Jangan generate PDF resmi di browser.
