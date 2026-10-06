(() => {
  "use strict";

  const config = window.TOKEN_APP_CONFIG || {};
  const classList = Array.isArray(config.CLASSES) ? config.CLASSES.map(String) : ["7", "8", "9"];
  const syncInterval = Math.max(30000, Number(config.SYNC_INTERVAL_MS) || 60000);
  const requestTimeout = Math.max(5000, Number(config.REQUEST_TIMEOUT_MS) || 12000);
  const eventJitter = Math.max(0, Number(config.EVENT_REFRESH_JITTER_MS) || 3500);

  const els = {
    dateLabel: document.getElementById("dateLabel"),
    statusChip: document.getElementById("statusChip"),
    statusChipText: document.getElementById("statusChipText"),
    messagePanel: document.getElementById("messagePanel"),
    messageIcon: document.getElementById("messageIcon"),
    messageTitle: document.getElementById("messageTitle"),
    messageText: document.getElementById("messageText"),
    countdownPanel: document.getElementById("countdownPanel"),
    countdownTitle: document.getElementById("countdownTitle"),
    nextChangeText: document.getElementById("nextChangeText"),
    hours: document.getElementById("hours"),
    minutes: document.getElementById("minutes"),
    seconds: document.getElementById("seconds"),
    cardsSection: document.getElementById("cardsSection"),
    classCards: document.getElementById("classCards"),
    serverClock: document.getElementById("serverClock"),
    connectionDot: document.getElementById("connectionDot"),
    connectionText: document.getElementById("connectionText"),
    toast: document.getElementById("toast")
  };

  let latestState = null;
  let serverAnchorMs = null;
  let performanceAnchorMs = null;
  let nextChangeTargetMs = null;
  let boundaryRefreshScheduled = false;
  let periodicTimer = null;
  let toastTimer = null;
  let isSyncing = false;
  let retryDelayMs = 5000;

  function isConfigured() {
    return typeof config.API_URL === "string" && /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(config.API_URL.trim());
  }

  function estimatedServerNowMs() {
    if (serverAnchorMs == null || performanceAnchorMs == null) return null;
    return serverAnchorMs + (performance.now() - performanceAnchorMs);
  }

  function setServerAnchor(serverTimeMs) {
    const parsed = Number(serverTimeMs);
    if (!Number.isFinite(parsed)) return;
    serverAnchorMs = parsed;
    performanceAnchorMs = performance.now();
  }

  function formatClock(ms) {
    if (!Number.isFinite(ms)) return "--:--:-- WIB";
    const formatter = new Intl.DateTimeFormat("id-ID", {
      timeZone: latestState?.timezone || "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    return `${formatter.format(new Date(ms)).replace(/\./g, ":")} WIB`;
  }

  function setConnection(mode, text) {
    els.connectionDot.classList.remove("is-online", "is-offline");
    if (mode === "online") els.connectionDot.classList.add("is-online");
    if (mode === "offline") els.connectionDot.classList.add("is-offline");
    els.connectionText.textContent = text;
  }

  function setStatusChip(type, text) {
    els.statusChip.className = `status-chip status-chip--${type}`;
    els.statusChipText.textContent = text;
  }

  function showMessage(icon, title, text) {
    els.messagePanel.hidden = false;
    els.messageIcon.textContent = icon;
    els.messageTitle.textContent = title;
    els.messageText.textContent = text;
  }

  function hideMessage() {
    els.messagePanel.hidden = true;
  }

  function setCountdown(nextChange, mode) {
    if (!nextChange || !Number.isFinite(Number(nextChange.secondsUntil))) {
      els.countdownPanel.hidden = true;
      nextChangeTargetMs = null;
      return;
    }

    const now = estimatedServerNowMs() ?? Date.now();
    nextChangeTargetMs = now + Math.max(0, Number(nextChange.secondsUntil)) * 1000;
    boundaryRefreshScheduled = false;
    els.countdownPanel.hidden = false;
    els.countdownPanel.classList.remove("is-urgent");

    if (mode === "waiting") {
      els.countdownTitle.textContent = "TOKEN TERSEDIA DALAM";
      els.nextChangeText.textContent = `Token akan tersedia otomatis pada pukul ${nextChange.timeLabel} WIB`;
    } else if (nextChange.kind === "change") {
      els.countdownTitle.textContent = "TOKEN BERGANTI DALAM";
      els.nextChangeText.textContent = `Token akan berganti otomatis pada pukul ${nextChange.timeLabel} WIB`;
    } else {
      els.countdownTitle.textContent = "PEMBARUAN BERIKUTNYA";
      els.nextChangeText.textContent = `Sistem akan memperbarui token pada pukul ${nextChange.timeLabel} WIB`;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function cardHtml(className, info) {
    const status = info?.status || "no_schedule";
    const subject = escapeHtml(info?.subject || "Belum ada jadwal");
    const cls = escapeHtml(className);

    if (status === "active") {
      return `
        <article class="class-card" data-class="${cls}">
          <div class="card-topline">
            <span class="class-badge">KELAS ${cls}</span>
            <span class="card-state">● AKTIF</span>
          </div>
          <h3 class="subject">${subject}</h3>
          <div class="token-box">
            <span class="token-label">TOKEN SOAL</span>
            <strong class="token-value">${escapeHtml(info.token)}</strong>
          </div>
          <button class="copy-button" type="button" data-token="${escapeHtml(info.token)}" data-class="${cls}">SALIN TOKEN</button>
        </article>`;
    }

    let lockedTitle = "Token belum tersedia";
    let lockedText = "Token tidak sedang aktif.";
    let cardState = "MENUNGGU";

    if (status === "waiting") {
      lockedText = `Akan tersedia pukul ${escapeHtml(info.availableAt)} WIB.`;
      cardState = "TERJADWAL";
    } else if (status === "finished") {
      lockedTitle = "Sesi kelas selesai";
      lockedText = info.finishedAt ? `Sesi terakhir berakhir pukul ${escapeHtml(info.finishedAt)} WIB.` : "Tidak ada token aktif lagi hari ini.";
      cardState = "SELESAI";
    } else {
      lockedTitle = "Belum ada jadwal";
      lockedText = "Jadwal kelas ini belum diisi untuk hari ini.";
      cardState = "TIDAK TERJADWAL";
    }

    return `
      <article class="class-card" data-class="${cls}">
        <div class="card-topline">
          <span class="class-badge">KELAS ${cls}</span>
          <span class="card-state">${cardState}</span>
        </div>
        <h3 class="subject">${subject}</h3>
        <div class="locked-box">
          <div>
            <strong>${lockedTitle}</strong>
            <p>${lockedText}</p>
          </div>
        </div>
      </article>`;
  }

  function renderCards(classes) {
    els.classCards.innerHTML = classList.map(cls => cardHtml(cls, classes?.[cls])).join("");
    els.cardsSection.hidden = false;

    els.classCards.querySelectorAll(".copy-button").forEach(button => {
      button.addEventListener("click", async () => {
        const token = button.dataset.token || "";
        const cls = button.dataset.class || "";
        try {
          await navigator.clipboard.writeText(token);
        } catch (_) {
          const temp = document.createElement("textarea");
          temp.value = token;
          temp.setAttribute("readonly", "");
          temp.style.position = "fixed";
          temp.style.opacity = "0";
          document.body.appendChild(temp);
          temp.select();
          document.execCommand("copy");
          temp.remove();
        }
        button.classList.add("is-copied");
        button.textContent = "✓ TOKEN DISALIN";
        showToast(`Token Kelas ${cls} berhasil disalin.`);
        window.setTimeout(() => {
          button.classList.remove("is-copied");
          button.textContent = "SALIN TOKEN";
        }, 1600);
      });
    });
  }

  function renderState(data) {
    latestState = data;
    setServerAnchor(data.serverTimeMs);
    els.dateLabel.textContent = data.dateLabel || "Tanggal tidak tersedia";
    setConnection("online", "Data tersinkron");
    retryDelayMs = 5000;

    const status = data.globalStatus;
    if (status === "active") {
      setStatusChip("active", "TOKEN SEDANG AKTIF");
      hideMessage();
      renderCards(data.classes);
      setCountdown(data.nextChange, "active");
    } else if (status === "waiting") {
      setStatusChip("waiting", "TOKEN BELUM TERSEDIA");
      showMessage("🔒", "Token belum tersedia", data.nextChange?.timeLabel
        ? `Token soal akan tersedia secara otomatis pada pukul ${data.nextChange.timeLabel} WIB.`
        : "Token soal belum tersedia untuk saat ini.");
      renderCards(data.classes);
      setCountdown(data.nextChange, "waiting");
    } else if (status === "finished") {
      setStatusChip("finished", "SESI UJIAN SELESAI");
      showMessage("✓", "Sesi ujian telah selesai", "Seluruh token ujian untuk hari ini sudah tidak aktif.");
      els.countdownPanel.hidden = true;
      nextChangeTargetMs = null;
      renderCards(data.classes);
    } else if (status === "no_schedule") {
      setStatusChip("finished", "BELUM ADA JADWAL");
      showMessage("🗓️", "Belum ada jadwal token hari ini", "Operator dapat menambahkan jadwal melalui Spreadsheet.");
      els.countdownPanel.hidden = true;
      nextChangeTargetMs = null;
      renderCards(data.classes);
    } else {
      showFatalState("Status data tidak dikenali.");
    }
  }

  function showSetupState() {
    latestState = null;
    setStatusChip("waiting", "PERLU KONFIGURASI");
    els.dateLabel.textContent = "Token Soal V1";
    showMessage("⚙️", "Hubungkan Google Apps Script", "Buka file config.js lalu tempel URL Web App /exec pada bagian API_URL.");
    els.countdownPanel.hidden = true;
    els.cardsSection.hidden = true;
    setConnection("offline", "API belum dikonfigurasi");
  }

  function showFatalState(message) {
    setStatusChip("error", "DATA TIDAK DAPAT DIMUAT");
    showMessage("!", "Sistem token belum dapat diakses", message || "Periksa koneksi dan konfigurasi API.");
    if (!latestState) {
      els.countdownPanel.hidden = true;
      els.cardsSection.hidden = true;
    }
    setConnection("offline", latestState ? "Koneksi terputus · data terakhir tetap tampil" : "Koneksi terputus");
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 2200);
  }

  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const callbackName = `__tokenSoalCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      let completed = false;

      const cleanup = () => {
        if (completed) return;
        completed = true;
        window.clearTimeout(timeoutId);
        script.remove();
        try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
      };

      window[callbackName] = payload => {
        cleanup();
        resolve(payload);
      };

      const separator = url.includes("?") ? "&" : "?";
      script.src = `${url}${separator}callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
      script.async = true;
      script.onerror = () => {
        cleanup();
        reject(new Error("Endpoint Apps Script tidak dapat dijangkau."));
      };

      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error("Permintaan data melewati batas waktu."));
      }, requestTimeout);

      document.head.appendChild(script);
    });
  }

  async function syncData(reason = "periodic") {
    if (!isConfigured() || isSyncing) return;
    isSyncing = true;
    if (reason !== "periodic") setConnection("online", "Memperbarui data…");

    try {
      const data = await jsonp(config.API_URL.trim());
      if (!data || data.ok !== true) throw new Error(data?.message || "Respons API tidak valid.");
      renderState(data);
    } catch (error) {
      console.error("Token Soal sync error:", error);
      showFatalState(error.message);
      window.setTimeout(() => syncData("retry"), retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, 60000);
    } finally {
      isSyncing = false;
    }
  }

  function updateClockAndCountdown() {
    const now = estimatedServerNowMs();
    els.serverClock.textContent = formatClock(now);

    if (!Number.isFinite(nextChangeTargetMs) || !Number.isFinite(now)) return;
    const remainingMs = Math.max(0, nextChangeTargetMs - now);
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    els.hours.textContent = String(hours).padStart(2, "0");
    els.minutes.textContent = String(minutes).padStart(2, "0");
    els.seconds.textContent = String(seconds).padStart(2, "0");
    els.countdownPanel.classList.toggle("is-urgent", totalSeconds > 0 && totalSeconds <= 300);

    if (remainingMs <= 0 && !boundaryRefreshScheduled) {
      boundaryRefreshScheduled = true;
      const jitter = Math.floor(Math.random() * (eventJitter + 1));
      window.setTimeout(() => syncData("boundary"), jitter);
    }
  }

  function schedulePeriodicSync() {
    window.clearTimeout(periodicTimer);
    const jitter = Math.floor(Math.random() * 7000);
    periodicTimer = window.setTimeout(async () => {
      await syncData("periodic");
      schedulePeriodicSync();
    }, syncInterval + jitter);
  }

  function init() {
    if (!isConfigured()) {
      showSetupState();
      window.setInterval(updateClockAndCountdown, 1000);
      return;
    }

    syncData("initial");
    schedulePeriodicSync();
    window.setInterval(updateClockAndCountdown, 1000);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") syncData("resume");
    });
    window.addEventListener("online", () => syncData("online"));
    window.addEventListener("offline", () => setConnection("offline", "Perangkat sedang offline"));
  }

  init();
})();
