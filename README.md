# TOKEN SOAL V1

Website publik untuk menampilkan token soal Kelas 7, 8, dan 9 berdasarkan jadwal Google Spreadsheet.

## Isi paket

- `index.html` — halaman utama
- `style.css` — UI responsif
- `script.js` — sinkronisasi, countdown, salin token, state aplikasi
- `config.js` — tempat memasukkan URL Apps Script
- `assets/logo-sekolah.svg` — placeholder; ganti dengan logo sekolah Anda
- `robots.txt` + `.nojekyll` — mencegah indeks mesin pencari dan menjaga deployment statis sederhana
- `apps-script/Code.gs` — API Google Apps Script
- `Template_Jadwal_Token_V1.xlsx` — template pengisian jadwal
- `TUTORIAL_PENERAPAN.html` — tutorial lengkap

## Keamanan utama

Token sesi berikutnya tidak dikirim ke browser. Google Apps Script hanya memasukkan `token` ke respons API ketika baris tersebut sedang aktif menurut waktu server.

> Catatan: ini melindungi token yang belum aktif dari sekadar melihat source/browser network. Token yang sedang aktif tetap merupakan data publik bagi siapa pun yang mengetahui URL halaman atau endpoint. Gunakan kode akses/login terpisah bila kebutuhan keamanan Anda lebih tinggi.
