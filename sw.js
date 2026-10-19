/* BMet Prayer — Service Worker
   Scope: full offline support (the app shell, icons, map code and fonts are
   saved on first visit), prayer-time notifications, and the real fetch
   handling Chrome requires to consider this site "installable" (the automatic
   "Install app" banner — the same one you get on weather.com — needs a
   registered service worker with a genuine fetch handler; Chrome
   specifically ignores empty/no-op ones, so this has to actually do
   something). The strategy below is Network-First: it always tries the
   real network first, so prayer times/Qibla/Qur'an audio/everything stay
   live and current — a cached copy is only ever used as a fallback if the
   network request genuinely fails (i.e. offline), never instead of a
   working live response.

   What the notification side of this can and can't do, honestly:
   - While the site/PWA is open (including in a background tab, or the
     PWA running behind other apps), the page itself checks the clock
     against today's prayer times and calls registration.showNotification()
     via this worker — that's the reliable path, and it's what most users
     will experience day to day.
   - The periodicsync handler below is a best-effort extra: on supported
     Chromium/Android installs, the browser MAY occasionally wake this
     worker even when the app is fully closed, and it re-checks prayer
     times then. The browser — not this code — decides if/when that
     happens (usually based on how often the PWA is used), so it is not
     a substitute for opening the app. True guaranteed delivery at an
     exact time, with the app fully closed, needs a server sending real
     push messages — this static, backend-less site doesn't have one.
*/

const NOTIFIED_STORE = 'bmet-notified-store';
const SETTINGS_STORE = 'bmet-settings-store';
const DB_NAME = 'bmet-prayer-db';
const SHELL_CACHE = 'bmet-shell-v5';      // the app itself (HTML, icons, images, CSS)
const RUNTIME_CACHE = 'bmet-runtime-v3';  // other same-origin files, refreshed whenever online
const CDN_CACHE = 'bmet-cdn-v2';          // Font Awesome, Leaflet, Google Fonts
const DATA_CACHE = 'bmet-data-v1';
const AUDIO_CACHE = 'bmet-audio-v1';
const AUDIO_HOST = 'archive.org';
const KEEP_CACHES = [SHELL_CACHE, RUNTIME_CACHE, CDN_CACHE, DATA_CACHE, AUDIO_CACHE];

// Everything needed to open and use the site with no connection at all.
// Each file is cached on its own, so one missing file can never stop the
// whole install.
const SHELL_FILES = [
    './', './index.html', './manifest.json', './tailwind.css',
    './bmet-logo.png', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
    './favicon.ico', './favicon-32x32.png', './favicon-16x16.png',
    './Talha.png', './adil.png', './picture2.jpg'
];
// Third-party files the page needs to look and work right (icons, map code, fonts).
const CDN_FILES = [
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-regular-400.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-brands-400.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&family=Amiri:wght@400;700&family=Amiri+Quran&family=Scheherazade+New:wght@400;700&family=Lateef:wght@400;700&family=Reem+Kufi:wght@400;700&family=Aref+Ruqaa:wght@400;700&family=Harmattan:wght@400;700&family=Markazi+Text:wght@400;500;600;700&family=Cairo:wght@400;600;700&family=Rakkas&display=swap'
];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const NETWORK_TIMEOUT_MS = 5000; // on a weak/captive connection, give up and use the saved copy

// Hosts whose answers should be remembered for offline use: prayer-time /
// Hijri lookups and Qur'an text. Network-first, so the times shown are
// always today's (important on the day the clocks change) — the saved copy
// is only used if the network fails or is too slow.
const DATA_HOSTS = ['api.aladhan.com', 'api.alquran.cloud'];

const PRAYER_MESSAGES = {
    Fajr: 'The day begins with remembrance. Time for Fajr.',
    Dhuhr: 'A pause in the middle of the day, for the One who sustains it. Time for Dhuhr.',
    Asr: 'The afternoon light is a reminder in itself. Time for Asr.',
    Maghrib: 'As the sun sets, turn toward what matters. Time for Maghrib.',
    Isha: 'Close the day the way you opened it. Time for Isha.'
};

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const shell = await caches.open(SHELL_CACHE);
        await Promise.allSettled(SHELL_FILES.map((f) => shell.add(new Request(f, { cache: 'reload' }))));
        const cdn = await caches.open(CDN_CACHE);
        await Promise.allSettled(CDN_FILES.map((u) => cdn.add(new Request(u, { mode: 'cors' }))));
        await self.skipWaiting();
    })());
});
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then((keys) =>
                Promise.all(keys.filter((k) => !KEEP_CACHES.includes(k)).map((k) => caches.delete(k)))
            )
        ])
    );
});

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ]);
}
function cacheable(res) { return res && (res.ok || res.type === 'opaque'); }

// Live answer first; saved copy if the network fails or is too slow.
async function networkFirst(request, cacheName, timeoutMs) {
    const cache = await caches.open(cacheName);
    try {
        const res = await withTimeout(fetch(request), timeoutMs);
        if (cacheable(res)) cache.put(request, res.clone()).catch(() => {});
        return res;
    } catch (e) {
        const cached = await cache.match(request, { ignoreVary: true });
        if (cached) return cached;
        throw e;
    }
}

async function dataRequest(request) {
    try {
        return await networkFirst(request, DATA_CACHE, 4000);
    } catch (e) {
        // Page treats a non-200 `code` as "unavailable" and falls back to its own on-device calculation.
        return new Response(JSON.stringify({ code: 0, offline: true }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
}

// Icons / map code / fonts never change at a given URL, so saved copy first.
async function cdnRequest(request) {
    const cache = await caches.open(CDN_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
        const res = await fetch(request);
        if (cacheable(res)) cache.put(request, res.clone()).catch(() => {});
        return res;
    } catch (e) {
        return new Response('', { status: 503, statusText: 'Offline' });
    }
}

// The site's own files. Live when online, saved copy when not. Opening the
// site (any address inside it) with no connection always gets the saved page.
async function appRequest(request) {
    try {
        const res = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
        if (res && res.ok) {
            const copy = res.clone();
            caches.open(request.mode === 'navigate' ? SHELL_CACHE : RUNTIME_CACHE).then((cache) => {
                cache.put(request.mode === 'navigate' ? new Request('./index.html') : request, copy);
            }).catch(() => {});
        }
        return res;
    } catch (e) {
        const cached = (await caches.match(request, { ignoreSearch: true })) ||
                       (request.mode === 'navigate' ? (await caches.match('./index.html')) || (await caches.match('./')) : null);
        if (cached) return cached;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
}

/* Recitation audio (archive.org). Each surah track is fetched in full
   exactly once — either by the background "save all recitation for
   offline" pass, or the first time someone plays it — and kept as a
   complete file in AUDIO_CACHE, keyed by URL with the Range header
   stripped. Actual playback requests a byte range (that's how the
   <audio> element supports seeking), so a cached full file is sliced by
   hand into a proper 206 Partial Content response for those. Requires
   the <audio> element to be crossorigin="anonymous" so these are real
   readable responses rather than opaque ones the worker can't inspect. */
async function serveAudioWithRange(request) {
    const cache = await caches.open(AUDIO_CACHE);
    const cacheKey = request.url.split('#')[0];
    const cached = await cache.match(cacheKey);
    const rangeHeader = request.headers.get('range');

    if (cached) {
        if (!rangeHeader) return cached.clone();
        try {
            const buffer = await cached.clone().arrayBuffer();
            const total = buffer.byteLength;
            if (total === 0) throw new Error('opaque-or-empty');
            const m = /bytes=(\d+)-(\d+)?/.exec(rangeHeader);
            const start = m ? parseInt(m[1], 10) : 0;
            const end = m && m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
            return new Response(buffer.slice(start, end + 1), {
                status: 206,
                statusText: 'Partial Content',
                headers: {
                    'Content-Type': cached.headers.get('Content-Type') || 'audio/ogg',
                    'Content-Range': `bytes ${start}-${end}/${total}`,
                    'Content-Length': String(end - start + 1),
                    'Accept-Ranges': 'bytes',
                },
            });
        } catch (e) {
            // Cached response turned out unreadable (e.g. opaque) — treat as
            // not cached and fall through to the network below.
        }
    }

    if (!rangeHeader) {
        // A plain, non-range request — this is how the background
        // "save all recitation" pass fetches each surah, so cache the
        // full response for offline playback afterwards.
        try {
            const res = await fetch(request);
            if (res && res.ok) cache.put(cacheKey, res.clone());
            return res;
        } catch (e) {
            return new Response('Offline', { status: 503, statusText: 'Offline' });
        }
    }

    // Nothing cached yet and this is a normal ranged playback request —
    // stream straight from the network as usual.
    try { return await fetch(request); }
    catch (e) { return new Response('Offline', { status: 503, statusText: 'Offline' }); }
}

// Routing. Map tiles and anything else third-party (e.g. IP lookups) go
// straight to the network untouched — far too many tiles to precache.
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);

    if (DATA_HOSTS.includes(url.hostname)) { event.respondWith(dataRequest(event.request)); return; }
    if (url.hostname === AUDIO_HOST) { event.respondWith(serveAudioWithRange(event.request)); return; }
    if (CDN_HOSTS.includes(url.hostname)) { event.respondWith(cdnRequest(event.request)); return; }
    if (url.origin !== self.location.origin) return;

    event.respondWith(appRequest(event.request));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            for (const client of list) {
                if ('focus' in client) return client.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow('./index.html');
        })
    );
});

// Best-effort background wake-up. See file header — not guaranteed.
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'bmet-prayer-check') {
        event.waitUntil(checkAndNotify());
    }
});

// Some browsers only support one-off Background Sync, fired on reconnect —
// harmless to also hook this as another best-effort trigger.
self.addEventListener('sync', (event) => {
    if (event.tag === 'bmet-prayer-check') {
        event.waitUntil(checkAndNotify());
    }
});

async function checkAndNotify() {
    try {
        const settings = await idbGet(SETTINGS_STORE, 'settings');
        if (!settings || !settings.enabled || !settings.coords) return;

        const today = new Date();
        const dateStr = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
        const url = `https://api.aladhan.com/v1/timings/${dateStr}?latitude=${settings.coords.lat}&longitude=${settings.coords.lon}&method=2`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const timings = data && data.data && data.data.timings;
        if (!timings) return;

        const dayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
        const notifiedToday = (await idbGet(NOTIFIED_STORE, dayKey)) || [];
        const nowMs = Date.now();
        const prayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

        for (const name of prayers) {
            if (!settings.prayers || !settings.prayers[name]) continue;
            if (notifiedToday.includes(name)) continue;
            const raw = (timings[name] || '').split(' ')[0];
            if (!raw || !raw.includes(':')) continue;
            const [h, m] = raw.split(':').map(Number);
            const prayerDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, 0);
            const diffMin = (nowMs - prayerDate.getTime()) / 60000;

            // Fire for anything that started in roughly the last 15 minutes,
            // so a late wake-up still catches a recent prayer time.
            if (diffMin >= 0 && diffMin <= 15) {
                await self.registration.showNotification(`${name} — MAAR Prayer Reminder`, {
                    body: `${PRAYER_MESSAGES[name] || ''} (${raw})`,
                    icon: 'icon-192.png',
                    badge: 'icon-192.png',
                    tag: 'bmet-prayer-' + name,
                    renotify: false,
                    silent: false,
                    data: { prayer: name }
                });
                notifiedToday.push(name);
            }
        }
        await idbSet(NOTIFIED_STORE, dayKey, notifiedToday);
    } catch (e) {
        // No UI to report to from here — fail quietly, the page-driven
        // checker (the reliable path) will catch up next time it's open.
    }
}

/* ---- Minimal IndexedDB key/value helper (no external libraries) ---- */
function idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(NOTIFIED_STORE)) db.createObjectStore(NOTIFIED_STORE);
            if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function idbGet(store, key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function idbSet(store, key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
