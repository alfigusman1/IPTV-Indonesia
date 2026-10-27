# Accessibility (a11y) Patterns Reference

## WCAG 2.1/2.2 — Level AA Checklist

```
Perceivable:
□ Semua gambar non-dekoratif punya alt text yang bermakna
□ Gambar dekoratif pakai alt="" (kosong) agar screen reader skip
□ Video punya caption/subtitle
□ Kontras warna teks minimum 4.5:1 (normal), 3:1 (large text / UI component)
□ Tidak ada informasi yang disampaikan lewat warna saja

Operable:
□ Semua fungsi bisa diakses via keyboard
□ Tidak ada keyboard trap (user bisa keluar dari komponen manapun)
□ Focus indicator visible dan jelas
□ Skip navigation link tersedia (loncat ke main content)
□ Tidak ada konten yang berkedip > 3x per detik

Understandable:
□ Bahasa halaman didefinisikan: <html lang="id">
□ Label form jelas dan deskriptif
□ Error message spesifik dan memberi tahu cara memperbaiki
□ Tidak ada perubahan konteks yang tidak diharapkan saat focus/input

Robust:
□ Semantic HTML dipakai dengan benar
□ ARIA hanya dipakai kalau HTML native tidak cukup
□ Status message diumumkan ke screen reader (role="status" / aria-live)
```

---

## Semantic HTML — Selalu Utamakan Ini

```html
<!-- ✅ Gunakan elemen HTML yang tepat sebelum pakai ARIA -->

<!-- Navigasi -->
<header>
  <nav aria-label="Navigasi utama">
    <ul>
      <li><a href="/home">Beranda</a></li>
      <li><a href="/about">Tentang</a></li>
    </ul>
  </nav>
</header>

<!-- Main content -->
<main id="main-content">
  <h1>Judul Halaman</h1>

  <article>
    <h2>Judul Artikel</h2>
    <p>Konten...</p>
  </article>

  <aside aria-label="Artikel terkait">
    <!-- sidebar content -->
  </aside>
</main>

<footer>
  <nav aria-label="Navigasi footer">...</nav>
</footer>

<!-- ❌ Jangan pakai div/span untuk semua hal -->
<div class="nav">...</div>        <!-- ❌ -->
<nav aria-label="Utama">...</nav> <!-- ✅ -->

<div class="button" onclick="...">Klik</div>  <!-- ❌ tidak keyboard accessible -->
<button type="button">Klik</button>           <!-- ✅ -->
```

---

## ARIA — Gunakan Dengan Benar

### Aturan Utama ARIA
```
1. Jangan gunakan ARIA kalau HTML native bisa melakukannya
2. Jangan ubah semantik native HTML yang sudah benar
3. Semua interactive ARIA element harus bisa diakses via keyboard
4. Jangan sembunyikan elemen focusable dari screen reader
5. Semua interactive element harus punya accessible name
```

### ARIA Roles yang Sering Dipakai
```html
<!-- Dialog / Modal -->
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="dialog-title"
  aria-describedby="dialog-desc"
>
  <h2 id="dialog-title">Konfirmasi Hapus</h2>
  <p id="dialog-desc">Data yang dihapus tidak bisa dikembalikan.</p>
  <button>Hapus</button>
  <button>Batal</button>
</div>

<!-- Alert / Notifikasi penting -->
<div role="alert">
  Pembayaran berhasil diproses.
</div>

<!-- Status update yang tidak urgent -->
<div role="status" aria-live="polite">
  3 hasil ditemukan.
</div>

<!-- Tabs -->
<div role="tablist" aria-label="Pengaturan akun">
  <button role="tab" aria-selected="true" aria-controls="panel-profil" id="tab-profil">
    Profil
  </button>
  <button role="tab" aria-selected="false" aria-controls="panel-keamanan" id="tab-keamanan">
    Keamanan
  </button>
</div>
<div role="tabpanel" id="panel-profil" aria-labelledby="tab-profil">
  Konten profil...
</div>

<!-- Accordion -->
<button
  aria-expanded="false"
  aria-controls="accordion-content-1"
  id="accordion-trigger-1"
>
  Pertanyaan 1
</button>
<div
  id="accordion-content-1"
  role="region"
  aria-labelledby="accordion-trigger-1"
  hidden
>
  Jawaban 1...
</div>
```

### aria-label vs aria-labelledby vs aria-describedby
```html
<!-- aria-label: teks langsung, kalau tidak ada elemen visible untuk dijadikan label -->
<button aria-label="Tutup dialog">
  <svg aria-hidden="true">...</svg>  <!-- icon saja, butuh label eksplisit -->
</button>

<!-- aria-labelledby: referensi ke elemen lain sebagai label -->
<section aria-labelledby="section-title">
  <h2 id="section-title">Riwayat Pesanan</h2>
  ...
</section>

<!-- aria-describedby: informasi tambahan (bukan label utama) -->
<input
  type="password"
  aria-describedby="password-hint password-error"
/>
<p id="password-hint">Minimal 8 karakter, kombinasi huruf dan angka.</p>
<p id="password-error" role="alert">Password terlalu pendek.</p>
```

---

## Keyboard Navigation

### Urutan Tab yang Benar
```typescript
// ✅ Pastikan tabIndex digunakan dengan benar
// tabIndex="0"  → masuk ke natural tab order
// tabIndex="-1" → bisa di-focus via JS tapi skip dari tab order
// tabIndex > 0  → HINDARI, merusak natural tab order

// ✅ Contoh: focus management saat modal buka
function Modal({ isOpen, onClose, children }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Simpan element yang sedang di-focus
      previousFocusRef.current = document.activeElement as HTMLElement;
      // Pindahkan focus ke modal
      modalRef.current?.focus();
    } else {
      // Kembalikan focus ke element sebelumnya saat modal tutup
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}        // Bisa di-focus via JS, skip tab order alami
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      {children}
    </div>
  );
}
```

### Focus Trap untuk Modal
```typescript
function useFocusTrap(ref: RefObject<HTMLElement>, isActive: boolean) {
  useEffect(() => {
    if (!isActive || !ref.current) return;

    const focusableSelectors = [
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const focusableElements = ref.current.querySelectorAll<HTMLElement>(focusableSelectors);
    const firstEl = focusableElements[0];
    const lastEl = focusableElements[focusableElements.length - 1];

    function handleTabKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }

    document.addEventListener('keydown', handleTabKey);
    firstEl?.focus();

    return () => document.removeEventListener('keydown', handleTabKey);
  }, [isActive, ref]);
}
```

### Keyboard Patterns per Komponen
```
Komponen          Key             Aksi
──────────────────────────────────────────────────────
Button            Enter / Space   Activate
Link              Enter           Navigate
Checkbox          Space           Toggle
Radio Group       Arrow Up/Down   Move between options
Select            Arrow Up/Down   Navigate options
                  Enter / Space   Select option
Tabs              Arrow Left/Right  Move between tabs
                  Home / End      First / Last tab
Dialog            Escape          Close
Combobox          Arrow Down      Open dropdown
                  Escape          Close / Clear
Menu              Arrow Up/Down   Navigate items
                  Escape          Close menu
Date Picker       Arrow keys      Navigate calendar
                  Enter           Select date
```

---

## Form Accessibility

```typescript
// ✅ Form yang fully accessible
function LoginForm() {
  const { register, formState: { errors } } = useForm<LoginInput>();

  return (
    <form noValidate aria-label="Form login">
      <div>
        {/* Label selalu terhubung ke input */}
        <label htmlFor="email">
          Email
          <span aria-hidden="true"> *</span>  {/* visual asterisk */}
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          aria-required="true"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : 'email-hint'}
          {...register('email')}
        />
        <p id="email-hint" className="hint">
          Gunakan email yang aktif.
        </p>
        {errors.email && (
          <p id="email-error" role="alert" className="error">
            {errors.email.message}
          </p>
        )}
      </div>

      {/* Submit error — diumumkan ke screen reader */}
      {submitError && (
        <div role="alert" aria-live="assertive">
          {submitError}
        </div>
      )}

      <button type="submit">Masuk</button>
    </form>
  );
}
```

---

## Live Regions

```typescript
// Untuk konten yang berubah secara dinamis dan perlu diumumkan ke screen reader

// aria-live="polite" — tunggu user selesai sebelum mengumumkan (kebanyakan kasus)
// aria-live="assertive" — umumkan segera, interupsi apapun (hanya untuk error kritis)

function SearchResults({ query, results }: SearchResultsProps) {
  return (
    <>
      {/* Status update hasil pencarian */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {query && `${results.length} hasil untuk "${query}"`}
      </div>

      <ul>
        {results.map(r => <li key={r.id}>{r.title}</li>)}
      </ul>
    </>
  );
}

// Toast notification
function Toast({ message, type }: ToastProps) {
  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      {message}
    </div>
  );
}
```

---

## Images & Icons

```html
<!-- Gambar informatif — alt text menjelaskan konten/fungsinya -->
<img src="grafik-penjualan.png" alt="Grafik penjualan Q1 2026, naik 23% dari Q4 2025" />

<!-- Gambar dekoratif — alt kosong agar screen reader skip -->
<img src="divider-ornament.png" alt="" role="presentation" />

<!-- Icon-only button — wajib ada label -->
<button aria-label="Hapus item">
  <TrashIcon aria-hidden="true" />  <!-- sembunyikan icon dari screen reader -->
</button>

<!-- Icon dengan teks — sembunyikan icon, biarkan teks bicara -->
<button>
  <SearchIcon aria-hidden="true" />
  Cari
</button>

<!-- SVG inline — pastikan accessible -->
<svg
  aria-hidden="true"    <!-- jika dekoratif -->
  focusable="false"     <!-- IE11 bug fix -->
>
  <use href="#icon-check" />
</svg>
```

---

## Testing Accessibility

### Automated Testing
```typescript
// jest-axe — integrasi dengan React Testing Library
import { axe, toHaveNoViolations } from 'jest-axe';
expect.extend(toHaveNoViolations);

it('should have no accessibility violations', async () => {
  const { container } = render(<LoginForm />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});

// Playwright — a11y audit saat E2E
import { checkA11y } from 'axe-playwright';

test('homepage accessibility', async ({ page }) => {
  await page.goto('/');
  await checkA11y(page, undefined, {
    detailedReport: true,
    detailedReportOptions: { html: true },
  });
});
```

### Manual Testing Checklist
```
Keyboard-only navigation:
□ Tab melalui semua interactive element dengan urutan yang logis
□ Semua fungsi bisa dijalankan tanpa mouse
□ Focus indicator selalu visible
□ Modal/dropdown bisa ditutup dengan Escape
□ Tidak ada keyboard trap

Screen Reader (gunakan NVDA/Windows atau VoiceOver/Mac):
□ Heading structure logis (h1 → h2 → h3, tidak skip level)
□ Form label diumumkan dengan benar
□ Error message diumumkan saat muncul
□ Dynamic content update diumumkan
□ Gambar dideskripsikan dengan benar

Visual:
□ Zoom 200% — layout tidak rusak
□ High contrast mode — semua konten masih terbaca
□ Kontras warna lolos WCAG AA (pakai browser DevTools / axe extension)
```

### Browser Extensions yang Wajib Ada
```
- axe DevTools (Chrome/Firefox) — audit otomatis
- WAVE (WebAIM) — visual overlay a11y issues
- Colour Contrast Analyser — cek kontras warna
- NoCoffee Vision Simulator — simulasi gangguan penglihatan
```

---

## Focus Visible — Jangan Hilangkan

```css
/* ❌ JANGAN lakukan ini — merusak keyboard navigation */
* {
  outline: none;
}
:focus {
  outline: none;
}

/* ✅ Sembunyikan outline untuk mouse, tampilkan untuk keyboard */
:focus:not(:focus-visible) {
  outline: none;
}

:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
  border-radius: 2px;
}

/* ✅ Custom focus style yang lebih baik dari default browser */
.button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--color-background), 0 0 0 5px var(--color-focus);
}
```

---

## Skip Navigation

```html
<!-- ✅ Taruh di awal <body>, sebelum semua konten -->
<!-- Memungkinkan keyboard user loncat ke main content -->

<a
  href="#main-content"
  class="skip-link"
>
  Langsung ke konten utama
</a>

<style>
.skip-link {
  position: absolute;
  top: -100%;
  left: 0;
  padding: 0.5rem 1rem;
  background: var(--color-primary);
  color: white;
  z-index: 9999;
  border-radius: 0 0 4px 0;
}

/* Tampil saat di-focus via keyboard */
.skip-link:focus {
  top: 0;
}
</style>

<main id="main-content" tabindex="-1">
  <!-- konten utama -->
</main>
```
