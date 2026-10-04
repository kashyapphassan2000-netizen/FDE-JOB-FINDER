// FDE Job Finder service worker: makes the app installable and shows a friendly page when offline.
// Pages and data are always fetched live (fresh jobs) — only the app shell icons are cached.
const CACHE = 'fj-v1';
const SHELL = ['/icon-192.png', '/icon-512.png', '/icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return; // never cache data
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => new Response('<html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;background:#0d1424;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><h2>You are offline</h2><p>Connect to the internet to load the latest jobs.</p></div></body></html>', { headers: { 'Content-Type': 'text/html' } })));
    return;
  }
  if (SHELL.includes(url.pathname)) e.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
