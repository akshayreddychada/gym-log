// Network first so updates land on the next open; cached copy keeps the app working offline.
const CACHE = 'gym-log-v4';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'js/app.js', 'js/data.js', 'js/charts.js',
  'js/config.js', 'js/db-firebase.js', 'js/foods.js', 'js/library.js', 'js/nutrition.js', 'js/body.js', 'js/journey.js', 'vendor/firebase.js', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const fonts = url.hostname.endsWith('googleapis.com') && url.pathname.startsWith('/css') || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !fonts) return; // Firebase traffic goes straight to the network.
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
