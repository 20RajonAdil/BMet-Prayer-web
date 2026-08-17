/* BMet Prayer — Service Worker
   Scope: prayer-time notifications only. This file intentionally does NOT
   cache/serve the site's pages or assets, so the live site (prayer times,
   Qibla, Qur'an audio, everything) is never served stale from a cache —
   every visit still loads the current version straight from GitHub Pages.

   What this can and can't do, honestly:
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

const PRAYER_MESSAGES = {
    Fajr: 'The day begins with remembrance. Time for Fajr.',
    Dhuhr: 'A pause in the middle of the day, for the One who sustains it. Time for Dhuhr.',
    Asr: 'The afternoon light is a reminder in itself. Time for Asr.',
    Maghrib: 'As the sun sets, turn toward what matters. Time for Maghrib.',
    Isha: 'Close the day the way you opened it. Time for Isha.'
};

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

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
