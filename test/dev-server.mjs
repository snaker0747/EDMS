// เซิร์ฟเวอร์ทดสอบในเครื่อง: Worker ตัวจริง + Google จำลอง + ไฟล์หน้าเว็บใน public/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMockGoogle } from './mock-google.mjs';
import { createD1 } from './d1-mock.mjs';
import worker from '../src/index.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const mock = installMockGoogle();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const headersFile = fs.readFileSync(path.join(PUBLIC, '_headers'), 'utf8');
const globalHeaders = {};
for (const line of headersFile.split('\n').slice(1)) {
  if (!line.startsWith('  ')) break;
  const i = line.indexOf(':');
  globalHeaders[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const env = {
  ROOT_FOLDER_ID: 'ROOT', SHEET_ID: '', MAX_UPLOAD_MB: '40',
  GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', GOOGLE_REFRESH_TOKEN: 'z',
  SESSION_SECRET: 'dev-secret-dev-secret-1234567890', SETUP_KEY: 'dev-setup',
  DB: createD1(),
  ASSETS: {
    async fetch(req) {
      let p = new URL(req.url).pathname;
      if (p === '/') p = '/index.html';
      const file = path.join(PUBLIC, p);
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('not found', { status: 404 });
      return new Response(fs.readFileSync(file), { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', ...globalHeaders } });
    },
  },
};
const ctx = { waitUntil() {} };

export async function start(port = 8787) {
  const seed = await worker.fetch(new Request('http://localhost/api/setup', { method: 'POST', headers: { 'x-setup-key': 'dev-setup', 'content-type': 'application/json' }, body: JSON.stringify({ admin_username: 'admin', admin_password: 'Passw0rd!x', admin_name: 'ผู้ดูแลระบบ ทดสอบ' }) }), env, ctx);
  if (!seed.ok) throw new Error('seed failed ' + (await seed.text()));
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const url = `http://localhost:${port}${req.url}`;
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, duplex: 'half' }), env, ctx);
    const headers = {};
    r.headers.forEach((v, k) => (headers[k] = v));
    const sc = r.headers.getSetCookie?.();
    if (sc?.length) headers['set-cookie'] = sc;
    res.writeHead(r.status, headers);
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((ok) => server.listen(port, ok));
  return { server, mock, url: `http://localhost:${port}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await start();
  console.log('dev server', s.url);
}
