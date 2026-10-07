# UPDATE TOKEN SOAL V1 → V1.1 (tanpa mereset jadwal)

**PENTING:** Spreadsheet dan data yang sudah terisi **tetap dipakai**, tidak perlu upload template ulang. Simpan cadangan ZIP V1 dan salinan Spreadsheet sebelum memulai.

## Langkah 1 — Perbarui Google Apps Script

1. Masuk ke Google Spreadsheet yang sudah digunakan V1.
2. Klik **Extensions/Ekstensi → Apps Script**.
3. Buka `Code.gs`, hapus isi lama, lalu tempel **seluruh isi** `apps-script/Code.gs` V1.1.
4. Klik **Save/Simpan**.
5. Pilih fungsi `testApi`, klik **Run/Jalankan**. Jika diminta izin, setujui. Periksa **Execution log** apakah tanpa error (isi token hanya tampil jika jadwal sedang aktif).
6. Klik **Deploy → Manage deployments → ikon pensil/Edit → Version: New version → Deploy**. Jangan sekadar klik Save, karena Web App `/exec` menggunakan versi yang sudah dideploy.
7. Uji URL `/exec` di tab browser. Pastikan nilai `version` adalah `1.1.0` dan `ok` adalah `true`.

## Langkah 2 — Update website GitHub

1. Buka repository GitHub Pages sebelumnya.
2. Ganti **empat file di root**: `index.html`, `style.css`, `script.js`, `config.js`.
3. **Pertahankan `API_URL` lama** yang sudah berfungsi di `config.js` (file contoh berisi placeholder, jadi paste ulang URL Anda).
4. **Pertahankan logo sekolah asli** pada folder `assets`. Jangan ditimpa placeholder dari ZIP.
5. Commit perubahan. Buka URL Pages, lalu hard-refresh (`Ctrl+F5`) jika halaman masih versi sebelumnya.
6. Cek ukuran judul **TOKEN SOAL**, mata pelajaran di tengah dan warna status kartu.

## Langkah 3 — Opsional: Cloudflare Worker (disarankan untuk banyak siswa)

1. Masuk dashboard Cloudflare → **Workers & Pages** → **Create Worker**.
2. Ganti kode bawaan dengan isi `cloudflare-worker.js`, lalu **Deploy**.
3. Di konfigurasi Worker, buka **Settings → Variables and Secrets → Add**. Nama variabel: `APPS_SCRIPT_URL`, isi URL lengkap `/exec` Google Apps Script. Pilih tipe Text; bukan URL GitHub. Simpan dan deploy versi terbaru jika diminta.
4. Buka URL Worker dengan akhiran `/health` → cek `{ "ok": true, "configured": true }`.
5. Buka URL utama Worker → respons JSON `ok:true`. Di luar jam aktif, tidak boleh ada token masa depan.
6. Masukkan URL Worker ke `EDGE_URL` pada `config.js` website dan commit. `API_URL` tetap disimpan sebagai cadangan, tetapi **browser hanya menggunakan `EDGE_URL` jika terisi**.

## Jika masih lambat

- Cek **Apps Script → Executions**: durasi, *Failed*, dan frekuensi pemanggilan `doGet`.
- Pastikan deployment Web App disetel **Execute as: Me** dan **Who has access: Anyone**, lalu lakukan **New version**.
- Periksa apakah Worker `/health` sudah `configured:true` dan URL Worker yang dipakai berbeda dari URL Apps Script.
- Jangan isi jadwal bertumpuk untuk kelas yang sama.
- Jangan publish Sheet sebagai CSV/JSON publik; token masa depan bisa bocor.
- Jika perubahan impor massal belum terbaca, jalankan `clearTokenCache()` dari editor Apps Script.

## Kemungkinan pembatasan

Jalur Apps Script langsung masih bisa lambat saat 100–300 siswa memuat bersama. Worker meringankan jumlah pembacaan asal, tetapi Anda tetap harus simulasi beban dan memastikan batas kuota layanan yang digunakan memadai. Cache Worker sengaja hanya 20 detik dan tidak boleh melewati batas sesi.
