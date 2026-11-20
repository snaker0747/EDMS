// Service worker: ทำให้ติดตั้งเป็นแอปได้ และเปิดหน้าเว็บได้เร็วขึ้น/ไม่ขาวเมื่อเน็ตหลุด
// ไม่แคช /api/* เด็ดขาด (ข้อมูลเอกสารและการล็อกอินต้องสดและเป็นของผู้ใช้เองเสมอ)
const VERSION = 'edms-v2';
const SHARE_CACHE = 'edms-share'; // พักไฟล์ที่แชร์มาจากแอปอื่น (เช่น LINE) รอหน้าอัปโหลดมารับ
const SHELL = ['/offline.html', '/app.css', '/icons/icon-192.png', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== SHARE_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
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

// แชร์ไฟล์จากแอปอื่น (Web Share Target): รับ POST แล้วเก็บไฟล์ไว้ชั่วคราว จากนั้นพาไปหน้าอัปโหลด
async function takeShare(req) {
  try {
    const form = await req.formData();
    const files = form.getAll('files').filter((f) => f && typeof f === 'object' && f.size > 0);
    const cache = await caches.open(SHARE_CACHE);
    for (const old of await cache.keys()) await cache.delete(old);
    const stamp = Date.now();
    let i = 0;
    for (const f of files) {
      await cache.put(`/__shared/${stamp}-${i++}`, new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-filename': encodeURIComponent(f.name || 'ไฟล์ที่แชร์') } }));
    }
    return Response.redirect(`/upload.html?shared=${files.length}`, 303);
  } catch {
    return Response.redirect('/upload.html?shared=err', 303);
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method === 'POST' && new URL(req.url).pathname === '/share-target') return void e.respondWith(takeShare(req));
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') return void e.respondWith(networkFirst(req, '/offline.html'));
  if (/^\/(fonts|icons)\//.test(url.pathname)) return void e.respondWith(cacheFirst(req));
  if (/\.(js|css|svg|png|webmanifest)$/.test(url.pathname)) return void e.respondWith(networkFirst(req));
});
