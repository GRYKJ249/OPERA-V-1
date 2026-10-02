// يعمل من assets/ ويتحكم بكل الموقع (يحتاج ترويسة Service-Worker-Allowed من vercel.json)
const C = 'opera-v7', ROOT = new URL('../', self.location.href).href;
const SHELL = ['index.html', 'assets/css/styles.css', 'assets/js/main.js'].map(p => ROOT + p);
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// الشبكة أولاً (دائماً أحدث نسخة)، والكاش عند انقطاع الإنترنت
self.addEventListener('fetch', e => {
  const r = e.request;
  // لا نخزّن أبداً ردود /api (جلسات وبيانات خاصة)
  if (r.method !== 'GET' || !r.url.startsWith(ROOT) || new URL(r.url).pathname.startsWith('/api/')) return;
  e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); } return res; })
    .catch(() => caches.match(r).then(m => m || caches.match(ROOT + 'index.html'))));
});
