// ระบบบริหารจัดการเอกสารอิเล็กทรอนิกส์ ส่วนการโยธา สำนักช่าง เทศบาลนครระยอง
import { HttpError, json } from './util.js';
import { readSession } from './auth.js';
import { makeCtx, findUser, isActive, getSettings } from './db.js';
import * as Docs from './routes/documents.js';
import * as Folders from './routes/folders.js';
import * as Users from './routes/users.js';
import { putSettings } from './routes/settings.js';
import { setup, adminSync } from './routes/setup.js';

const routes = [];
function add(method, path, access, handler) {
  const re = new RegExp('^' + path.replace(/:([a-z_]+)/g, '(?<$1>[^/]+)') + '$');
  routes.push({ method, re, access, handler });
}

// access: 'public' = ไม่ต้องล็อกอิน, 'user' = ผู้ใช้ทุกคน, 'admin' = เฉพาะผู้ดูแลระบบ
add('GET', '/api/health', 'public', async () => json({ ok: true }));
add('POST', '/api/setup', 'public', setup); // ป้องกันด้วย SETUP_KEY
add('POST', '/api/login', 'public', Users.login);
add('POST', '/api/logout', 'public', Users.logout);

add('GET', '/api/bootstrap', 'user', async (c) => {
  const [settings, folders] = await Promise.all([getSettings(c), Folders.folderPayload(c)]);
  return json({ me: Users.me(c.user), settings, ...folders });
});
add('POST', '/api/me/password', 'user', Users.changePassword);

add('GET', '/api/documents', 'user', Docs.listDocs);
add('POST', '/api/documents', 'user', Docs.createDoc);
add('GET', '/api/documents/:id', 'user', Docs.getDoc);
add('PATCH', '/api/documents/:id', 'user', Docs.updateDoc);
add('DELETE', '/api/documents/:id', 'admin', Docs.trashDoc);
add('POST', '/api/documents/:id/move', 'user', Docs.moveDoc);
add('POST', '/api/documents/:id/replace', 'user', Docs.replaceDoc);
add('GET', '/api/documents/:id/history', 'user', Docs.docHistory);
add('GET', '/api/documents/:id/file', 'user', Docs.fileDoc);

add('GET', '/api/folders', 'user', Folders.listFolders);
add('POST', '/api/folders', 'user', Folders.createFolder);
add('PATCH', '/api/folders/:id', 'admin', Folders.updateFolder);
add('DELETE', '/api/folders/:id', 'admin', Folders.deleteFolder);

add('PUT', '/api/settings', 'admin', putSettings);
add('POST', '/api/admin/sync', 'admin', adminSync);

add('GET', '/api/users', 'admin', Users.listUsers);
add('POST', '/api/users', 'admin', Users.createUser);
add('PATCH', '/api/users/:username', 'admin', Users.updateUser);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      // กัน CSRF: คำขอที่แก้ข้อมูลต้องมาจากหน้าเว็บของเราเอง
      if (!['GET', 'HEAD'].includes(request.method)) {
        const origin = request.headers.get('origin');
        if (origin && new URL(origin).host !== url.host) throw new HttpError(403, 'คำขอไม่ได้มาจากหน้าเว็บของระบบ');
      }
      const path = url.pathname.replace(/\/+$/, '') || '/';
      let params = null;
      let route = null;
      let methodMismatch = false;
      for (const r of routes) {
        const m = r.re.exec(path);
        if (!m) continue;
        if (r.method !== request.method) {
          methodMismatch = true;
          continue;
        }
        route = r;
        params = m.groups || {};
        for (const k of Object.keys(params)) params[k] = decodeURIComponent(params[k]);
        break;
      }
      if (!route) throw new HttpError(methodMismatch ? 405 : 404, methodMismatch ? 'ไม่รองรับวิธีเรียกนี้' : 'ไม่พบหน้าที่ขอ');

      const c = makeCtx(env, ctx);
      if (route.access !== 'public') {
        const username = await readSession(env, request);
        const row = username ? await findUser(c, username) : null;
        if (!row || !isActive(row)) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
        c.user = { username: row.username, display_name: row.display_name, role: row.role === 'admin' ? 'admin' : 'user' };
        if (route.access === 'admin' && c.user.role !== 'admin') throw new HttpError(403, 'ต้องเป็นผู้ดูแลระบบเท่านั้น');
      }
      return await route.handler(c, params, request);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error('unhandled', e?.stack || e);
      return json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }, 500);
    }
  },
};
