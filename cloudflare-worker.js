/**
 * TOKEN SOAL V1.1 — OPTIONAL Cloudflare Worker proxy/cache.
 * Add Settings > Variables and Secrets > APPS_SCRIPT_URL (plain text)
 * with your Google Apps Script /exec URL, then Deploy.
 * Cloudflare Worker sees ONLY current tokens returned by Apps Script.
 * Cache is never served past upcoming schedule boundary.
 */
const EDGE_CACHE_MAX_SECONDS = 20;
const BOUNDARY_GUARD_MS = 1800;
// Best-effort singleflight per Worker isolate to reduce concurrent origin requests.
let pendingOrigin = null;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }
    if (request.method !== 'GET') return reply({ ok: false, message: 'Gunakan GET.' }, 405);
    if (url.pathname === '/health') {
      return reply({ ok: true, version: '1.1.0', configured: Boolean(env.APPS_SCRIPT_URL) });
    }
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^\s]+\/exec(?:\?.*)?$/i.test(String(env.APPS_SCRIPT_URL || ''))) {
      return reply({ ok: false, message: 'Atur APPS_SCRIPT_URL pada Variables Worker.' }, 503);
    }

    const cache = caches.default;
    const key = new Request(`${url.origin}/__token_cache_v11`, { method: 'GET' });
    const now = Date.now();
    let snapshot = null;
    try {
      const hit = await cache.match(key);
      if (hit) {
        const candidate = await hit.json();
        if (isSnapshotSafe(candidate, now)) snapshot = candidate;
      }
    } catch (_) { /* Cache API may be unavailable during local development. */ }

    if (!snapshot) {
      try {
        if (!pendingOrigin) {
          pendingOrigin = (async () => {
            const upstream = await fetch(env.APPS_SCRIPT_URL, {
              method: 'GET', redirect: 'follow', headers: { Accept: 'application/json' },
              cf: { cacheTtl: 0 }
            });
            if (!upstream.ok) throw new Error(`Upstream HTTP ${upstream.status}`);
            const payload = await upstream.json();
            if (!payload || payload.ok !== true || payload.version !== '1.1.0' || !payload.classes) {
              throw new Error('Upstream harus Apps Script V1.1.');
            }
            const seconds = safeCacheSeconds(payload, Date.now());
            if (seconds >= 2) {
              const response = new Response(JSON.stringify(payload), {
                headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${seconds}` }
              });
              try { await cache.put(key, response); } catch (_) { /* Bypass cache if unavailable. */ }
            }
            return payload;
          })().finally(() => { pendingOrigin = null; });
        }
        snapshot = await pendingOrigin;
      } catch (err) {
        return reply({ ok: false, message: 'Sumber token sedang tidak dapat diakses. Silakan coba lagi.' }, 503);
      }
    }

    // Always stamp the live edge/server time, rather than the cached spreadsheet read time.
    const liveMs = Date.now();
    if (!isSnapshotSafe(snapshot, liveMs)) return reply({ ok: false, message: 'Sedang mengganti sesi token. Coba lagi.' }, 503);
    const result = { ...snapshot, serverTimeMs: liveMs };
    if (result.nextChange && Number.isFinite(Number(result.nextChange.atMs))) {
      result.nextChange = {
        ...result.nextChange,
        secondsUntil: Math.max(0, Math.ceil((Number(result.nextChange.atMs) - liveMs) / 1000))
      };
    }
    return reply(result, 200);
  }
};

function nearestBoundaryMs(data) {
  const values = [];
  if (Number.isFinite(Number(data?.nextChange?.atMs))) values.push(Number(data.nextChange.atMs));
  for (const info of Object.values(data?.classes || {})) {
    if (info?.status === 'active' && Number.isFinite(Number(info.endTimeMs))) {
      values.push(Number(info.endTimeMs));
    }
  }
  return values.length ? Math.min(...values) : Infinity;
}

function isSnapshotSafe(data, now) {
  if (!data || data.ok !== true || data.version !== '1.1.0') return false;
  // Reject a response if any active token has no explicit trusted expiry.
  for (const info of Object.values(data.classes || {})) {
    if (info?.status === 'active' && (!Number.isFinite(Number(info.endTimeMs)) || Number(info.endTimeMs) <= 0)) return false;
  }
  const created = Number(data.serverTimeMs);
  if (!Number.isFinite(created) || created > now + 10000 || now - created > EDGE_CACHE_MAX_SECONDS * 1000 + 4000) return false;
  return now < nearestBoundaryMs(data) - BOUNDARY_GUARD_MS;
}

function safeCacheSeconds(data, now) {
  const boundary = nearestBoundaryMs(data);
  const beforeBoundary = Number.isFinite(boundary)
    ? Math.floor((boundary - now - BOUNDARY_GUARD_MS) / 1000)
    : EDGE_CACHE_MAX_SECONDS;
  return Math.max(0, Math.min(EDGE_CACHE_MAX_SECONDS, beforeBoundary));
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '3600',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow, noarchive'
  };
}
function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(), 'Content-Type': 'application/json; charset=utf-8' }
  });
}
