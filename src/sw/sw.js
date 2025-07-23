/* -------------------------------------------------------------------------
    src/sw/sw.js – Service-Worker
    -------------------------------------------------------------------------
    ▸ Hauptaufgaben
        1) App-Shell + offline.html precache (install)
        2) Statisches Caching alter Versionen bereinigen (activate)
        3) Requests bedienen (fetch)
            • JS, Bilder & Icons → Network-First (Runtime-Cache)
            • HTML-Navigation → Network-First (+ Offline-Fallback)
            • Rest →  Cache-First
        4) {type:'SKIP_WAITING'}-Nachricht empfangen (message)
    ---------------------------------------------------------------------- */
/* ========================== Konstanten ========================== */
// einheitlicher Präfix & scoped Cache-Name
const BASE_URL = self.registration.scope.replace(/src\/sw\/?$/, '');
const CACHE_PREFIX = 'handball-tracker';
const CACHE_VERSION = 'v3.12'; // Bei Upgrades die Version hochziehen
/**
 * Ein eindeutiger Cache-Name pro Deploy-Ort (Origin + Scope).
 * • vermeidet Kollisionen zwischen Dev-/Prod-Builds
 * • ersetzt alle früheren Stellen mit hardcodiertem String
 */
const CACHE_NAME =
    `${CACHE_PREFIX}-${BASE_URL.replace(/(^\w+:\/\/|\/$)/g, '')}-${CACHE_VERSION}`;

/* Pflicht-Assets für den Offline-Betrieb - alle Pfade relativ zum Scope */
const APP_SHELL = [
    '', // gleiches Ergebnis wie `${BASE_URL}`
    'index.html',
    'offline.html',
    'manifest.json',

    /* Core-Scripts */
    'src/js/header.js',
    'vendor/xlsx.full.min.js',
    'src/js/lib/idb-umd.js',
    'src/js/app.js',

    /* Styles (inkl. optionaler Source-Map) */
    'src/css/styles.css',
    // 'src/css/styles.css.map', // einkommentieren, wenn du die Map auslieferst

    /* Bilder */
    'src/images/goal-background.png',
    'src/images/scm_logo_sterne.jpg',

    /* Icons */
    'src/icons/icon-192.png',
    'src/icons/icon-512.png',
    'src/icons/icon-192-maskable.png',
    'src/icons/icon-512-maskable.png'
].map(path => new URL(path, BASE_URL).pathname);

/* -----------------------------------------------------------------------
    install – alles Notwendige zwischenspeichern
    -------------------------------------------------------------------- */
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            await Promise.all(
                APP_SHELL.map(url =>
                    fetch(url, {cache: 'no-store'})
                        .then(r => r.ok && cache.put(url, r))
                        .catch(() => console.warn('[SW] Skip precache', url))
                )
            );
            await self.skipWaiting(); // здесь достаточно
        })
    );
});

/* -----------------------------------------------------------------------
    activate – alte Caches bereinigen
    -------------------------------------------------------------------- */
self.addEventListener('activate', async event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
                    .map(k => caches.delete(k))
            )
        )
    );
    await self.clients.claim();
});

/* -----------------------------------------------------------------------
    fetch – 3 Strategien
    -------------------------------------------------------------------- */
self.addEventListener('fetch', event => {
    const {request} = event;
    const url = new URL(request.url);

    /* 1) HTML-Navigation (seitenweite Aufrufe) ----------------------- */
    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request));
        return;
    }

    /* 2) Runtime-Assets  (JS + Bilder)  ------------------------------ */
    const runtimeRegex = /\/src\/(?:js|css|images|icons|lib)\//;
    const runtimeMatch =
        (url.origin === location.origin) &&
        (runtimeRegex.test(url.pathname) || url.pathname.startsWith('/vendor/'));
    if (runtimeMatch) {
        event.respondWith(networkFirst(request));
        return;
    }

    /* 3) Default: Cache-First --------------------------------------- */
    event.respondWith(cacheFirst(request));
});

/* -----------------------------------------------------------------------
    message – sofortiges Update-Handling
    -------------------------------------------------------------------- */
self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') {
        console.log('[SW] ⚡ Skip Waiting empfangen – aktiviere neue Version');
        self.skipWaiting().then(() => {
            event.source?.postMessage?.({type: 'CLIENTS_CLAIMED'});
        });
    }
});

/* ===== Hilfsfunktionen ================================================= */
/** Network-First – bei Fehlern Offline-Seite / Cache-Fallback */
async function networkFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    const cachedPath = new URL(request.url).pathname.replace(/\?.*$/, '');
    try {
        const response = await fetch(request);
        if (request.method === 'GET' && response.ok) {
            await cache.put(cachedPath, response.clone());
        }
        return response;
    } catch (err) {
        /*  1) passende Cache-Kopie
            2) Offline-Fallback für HTML-Navigation */
        const cached = await cache.match(cachedPath);
        if (cached) return cached;

        if (request.mode === 'navigate') {
            const offlineURL = new URL('offline.html', BASE_URL).pathname;
            return cache.match(offlineURL);
        }
        throw err;
    }
}

/** Cache-First – Fallback → Network */
async function cacheFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
        const resp = await fetch(request);
        if (request.method === 'GET' && resp.ok) {
            await cache.put(request, resp.clone());
        }
        return resp;
    } catch (err) {
        if (request.destination === 'image') {
            return new Response(
                `<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">
                <rect width="100%" height="100%" fill="#ccc"/>
                <text x="50%" y="50%" font-size="20" dominant-baseline="middle" text-anchor="middle">Image offline</text>
            </svg>`,
                {headers: {'Content-Type': 'image/svg+xml'}}
            );
        }
        console.warn('[SW] Request fehlgeschlagen', request.url);
        throw err;
    }
}

// Ende src/sw/sw.js
