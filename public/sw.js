// Service worker: ทำให้ติดตั้งเป็นแอปได้ และเปิดหน้าเว็บได้เร็วขึ้น/ไม่ขาวเมื่อเน็ตหลุด
// ไม่แคช /api/* เด็ดขาด (ข้อมูลเอกสารและการล็อกอินต้องสดและเป็นของผู้ใช้เองเสมอ)
const VERSION = 'edms-v1';
const SHELL = ['/offline.html', '/app.css', '/icons/icon-192.png', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

async function networkFirst(req, fallbackUrl) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || (fallbackUrl && (await cache.match(fallbackUrl))) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') return void e.respondWith(networkFirst(req, '/offline.html'));
  if (/^\/(fonts|icons)\//.test(url.pathname)) return void e.respondWith(cacheFirst(req));
  if (/\.(js|css|svg|png|webmanifest)$/.test(url.pathname)) return void e.respondWith(networkFirst(req));
});
