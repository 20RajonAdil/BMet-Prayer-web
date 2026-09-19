/* BMet Prayer — Service Worker
   Scope: prayer-time notifications, plus the minimum real fetch handling
   Chrome requires to consider this site "installable" (the automatic
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
const RUNTIME_CACHE = 'bmet-runtime-v2';
const DATA_CACHE = 'bmet-data-v1';
const AUDIO_CACHE = 'bmet-audio-v1';
const AUDIO_HOST = 'archive.org';

// Hosts worth keeping a stale-while-revalidate copy of: prayer-time /
// Hijri lookups and Qur'an text. A cached response answers instantly
// (and offline), while a background fetch quietly refreshes it whenever
// there *is* a connection. Map tiles and recitation audio are
// deliberately left alone below — see the fetch handler.
const DATA_HOSTS = ['api.aladhan.com', 'api.alquran.cloud'];

const PRAYER_MESSAGES = {
    Fajr: 'The day begins with remembrance. Time for Fajr.',
    Dhuhr: 'A pause in the middle of the day, for the One who sustains it. Time for Dhuhr.',
    Asr: 'The afternoon light is a reminder in itself. Time for Asr.',
    Maghrib: 'As the sun sets, turn toward what matters. Time for Maghrib.',
    Isha: 'Close the day the way you opened it. Time for Isha.'
};

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then((keys) =>
                Promise.all(keys.filter((k) => k !== RUNTIME_CACHE && k !== DATA_CACHE && k !== AUDIO_CACHE).map((k) => caches.delete(k)))
            )
        ])
    );
});

async function staleWhileRevalidateData(request) {
    const cache = await caches.open(DATA_CACHE);
    const cached = await cache.match(request);
    const network = fetch(request)
        .then((res) => { if (res && res.ok) cache.put(request, res.clone()); return res; })
        .catch(() => null);
    return cached || (await network) || new Response(JSON.stringify({ code: 0, offline: true }), { status: 503, headers: { 'Content-Type': 'application/json' } });
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

// Network-First: only touches same-origin GET requests, and only ever
// falls back to a cached copy when the live network request fails. Prayer-
// time/Qur'an-text lookups get their own stale-while-revalidate handling
// above, and recitation audio gets its own Range-aware caching above too.
// Leaflet map tiles are the one thing left completely untouched, going
// straight to the network as normal — there are simply too many of them,
// covering too much of the globe, to usefully precache.
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);

    if (DATA_HOSTS.includes(url.hostname)) {
        event.respondWith(staleWhileRevalidateData(event.request));
        return;
    }

    if (url.hostname === AUDIO_HOST) {
        event.respondWith(serveAudioWithRange(event.request));
        return;
    }

    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                const copy = response.clone();
                caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
                return response;
            })
            .catch(() => caches.match(event.request))
    );
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
