# TOKEN SOAL V1.1 — Performance + Typography Update

Halaman token ujian Kelas 7–9. GitHub Pages menampilkan halaman, Google Spreadsheet menyimpan jadwal, Google Apps Script memutuskan **token mana yang boleh dibuka** berdasarkan waktu server Asia/Jakarta. Cloudflare Worker adalah *opsi tambahan* untuk mengurangi beban Apps Script ketika banyak siswa mengakses.

## Yang baru

- Headline **TOKEN SOAL** lebih besar, **Plus Jakarta Sans ExtraBold 800**.
- Nama **mata pelajaran rata tengah, biru, Plus Jakarta Sans 800**.
- Label kartu **● AKTIF = hijau**, **● TIDAK AKTIF = abu-abu**.
- Cache Spreadsheet Apps Script ±3 menit, cache pengaturan ±10 menit. Trigger `onEdit` menghapus cache jika guru mengubah sel di Sheet (tidak menunggu TTL).
- Pengambilan data pada cache miss dikunci memakai `LockService`, mengurangi pembacaan Spreadsheet serentak.
- Sinkronisasi default 90 detik; countdown tiap detik; permintaan baru tetap dikirim segera saat batas pergantian token. Percobaan ulang eksponensial dengan jitter dan hanya **satu timer**.
- Token aktif yang sudah **melewati jam selesai langsung dihapus dari tampilan**, sekalipun koneksi gagal. Data aktif yang *belum kedaluwarsa* tetap bisa dilihat setelah pernah berhasil dimuat pada tab yang sama.
- Tombol **COBA LAGI** saat data pertama kali gagal dimuat.
- Opsi Cloudflare Worker, cache tepi maksimal 20 detik, berhenti sebelum batas jadwal. Worker melayani permintaan HTTP langsung dan menyisipkan waktu server saat respons.

## Isi paket

- `index.html`, `style.css`, `script.js`, `config.js` — **upload ke root GitHub Pages**.
- `assets/logo-sekolah.svg` — placeholder; ganti dengan logo asli (pertahankan nama atau ubah `src` di `index.html`).
- `apps-script/Code.gs` — ganti **seluruh** script Apps Script sebelumnya, lalu **Deploy New version**.
- `cloudflare-worker.js` — OPSIONAL, buat Cloudflare Worker jika siswa banyak.
- `Template_Jadwal_Token_V1.xlsx` — template lama masih cocok, tidak perlu migrasi format.
- `TUTORIAL_PENERAPAN_V1.1.html` — tutorial lengkap yang bisa dibuka di browser.
- `PANDUAN_UPDATE_V1_KE_V1.1.md` — langkah pembaruan cepat.

## Jalur data

Jalur dasar (paling mudah):

`Google Sheets (private) → Apps Script (/exec) → GitHub Pages → Browser siswa`

Jalur direkomendasikan saat akses ramai:

`Google Sheets (private) → Apps Script (/exec) → Cloudflare Worker (edge cache) → GitHub Pages → Browser siswa`

**Penting:** GitHub Pages tidak menyimpan token jadwal mendatang. Token sesi aktif memang publik; jika sekolah memerlukan akses terbatas, butuh autentikasi tersendiri. JSONP ke Apps Script diperlukan pada mode langsung untuk menghindari keterbatasan CORS ContentService; Worker memakai `fetch` biasa.

## Pengaturan

Buka `config.js`:

```javascript
window.TOKEN_APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/ID_DEPLOYMENT/exec',
  EDGE_URL: '', // opsional: 'https://nama-worker.username.workers.dev/'
  SYNC_INTERVAL_MS: 0, // otomatis: langsung 90 detik, Worker 45 detik
  EVENT_REFRESH_JITTER_MS: 2500,
  REQUEST_TIMEOUT_MS: 0, // otomatis: langsung 20 detik, Worker 10 detik
  CLASSES: ['7', '8', '9']
};
```

Jika `EDGE_URL` diisi, browser otomatis menggunakan Cloudflare Worker. Jangan mengisi `EDGE_URL` dengan URL Apps Script: itu harus URL Worker.

### Perhatian operasional

1. **Perbarui Apps Script terlebih dulu**, simpan, lalu di **Deploy → Manage deployments → Edit → Version: New version → Deploy**. URL `/exec` biasanya tetap sama. Jika mengganti deployment dengan yang baru, perbarui `API_URL`.
2. **Jangan upload folder `apps-script`, template berisi token nyata, atau pengaturan pribadi ke GitHub publik.** Paket contoh ini berisi token dummy, tapi ketika sudah diisi token asli, simpan spreadsheet tetap private.
3. Perubahan manual pada Google Sheets memicu `onEdit`. Jika data diubah oleh impor otomatis, API, atau formula yang tidak memicu `onEdit`, jalankan `clearTokenCache()` secara manual atau tunggu cache habis maksimal ±180 detik. Worker memiliki cache tambahan hingga 20 detik.
4. Pada saat **mengganti tema, logo, atau CSS**, browser dapat memakai cache file lama; versi pada URL aset `?v=1.1` membantu meminta file baru. Bila perlu lakukan hard refresh `Ctrl+F5`.
5. Plus Jakarta Sans diunduh dari Google Fonts saat ada internet; browser akan memakai font alternatif ketika font tidak dapat dimuat.
6. Tidak ada garansi bebas kegagalan: batas kuota Apps Script, koneksi internet, atau konfigurasi deployment masih mungkin mengganggu. Lakukan uji simulasi sebelum ujian.

## Menguji hasil

1. Buka URL Apps Script `/exec` → harus mengembalikan JSON `ok:true`, tanpa token sesi mendatang.
2. Cek Google Sheet format tanggal `yyyy-mm-dd`, jam `HH:mm`, status `AKTIF`.
3. Buka GitHub Pages lewat HP dan laptop → pastikan label **AKTIF hijau**, **TIDAK AKTIF abu-abu**, mapel di tengah.
4. Buat 2 sesi dengan batas berdekatan pada hari uji, lalu pastikan token lama hilang **tepat ketika berakhir**.
5. Tes offline sementara: token valid tetap tampil hingga akhir sesi, setelah itu tidak ada token lama.
6. Jika Worker digunakan, cek `/health` untuk memastikan `configured:true`.

Lihat tutorial HTML untuk langkah lengkap.
