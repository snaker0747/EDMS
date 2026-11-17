// Google Drive / Sheets / OAuth จำลองในหน่วยความจำ ใช้ทดสอบ Worker โดยไม่ต้องต่อ Google จริง
export function installMockGoogle() {
  const files = new Map(); // id -> {id,name,mimeType,parents,trashed,bytes,createdTime}
  const sheets = new Map(); // id -> { tabs: Map(title -> {sheetId, rows: [[]]}) }
  const sessions = new Map();
  let seq = 1;
  const nid = (p) => `${p}${(seq++).toString().padStart(4, '0')}`;
  const calls = [];

  const addFile = (f) => {
    const file = { createdTime: '2026-11-13T02:00:00Z', modifiedTime: '2026-11-13T02:00:00Z', trashed: false, parents: [], ...f };
    files.set(file.id, file);
    return file;
  };
  const fileOut = (f) => ({
    id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, trashed: f.trashed,
    size: f.bytes ? String(f.bytes.byteLength) : undefined, createdTime: f.createdTime, modifiedTime: f.modifiedTime,
    webViewLink: `https://drive.google.com/file/d/${f.id}/view`,
  });
  const J = (data, status = 200, headers = {}) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

  const FOLDER = 'application/vnd.google-apps.folder';
  addFile({ id: 'ROOT', name: 'เอกสารส่วนการโยธา สำนักช่าง', mimeType: FOLDER, parents: [] });
  addFile({ id: 'F_LETTERS', name: 'หนังสือราชการ', mimeType: FOLDER, parents: ['ROOT'] });
  addFile({ id: 'PDF1', name: 'หนังสือขอโอนมอบทางหลวงหมายเลข 3 ของแขวงกา.pdf', mimeType: 'application/pdf', parents: ['F_LETTERS'], bytes: new TextEncoder().encode('%PDF-1.4 one').buffer });
  addFile({ id: 'PDF2', name: 'หน้าหลังหนังสือขอโอนทางหลวง.pdf', mimeType: 'application/pdf', parents: ['F_LETTERS'], bytes: new TextEncoder().encode('%PDF-1.4 two').buffer });

  function parseRange(range) {
    const m = /^'?(.*?)'?(?:!(.*))?$/.exec(range);
    return { title: m[1], rest: m[2] || '' };
  }
  function colNum(s) { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }

  async function handle(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    const path = decodeURIComponent(u.pathname);
    calls.push(`${method} ${u.host}${path}`);
    const bodyText = typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : null;

    if (u.host === 'oauth2.googleapis.com') return J({ access_token: 'tok', expires_in: 3600 });

    if (u.host === 'upload.mock') {
      const s = sessions.get(path.split('/').pop());
      const bytes = init.body instanceof ArrayBuffer ? init.body : new Uint8Array(init.body).buffer;
      if (s.replaceId) {
        const f = files.get(s.replaceId);
        Object.assign(f, { bytes, mimeType: s.mime, name: s.meta.name ?? f.name, modifiedTime: '2026-11-17T02:00:00Z' });
        return J(fileOut(f));
      }
      return J(fileOut(addFile({ id: nid('UP'), name: s.meta.name, mimeType: s.mime, parents: s.meta.parents, bytes })));
    }

    if (u.host === 'www.googleapis.com' && path.startsWith('/upload/drive/v3/files')) {
      const sid = nid('S');
      const replaceId = path.split('/').length > 5 ? path.split('/').pop() : null;
      sessions.set(sid, { meta: JSON.parse(bodyText), mime: init.headers.get('x-upload-content-type'), replaceId });
      return new Response('', { status: 200, headers: { location: `https://upload.mock/s/${sid}` } });
    }

    if (u.host === 'www.googleapis.com' && path.startsWith('/drive/v3/files')) {
      const parts = path.split('/').filter(Boolean); // drive v3 files [id]
      const id = parts[3];
      if (!id) {
        if (method === 'GET') {
          const q = u.searchParams.get('q') || '';
          let list = [...files.values()];
          const par = /'([^']+)' in parents/.exec(q); if (par) list = list.filter((f) => f.parents.includes(par[1]));
          const nm = /name='([^']+)'/.exec(q); if (nm) list = list.filter((f) => f.name === nm[1]);
          const mt = /mimeType='([^']+)'/.exec(q); if (mt) list = list.filter((f) => f.mimeType === mt[1]);
          if (/trashed=false/.test(q)) list = list.filter((f) => !f.trashed);
          return J({ files: list.map(fileOut) });
        }
        const b = JSON.parse(bodyText);
        return J(fileOut(addFile({ id: nid('FD'), name: b.name, mimeType: b.mimeType, parents: b.parents || [] })));
      }
      const f = files.get(id);
      if (!f) return J({ error: { message: 'not found' } }, 404);
      if (method === 'GET' && u.searchParams.get('alt') === 'media') {
        return new Response(f.bytes, { status: 200, headers: { 'content-type': f.mimeType, 'content-length': String(f.bytes.byteLength) } });
      }
      if (method === 'GET') return J(fileOut(f));
      if (method === 'PATCH') {
        const b = JSON.parse(bodyText || '{}');
        const add = u.searchParams.get('addParents'); const rem = u.searchParams.get('removeParents');
        if (rem) f.parents = f.parents.filter((p) => p !== rem);
        if (add) f.parents.push(add);
        if ('name' in b) f.name = b.name;
        if ('trashed' in b) f.trashed = b.trashed;
        return J(fileOut(f));
      }
    }

    if (u.host === 'sheets.googleapis.com') {
      const parts = path.split('/').filter(Boolean); // v4 spreadsheets [id] [values/...]
      if (method === 'POST' && parts.length === 2) {
        const id = nid('SHEET');
        const b = JSON.parse(bodyText);
        sheets.set(id, { tabs: new Map([['Sheet1', { sheetId: 0, rows: [] }]]) });
        addFile({ id, name: b.properties.title, mimeType: 'application/vnd.google-apps.spreadsheet', parents: ['mydrive-root'] });
        return J({ spreadsheetId: id });
      }
      const rawId = parts[2] || '';
      const [id, action] = rawId.split(':');
      const sh = sheets.get(id);
      if (!sh) return J({ error: { message: 'no sheet' } }, 404);
      if (action === 'batchUpdate') {
        for (const r of JSON.parse(bodyText).requests) {
          if (r.addSheet) sh.tabs.set(r.addSheet.properties.title, { sheetId: seq++, rows: [] });
          if (r.deleteSheet) for (const [t, v] of sh.tabs) if (v.sheetId === r.deleteSheet.sheetId) sh.tabs.delete(t);
        }
        return J({});
      }
      if (parts.length === 3) return J({ sheets: [...sh.tabs].map(([title, v]) => ({ properties: { sheetId: v.sheetId, title } })) });
      // values
      const rangeAndAction = parts.slice(4).join('/');
      const range = rangeAndAction.replace(/:append$/, '');
      const { title, rest } = parseRange(range);
      const tab = sh.tabs.get(title);
      if (!tab) return J({ error: { message: `Unable to parse range: ${range}` } }, 400);
      if (method === 'GET') {
        let rows = tab.rows;
        const m = /^(?:([A-Z]+))?(\d+):(?:([A-Z]+))?(\d+)$/.exec(rest);
        if (m && m[2] === m[4]) rows = [tab.rows[Number(m[2]) - 1] || []];
        const trimmed = rows.map((r) => { const a = [...r]; while (a.length && a[a.length - 1] === '') a.pop(); return a; });
        while (trimmed.length && !trimmed[trimmed.length - 1].length) trimmed.pop();
        return J(trimmed.length ? { values: trimmed } : {});
      }
      const b = JSON.parse(bodyText);
      if (rangeAndAction.endsWith(':append')) {
        for (const row of b.values) tab.rows.push(row.map(String));
        return J({});
      }
      if (method === 'PUT') {
        const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(rest);
        const r0 = Number(m[2]) - 1; const c0 = colNum(m[1]) - 1;
        b.values.forEach((vals, i) => {
          const row = tab.rows[r0 + i] || (tab.rows[r0 + i] = []);
          for (let k = 0; k < c0; k++) if (row[k] === undefined) row[k] = '';
          vals.forEach((v, j) => (row[c0 + j] = String(v)));
        });
        return J({});
      }
    }
    return J({ error: { message: `mock: unhandled ${method} ${url}` } }, 500);
  }

  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => handle(String(url), init);
  return { files, sheets, calls, uninstall: () => (globalThis.fetch = realFetch) };
}
