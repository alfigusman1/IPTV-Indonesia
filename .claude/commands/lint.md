Jalankan ESLint untuk backend `api/<modul>` UINSGD (default: sarpras). Argumen: nama modul, mis. `/lint master`.

!cd /c/xampp/htdocs/uinsgd/api/${ARGUMENTS:-sarpras} && npx eslint . --format=compact 2>&1 | head -80

Analisis output di atas:
- Kelompokkan error berdasarkan file
- Jelaskan error/warning dengan bahasa sederhana (ingat aturan airbnb-base: tanpa for-of/continue, `process.env` di-destructure)
- Tawarkan perbaikan otomatis dengan `npx eslint --fix <file>` untuk yang fixable
- Jika tidak ada error, konfirmasi semua file lulus lint (CI CircleCI menjalankan langkah yang sama)
