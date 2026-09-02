# IPTV Indonesia - Live TV Streaming Website

> ⚠️ **v2 (2026-09):** Arsitektur pindah ke **backend + database**. Aplikasi aktif ada di
> **[`server/`](server/README.md)** — Node.js + Express + MySQL, dengan **health-checker**
> yang menyaring channel mati (hanya channel `active` yang tampil) dan **frontend di-serve
> backend**. Dokumen di bawah ini menjelaskan versi lama (100% client-side, localStorage)
> yang kini **digantikan** oleh `server/` (file lama `assets/js/channels*.js`,
> `app-advanced.js`, `playlist-management.html`, `script.py` sudah usang).
> Sumber channel awal (`index.m3u`) kini juga tersalin di `server/data/index.m3u`.

---

Website modern untuk streaming IPTV dengan desain responsif dan fitur-fitur lengkap.

## 🎯 Fitur Utama

### UI/UX

- ✅ Desain modern dengan tema dark (Netflix-inspired)
- ✅ Responsive untuk semua device (mobile, tablet, desktop)
- ✅ Grid layout adaptif menggunakan Bootstrap 5
- ✅ Animasi smooth dan hover effects
- ✅ Search & filter channels
- ✅ Kategori berdasarkan negara dan jenis konten

### Video Player

- ✅ HLS.js untuk streaming m3u8 (kompatibilitas maksimal)
- ✅ Video.js sebagai fallback player
- ✅ Error handling untuk channel offline
- ✅ Auto-retry mechanism (3x retry)
- ✅ Loading indicator saat buffering
- ✅ Fullscreen support
- ✅ Volume control

### Data Management

- ✅ LocalStorage untuk menyimpan favorit & settings
- ✅ JSON file untuk daftar channel
- ✅ Tidak memerlukan database
- ✅ Import/export playlist m3u8
- ✅ Channel status monitoring

### Channel Sources

- ✅ 10+ channel default dari berbagai negara
- ✅ Support IPTV-Org (8000+ channels worldwide)
- ✅ Support Free-TV playlist
- ✅ Support custom m3u8 URL
- ✅ Multi-negara (Indonesia, USA, UK, France, Germany, dll)

## 🚀 Teknologi yang Digunakan

### Frontend

- HTML5
- CSS3 dengan custom design system
- JavaScript (Vanilla ES6+)
- Bootstrap 5 untuk responsive layout
- Bootstrap Icons

### Video Player

- HLS.js - Library untuk HLS streaming
- Video.js - HTML5 video player framework

### Storage

- LocalStorage API untuk data persisten
- JSON format untuk channel data

## 📁 Struktur Project

```
IPTV-Indonesia/
├── index.html              # File HTML utama
├── assets/
│   ├── css/
│   │   └── style.css      # Custom styling
│   ├── js/
│   │   ├── app.js         # Main application logic
│   │   ├── player.js      # Video player management
│   │   └── channels.js    # Channel data management
│   └── images/
│       ├── logo.png       # Logo aplikasi
│       └── placeholder.jpg # Placeholder image
└── data/
    └── channels.json      # Channel database (opsional)
```

## 🔧 Instalasi & Setup

### 1. Download Project

```bash
git clone https://github.com/username/IPTV-Indonesia.git
cd IPTV-Indonesia
```

### 2. Setup Files

Pastikan semua file ada di struktur folder yang benar:

- `index.html` di root folder
- `assets/css/style.css` untuk styling
- `assets/js/app.js`, `player.js`, `channels.js` untuk JavaScript

### 3. Jalankan Aplikasi

Buka `index.html` di web browser modern (Chrome, Firefox, Safari, Edge).

**Catatan:** Untuk development lokal, disarankan menggunakan local server:

```bash
# Menggunakan Python
python -m http.server 8000

# Menggunakan Node.js (http-server)
npx http-server

# Menggunakan PHP
php -S localhost:8000
```

Lalu akses di browser: `http://localhost:8000`

## 📖 Cara Menggunakan

### 1. Menonton Channel

- Klik pada card channel untuk mulai streaming
- Video player akan otomatis memuat dan memutar channel
- Gunakan kontrol player untuk pause/play, volume, fullscreen

### 2. Mencari Channel

- Gunakan search box untuk mencari nama channel
- Filter berdasarkan negara menggunakan dropdown "Negara"
- Filter berdasarkan kategori (Berita, Hiburan, Olahraga, dll)

### 3. Favorit Channel

- Klik icon hati (♥) pada card channel untuk menambah ke favorit
- Klik tombol "Favorit" di navbar untuk melihat channel favorit saja

### 4. Import Playlist M3U8

- Klik tombol "Import" di navbar
- Masukkan URL playlist M3U8, atau
- Upload file M3U8 dari komputer
- Klik "Import" untuk menambahkan channel ke daftar

### 5. Menambah Channel dari IPTV-Org

Gunakan URL berikut untuk import channel dari berbagai negara:

**Indonesia:**

```
https://iptv-org.github.io/iptv/countries/id.m3u
```

**USA:**

```
https://iptv-org.github.io/iptv/countries/us.m3u
```

**UK:**

```
https://iptv-org.github.io/iptv/countries/gb.m3u
```

**Seluruh Dunia (8000+ channels):**

```
https://iptv-org.github.io/iptv/index.m3u
```

Lihat daftar lengkap di: https://github.com/iptv-org/iptv

## 🛠️ Kustomisasi

### Menambah Channel Default

Edit file `assets/js/channels.js` bagian `getDefaultChannels()`:

```javascript
{
    id: 'custom-001',
    name: 'Nama Channel',
    country: 'Indonesia',
    countryCode: 'ID',
    category: 'news', // news, entertainment, sports, music, kids, movies, general
    logo: 'https://url-logo.png',
    url: 'https://url-stream.m3u8',
    status: 'unknown'
}
```

### Mengubah Warna Tema

Edit file `assets/css/style.css` bagian `:root`:

```css
:root {
  --primary-color: #e50914; /* Warna utama (merah Netflix) */
  --secondary-color: #221f1f; /* Warna sekunder */
  --dark-bg: #141414; /* Background gelap */
  --card-bg: #1f1f1f; /* Background card */
}
```

### Mengatur Retry Player

Edit file `assets/js/player.js`:

```javascript
this.maxRetries = 3; // Jumlah retry
this.retryDelay = 2000; // Delay antar retry (ms)
```

## 🐛 Troubleshooting

### Channel tidak bisa diputar

**Penyebab:**

- URL stream tidak valid atau offline
- CORS policy blocking
- Format stream tidak didukung

**Solusi:**

1. Cek URL stream di browser atau VLC Player
2. Gunakan CORS proxy jika diperlukan
3. Pastikan format adalah HLS (.m3u8)

### Player loading terus

**Penyebab:**

- Koneksi internet lambat
- Stream buffer penuh

**Solusi:**

1. Cek koneksi internet
2. Refresh halaman
3. Pilih channel lain

### Import M3U8 gagal

**Penyebab:**

- Format file tidak valid
- CORS policy saat load dari URL

**Solusi:**

1. Pastikan format M3U8 valid
2. Upload file langsung daripada dari URL
3. Gunakan CORS proxy untuk URL external

## 📝 Format M3U8

Contoh format playlist M3U8:

```
#EXTM3U
#EXTINF:-1 tvg-logo="logo.png" group-title="Berita",Metro TV
https://edge.medcom.id/live-edge/smil:metro.smil/playlist.m3u8
#EXTINF:-1 tvg-logo="logo.png" group-title="Berita",Kompas TV
https://stream-url.m3u8
```

## 🔒 Browser Compatibility

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+
- ✅ Opera 76+

**Mobile:**

- ✅ Chrome Mobile
- ✅ Safari iOS
- ✅ Samsung Internet

## 📱 Mobile Support

Website fully responsive dan optimized untuk:

- Smartphone (portrait & landscape)
- Tablet (iPad, Android tablets)
- Desktop (semua resolusi)

## ⚡ Performance Tips

1. **Gunakan CDN:** Library sudah menggunakan CDN untuk loading cepat
2. **Lazy Loading:** Channel card di-load secara bertahap
3. **LocalStorage:** Data disimpan lokal untuk akses cepat
4. **Optimize Images:** Gunakan logo channel dalam format WebP/PNG optimized

## 🤝 Contributing

Kontribusi sangat diterima! Silakan:

1. Fork repository
2. Buat branch fitur (`git checkout -b feature/AmazingFeature`)
3. Commit perubahan (`git commit -m 'Add some AmazingFeature'`)
4. Push ke branch (`git push origin feature/AmazingFeature`)
5. Buat Pull Request

## 📄 License

Project ini menggunakan MIT License - lihat file [LICENSE](LICENSE) untuk detail.

## 🙏 Credits

- [IPTV-Org](https://github.com/iptv-org/iptv) - Channel sources
- [HLS.js](https://github.com/video-dev/hls.js) - HLS streaming library
- [Video.js](https://videojs.com/) - Video player framework
- [Bootstrap 5](https://getbootstrap.com/) - CSS framework
- [Bootstrap Icons](https://icons.getbootstrap.com/) - Icon library

## 📞 Support

Jika ada pertanyaan atau masalah:

- Buat issue di GitHub
- Email: support@example.com
- Website: https://example.com

## 🔄 Update History

### Version 1.0.0 (2024)

- ✅ Initial release
- ✅ Support HLS.js & Video.js
- ✅ Import M3U8 playlist
- ✅ Favorites system
- ✅ Responsive design
- ✅ Error handling & retry mechanism

---
