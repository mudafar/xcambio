// The deploy workflow replaces VERSION with the commit SHA, so every deploy
// installs a fresh cache. When deploying another way, bump it by hand.
const VERSION = 'dev';
const CACHE_NAME = `cambiox-${VERSION}`;

// Paths are relative to this file, so the app works under /xcambio/ on
// GitHub Pages, on a custom domain, or on a local server.
const APP_SHELL = [
  './',
  'index.html',
  'style.css',
  'core.js',
  'app.js',
  'manifest.json',
  'icons/favicon.svg',
  'icons/favicon-48.png',
  'icons/mark.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
  'fonts/space-grotesk-latin-wght-normal.woff2',
  'fonts/inter-latin-wght-normal.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // cache: 'reload' skips the HTTP cache so a new version never precaches old files.
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Rates (ve.dolarapi.com) are not handled here on purpose: the page shows the
  // last saved rates instantly from localStorage and revalidates them over the
  // network with the browser's HTTP cache (ETag → 304), so the service worker
  // never serves an outdated rate and the refresh button always reaches the API.
  if (url.origin !== self.location.origin) return;

  // Cache first: launching the installed app never waits on the network.
  // Updates arrive through a new sw.js (new VERSION) and apply on the next launch.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./', { ignoreSearch: true }).then((cached) => cached || fetch(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
