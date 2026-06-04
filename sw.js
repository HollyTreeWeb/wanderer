/* Wanderer service worker — offline app shell + map tile caching.
   Bump CACHE on each deploy to force clients to pick up new files. */
const CACHE = 'wanderer-v2.4.0';
const TILE_CACHE = 'wanderer-tiles-v1';

// Files that make up the app shell. allSettled so one 404 won't abort install.
const SHELL = [
  './',
  'index.html',
  'wanderer.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Dynamic data APIs: never intercept — always hit the network so sync,
  // geocoding and exchange rates are never served stale.
  if (/(api\.github\.com|nominatim\.openstreetmap\.org|api\.frankfurter\.app|api\.open-meteo\.com)/.test(url.host)) {
    return;
  }

  // Map tiles: cache-first so trips you've already viewed render offline.
  if (/tile\.openstreetmap\.org/.test(url.host)) {
    e.respondWith((async () => {
      const c = await caches.open(TILE_CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.ok) c.put(req, res.clone());
        return res;
      } catch (err) {
        return hit || Response.error();
      }
    })());
    return;
  }

  // HTML documents: network-first so a freshly deployed app shows immediately,
  // falling back to cache when offline.
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req).then(h => h || caches.match('wanderer.html')))
    );
    return;
  }

  // Everything else (icons, Leaflet assets, etc.): cache-first.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(req, clone));
      }
      return res;
    }))
  );
});
