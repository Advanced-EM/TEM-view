// Offline support for the exhibits (TEM-view, Ruska 1933, Scanning 1938–2002, Electron Explorer), so a museum
// kiosk keeps running with the network unplugged. Same-origin GET requests only:
// - pages and anything unversioned: network first, the cached copy when offline;
// - versioned files (?v=…, see tools/stamp.mjs), fonts, three.js, voice clips and pack images: cache first;
// - {type: 'precache', urls} (Electron Explorer's staff menu) stores a list of files ahead of time, reporting
//   progress on the message port.
// Nothing is sent anywhere; cross-origin requests (Pyodide, usage records) pass straight through.
const CACHE = 'seeing-with-electrons-1';
const immutable = (u) => u.searchParams.has('v') || /\/(fonts|vendor)\/|\.(mp3|woff2|svg|png|jpg|webp)$/.test(u.pathname);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE && k.startsWith('seeing-with-electrons')) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // audio players ask for byte ranges: answer them from a cached whole file
    const range = req.headers.get('range');
    if (range) {
      const hit = await cache.match(u.href); if (!hit) return fetch(req);
      const buf = await hit.arrayBuffer(), [, a, b] = /bytes=(\d*)-(\d*)/.exec(range) ?? [, '0', ''];
      const start = +a || 0, end = b ? Math.min(+b, buf.byteLength - 1) : buf.byteLength - 1;
      return new Response(buf.slice(start, end + 1), { status: 206, headers: { 'Content-Type': hit.headers.get('Content-Type') || 'audio/mpeg',
        'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
    }
    if (immutable(u)) {
      const hit = await cache.match(req); if (hit) return hit;
      const r = await fetch(req); if (r.ok) cache.put(req, r.clone()); return r;
    }
    try {
      const r = await fetch(req); if (r.ok) cache.put(req, r.clone()); return r;
    } catch (err) {
      return (await cache.match(req)) ?? (await cache.match(req, { ignoreSearch: true })) ?? Response.error();
    }
  })());
});

self.addEventListener('message', (e) => {
  if (e.data?.type !== 'precache') return;
  const port = e.ports[0], urls = (e.data.urls || []).filter((x) => new URL(x).origin === location.origin);
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE); let done = 0;
    for (let i = 0; i < urls.length; i += 6) {
      await Promise.all(urls.slice(i, i + 6).map(async (x) => { try { const r = await fetch(x, { cache: 'reload' }); if (r.ok) await cache.put(x, r); } catch { /* skipped */ } done++; }));
      port?.postMessage({ done, all: urls.length });
    }
    if (!urls.length) port?.postMessage({ done: 0, all: 0 });
  })());
});
