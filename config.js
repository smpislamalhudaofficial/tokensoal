/** TOKEN SOAL V1.1 — ubah API_URL atau EDGE_URL sesuai tutorial. */
window.TOKEN_APP_CONFIG = {
  // WAJIB: URL Google Apps Script berakhiran /exec.
  API_URL: 'https://script.google.com/macros/s/AKfycbwUOOOeY6Slr-M_wueej6P5WabgPfLfharOrVupIS4CC6u2r7NoU8lGe3JOQbn2QaY/exec',

  // OPSIONAL (DIREKOMENDASIKAN JIKA RATUSAN SISWA):
  // Cloudflare Worker public URL https://nama-worker.username.workers.dev/
  // Jika diisi, browser otomatis memakai Worker dan bukan Apps Script langsung.
  EDGE_URL: '',

  // 90 detik meminimalkan permintaan siswa. Saat batas waktu sesi tetap cek segera.
  SYNC_INTERVAL_MS: 0, // otomatis: 90 detik langsung, 45 detik dengan Worker
  EVENT_REFRESH_JITTER_MS: 2500,
  // JSONP langsung Apps Script dapat cold start; Worker biasanya lebih cepat.
  REQUEST_TIMEOUT_MS: 0, // otomatis: 20 detik langsung, 10 detik dengan Worker
  CLASSES: ['7', '8', '9']
};
