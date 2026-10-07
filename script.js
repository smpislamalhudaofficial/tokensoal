/* TOKEN SOAL V1.1 — no framework / no backend secrets in GitHub. */
(() => {
  'use strict';

  const config = window.TOKEN_APP_CONFIG || {};
  const classList = Array.isArray(config.CLASSES) ? config.CLASSES.map(String) : ['7', '8', '9'];
  const edgeUrl = String(config.EDGE_URL || '').trim();
  const directUrl = String(config.API_URL || '').trim();
  const useEdge = /^https:\/\//i.test(edgeUrl);
  const apiUrl = useEdge ? edgeUrl : directUrl;
  const syncInterval = Math.max(30000, Number(config.SYNC_INTERVAL_MS) || (useEdge ? 45000 : 90000));
  const requestTimeout = Math.max(5000, Number(config.REQUEST_TIMEOUT_MS) || (useEdge ? 10000 : 20000));
  const eventJitter = Math.max(0, Number(config.EVENT_REFRESH_JITTER_MS) || 2500);

  const byId = id => document.getElementById(id);
  const els = {
    dateLabel: byId('dateLabel'), statusChip: byId('statusChip'), statusChipText: byId('statusChipText'),
    messagePanel: byId('messagePanel'), messageIcon: byId('messageIcon'),
    messageTitle: byId('messageTitle'), messageText: byId('messageText'),
    retryButton: byId('retryButton'), countdownPanel: byId('countdownPanel'),
    countdownTitle: byId('countdownTitle'), nextChangeText: byId('nextChangeText'),
    hours: byId('hours'), minutes: byId('minutes'), seconds: byId('seconds'),
    cardsSection: byId('cardsSection'), classCards: byId('classCards'),
    serverClock: byId('serverClock'), connectionDot: byId('connectionDot'),
    connectionText: byId('connectionText'), toast: byId('toast')
  };

  let latestState = null;
  let serverAnchorMs = null;
  let perfAnchorMs = null;
  let nextChangeTargetMs = null;
  let boundaryRequested = false;
  let syncTimer = null;
  let toastTimer = null;
  let isSyncing = false;
  let failures = 0;

  function configured() {
    if (useEdge) return /^https:\/\/[^\s]+$/i.test(apiUrl);
    return /^https:\/\/script\.google\.com\/macros\/s\/[^\s]+\/exec(?:\?.*)?$/i.test(apiUrl);
  }

  function serverNow() {
    if (serverAnchorMs === null || perfAnchorMs === null) return null;
    return serverAnchorMs + (performance.now() - perfAnchorMs);
  }

  function setServerAnchor(timestamp, roundtrip) {
    const ms = Number(timestamp);
    if (!Number.isFinite(ms)) return;
    // Only monotonic browser time is used after the server-provided anchor.
    // Account conservatively for connection latency when using direct Apps Script.
    const correction = useEdge ? Math.min(roundtrip / 2, 500) : Math.min(roundtrip / 2 + 250, 7000);
    serverAnchorMs = ms + correction;
    perfAnchorMs = performance.now();
  }

  function formatClock(ms) {
    if (!Number.isFinite(ms)) return '--:--:-- WIB';
    return `${new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date(ms)).replace(/\./g, ':')} WIB`;
  }

  function setConnection(mode, text) {
    els.connectionDot.className = `connection-dot${mode === 'online' ? ' is-online' : ''}${mode === 'offline' ? ' is-offline' : ''}`;
    els.connectionText.textContent = text;
  }

  function setStatusChip(type, text) {
    els.statusChip.className = `status-chip status-chip--${type}`;
    els.statusChipText.textContent = text;
  }

  function showMessage(icon, title, message, allowRetry = false) {
    els.messagePanel.hidden = false;
    els.messageIcon.textContent = icon;
    els.messageTitle.textContent = title;
    els.messageText.textContent = message;
    els.retryButton.hidden = !allowRetry;
  }

  function hideMessage() {
    els.messagePanel.hidden = true;
    els.retryButton.hidden = true;
  }

  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function cardHtml(cls, info) {
    const status = info?.status || 'no_schedule';
    const subject = escapeHtml(info?.subject || 'Belum ada jadwal');
    const key = escapeHtml(cls);
    const active = status === 'active' && typeof info.token === 'string' && info.token.trim();
    const text = active ? '● AKTIF' : '● TIDAK AKTIF';
    const badge = `<span class="card-state ${active ? 'card-state--active' : 'card-state--inactive'}">${text}</span>`;

    if (active) {
      return `<article class="class-card class-card--active" data-class="${key}">
        <div class="card-topline"><span class="class-badge">KELAS ${key}</span>${badge}</div>
        <h3 class="subject">${subject}</h3>
        <div class="token-box"><span class="token-label">TOKEN SOAL</span>
          <strong class="token-value">${escapeHtml(info.token)}</strong></div>
        <button class="copy-button" type="button" data-token="${escapeHtml(info.token)}" data-class="${key}">SALIN TOKEN</button>
      </article>`;
    }

    let title = 'Token belum tersedia';
    let description = 'Token kelas ini tidak sedang aktif.';
    if (status === 'waiting') {
      description = `Tersedia pukul ${escapeHtml(info.availableAt || '--:--')} WIB.`;
    } else if (status === 'finished') {
      title = 'Sesi kelas selesai';
      description = info.finishedAt ? `Berakhir pukul ${escapeHtml(info.finishedAt)} WIB.` : 'Tidak ada token aktif lagi hari ini.';
    } else if (status === 'switching') {
      title = 'Memperbarui token…';
      description = 'Menunggu data sesi terbaru dari server.';
    } else {
      title = 'Belum ada jadwal';
      description = 'Jadwal kelas ini belum tersedia hari ini.';
    }
    return `<article class="class-card class-card--inactive" data-class="${key}">
      <div class="card-topline"><span class="class-badge">KELAS ${key}</span>${badge}</div>
      <h3 class="subject">${subject}</h3>
      <div class="locked-box"><div><strong>${title}</strong><p>${description}</p></div></div>
    </article>`;
  }

  function renderCards(classes) {
    els.classCards.innerHTML = classList.map(key => cardHtml(key, classes?.[key])).join('');
    els.cardsSection.hidden = false;
    els.classCards.querySelectorAll('.copy-button').forEach(button => {
      button.addEventListener('click', async () => {
        const token = button.dataset.token || '';
        const cls = button.dataset.class || '';
        if (!token) return;
        // Check expiry at tap time too, not only at the 1-second interval.
        expireTokens();
        if (!button.isConnected) return;
        try {
          await navigator.clipboard.writeText(token);
        } catch (_) {
          const el = document.createElement('textarea');
          el.value = token;
          el.readOnly = true;
          el.style.position = 'fixed';
          el.style.opacity = '0';
          document.body.appendChild(el);
          el.select();
          const copied = document.execCommand('copy');
          el.remove();
          if (!copied) { showToast('Tidak dapat menyalin, silakan salin token manual.'); return; }
        }
        button.classList.add('is-copied');
        button.textContent = '✓ TOKEN DISALIN';
        showToast(`Token Kelas ${cls} berhasil disalin.`);
        setTimeout(() => {
          if (button.isConnected) {
            button.classList.remove('is-copied');
            button.textContent = 'SALIN TOKEN';
          }
        }, 1600);
      });
    });
  }

  function getExpiryMs(info, dateKey) {
    const numeric = Number(info?.endTimeMs);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    if (!info?.endAt || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey || '')) return null;
    const parsed = Date.parse(`${dateKey}T${info.endAt}:00+07:00`);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function expireTokens() {
    if (!latestState || !Number.isFinite(serverNow())) return;
    const now = serverNow();
    let changed = false;
    for (const cls of classList) {
      const info = latestState.classes?.[cls];
      if (info?.status !== 'active') continue;
      const expiry = getExpiryMs(info, latestState.dateKey);
      // Fail closed if the server didn't provide usable expiry information.
      if (expiry === null || now >= expiry) {
        latestState.classes[cls] = { status: 'switching', subject: info.subject || '' };
        changed = true;
      }
    }
    if (changed) {
      renderCards(latestState.classes);
      if (!classList.some(cls => latestState.classes[cls]?.status === 'active')) {
        setStatusChip('waiting', 'MEMPERBARUI TOKEN');
        showMessage('↻', 'Memperbarui sesi ujian', 'Token sebelumnya telah ditutup. Menunggu token terbaru dari server.', true);
      }
    }
  }

  function setCountdown(change, mode) {
    const atMs = Number(change?.atMs);
    if (Number.isFinite(atMs) && atMs > 0) {
      nextChangeTargetMs = atMs;
    } else if (Number.isFinite(Number(change?.secondsUntil)) && serverNow() !== null) {
      nextChangeTargetMs = serverNow() + Number(change.secondsUntil) * 1000;
    } else {
      nextChangeTargetMs = null;
      els.countdownPanel.hidden = true;
      return;
    }

    boundaryRequested = false;
    els.countdownPanel.hidden = false;
    els.countdownPanel.classList.remove('is-urgent');
    if (mode === 'waiting') {
      els.countdownTitle.textContent = 'TOKEN TERSEDIA DALAM';
      els.nextChangeText.textContent = `Token akan tersedia otomatis pada pukul ${change.timeLabel} WIB`;
    } else if (change.kind === 'change') {
      els.countdownTitle.textContent = 'TOKEN BERGANTI DALAM';
      els.nextChangeText.textContent = `Token akan berganti otomatis pada pukul ${change.timeLabel} WIB`;
    } else {
      els.countdownTitle.textContent = 'PEMBARUAN TOKEN BERIKUTNYA';
      els.nextChangeText.textContent = `Sistem memperbarui jadwal pada pukul ${change.timeLabel} WIB`;
    }
  }

  function renderState(payload) {
    latestState = payload;
    els.dateLabel.textContent = payload.dateLabel || 'Tanggal tidak tersedia';
    setConnection('online', useEdge ? 'Terhubung · jalur cepat' : 'Terhubung · langsung');
    const status = payload.globalStatus;
    if (status === 'active') {
      hideMessage();
      setStatusChip('active', 'TOKEN SEDANG AKTIF');
      renderCards(payload.classes);
      setCountdown(payload.nextChange, 'active');
    } else if (status === 'waiting') {
      setStatusChip('waiting', 'TOKEN BELUM TERSEDIA');
      showMessage('🔒', 'Token belum tersedia', payload.nextChange?.timeLabel
        ? `Token soal tersedia pada pukul ${payload.nextChange.timeLabel} WIB.`
        : 'Token soal belum tersedia.');
      renderCards(payload.classes);
      setCountdown(payload.nextChange, 'waiting');
    } else if (status === 'finished') {
      setStatusChip('finished', 'SESI UJIAN SELESAI');
      showMessage('✓', 'Sesi ujian telah selesai', 'Seluruh token hari ini sudah tidak aktif.');
      renderCards(payload.classes);
      els.countdownPanel.hidden = true;
      nextChangeTargetMs = null;
    } else if (status === 'no_schedule') {
      setStatusChip('finished', 'BELUM ADA JADWAL');
      showMessage('🗓', 'Belum ada jadwal token hari ini', 'Operator dapat mengisi jadwal melalui Spreadsheet.');
      renderCards(payload.classes);
      els.countdownPanel.hidden = true;
      nextChangeTargetMs = null;
    } else {
      showConnectionError('Data server tidak dikenali.');
    }
    expireTokens();
  }

  function showConnectionError(message) {
    expireTokens();
    setConnection('offline', latestState ? 'Koneksi lambat · mencoba lagi' : 'Tidak terhubung · mencoba lagi');
    if (!latestState) {
      setStatusChip('error', 'KONEKSI TERGANGGU');
      showMessage('↻', 'Data token belum berhasil dimuat',
        `${message || 'Koneksi ke server sedang lambat.'} Sistem akan mencoba kembali secara otomatis.`, true);
      els.cardsSection.hidden = true;
      els.countdownPanel.hidden = true;
    } else if (latestState.globalStatus === 'active') {
      // Valid existing tokens remain visible only until their server expiry.
      const anyValid = classList.some(cls => latestState.classes?.[cls]?.status === 'active');
      if (!anyValid) {
        setStatusChip('waiting', 'MEMPERBARUI TOKEN');
        showMessage('↻', 'Menunggu token terbaru', 'Token lama sudah berakhir. Sambungan sedang dipulihkan.', true);
      }
    }
  }

  function toast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 2300);
  }

  function showToast(message) { toast(message); }

  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const name = `__tokenCb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement('script');
      let finished = false;
      let timer;
      function cleanup() {
        if (finished) return false;
        finished = true;
        clearTimeout(timer);
        script.remove();
        try { delete window[name]; } catch (_) { window[name] = undefined; }
        return true;
      }
      window[name] = payload => { if (cleanup()) resolve(payload); };
      script.onerror = () => { if (cleanup()) reject(new Error('Google Apps Script tidak dapat diakses.')); };
      const sep = url.includes('?') ? '&' : '?';
      script.src = `${url}${sep}callback=${encodeURIComponent(name)}&t=${Date.now()}`;
      script.async = true;
      timer = setTimeout(() => {
        if (cleanup()) reject(new Error('Permintaan data terlalu lama.'));
      }, requestTimeout);
      document.head.appendChild(script);
    });
  }

  async function jsonFromWorker(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeout);
    try {
      const sep = url.includes('?') ? '&' : '?';
      const response = await fetch(`${url}${sep}t=${Date.now()}`, {
        method: 'GET', cache: 'no-store', signal: controller.signal
      });
      if (!response.ok) throw new Error('Sumber token sedang sibuk.');
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Permintaan data terlalu lama.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function planSync(ms) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncData('scheduled'), ms);
  }

  async function syncData(reason = 'scheduled') {
    if (!configured()) return;
    if (isSyncing) return;
    clearTimeout(syncTimer);
    isSyncing = true;
    if (reason !== 'scheduled') setConnection('pending', 'Menyinkronkan data…');
    const startPerf = performance.now();
    try {
      const data = useEdge ? await jsonFromWorker(apiUrl) : await jsonp(apiUrl);
      if (!data || data.ok !== true || !data.classes || !Number.isFinite(Number(data.serverTimeMs))) {
        throw new Error(data?.message || 'Respons data dari server tidak valid.');
      }
      setServerAnchor(data.serverTimeMs, performance.now() - startPerf);
      failures = 0;
      renderState(data);
      updateClockAndCountdown();
      planSync(syncInterval + Math.floor(Math.random() * 9000));
    } catch (error) {
      console.warn('Token V1.1: gagal sinkron', error);
      failures += 1;
      showConnectionError(error.message);
      const delay = Math.min(45000, 3000 * 2 ** Math.min(failures - 1, 4)) + Math.floor(Math.random() * 2400);
      planSync(delay);
    } finally {
      isSyncing = false;
    }
  }

  function updateClockAndCountdown() {
    const now = serverNow();
    els.serverClock.textContent = formatClock(now);
    expireTokens();
    if (!Number.isFinite(nextChangeTargetMs) || !Number.isFinite(now)) return;

    const remaining = Math.max(0, nextChangeTargetMs - now);
    const seconds = Math.ceil(remaining / 1000);
    els.hours.textContent = String(Math.floor(seconds / 3600)).padStart(2, '0');
    els.minutes.textContent = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    els.seconds.textContent = String(seconds % 60).padStart(2, '0');
    els.countdownPanel.classList.toggle('is-urgent', seconds > 0 && seconds <= 300);

    if (remaining === 0 && !boundaryRequested) {
      boundaryRequested = true;
      // Stagger device bursts without displaying the expired token.
      const jitter = Math.floor(Math.random() * (eventJitter + 1));
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => syncData('boundary'), jitter);
    }
  }

  function init() {
    if (!configured()) {
      els.dateLabel.textContent = 'Konfigurasi belum selesai';
      setStatusChip('waiting', 'PERLU KONFIGURASI');
      showMessage('⚙', 'Hubungkan sumber data',
        'Isi URL Web App di API_URL pada config.js atau pasang EDGE_URL untuk Cloudflare Worker.');
      setConnection('offline', 'API belum dikonfigurasi');
    } else {
      syncData('initial');
    }

    setInterval(updateClockAndCountdown, 1000);
    els.retryButton.addEventListener('click', () => {
      if (isSyncing) return;
      syncData('manual');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        updateClockAndCountdown();
        syncData('resume');
      }
    });
    window.addEventListener('online', () => syncData('online'));
    window.addEventListener('offline', () => {
      expireTokens();
      setConnection('offline', 'Perangkat sedang offline');
    });
  }

  init();
})();
