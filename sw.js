// Offline support for the website (an installable web app). Pages are fetched fresh when online and served from
// the cache when offline; scripts and styles carry a version stamp (tools/stamp.mjs), so caching them is safe.
// Large narration audio and the Python IDE's packages are cached only once they have been used.
const CACHE = 'tem-view-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const url = new URL(r.url);
  // the session collector and the mailing list are never cached
  if (url.hostname.endsWith('workers.dev') || url.hostname.endsWith('huggingface.co')) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); return res; }).catch(() => caches.match(r).then((m) => m || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) => {
    // only whole responses: partial (206) audio responses cannot be cached
    if (res.status === 200 || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); }
    return res;
  })));
});
