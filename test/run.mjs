import assert from 'node:assert/strict';
import { installMockGoogle } from './mock-google.mjs';
import { createD1 } from './d1-mock.mjs';
import worker from '../src/index.js';

const mock = installMockGoogle();
const env = {
  ROOT_FOLDER_ID: 'ROOT',
  SHEET_ID: '',
  MAX_UPLOAD_MB: '1',
  GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', GOOGLE_REFRESH_TOKEN: 'z',
  SESSION_SECRET: 'test-secret-test-secret-1234567890',
  SETUP_KEY: 'setup-key-123',
  DB: createD1(),
  ASSETS: { fetch: async () => new Response('static') },
};
const ctx = { waitUntil: (p) => pending.push(p) };
const pending = [];
const BASE = 'https://edms.rayongcity.workers.dev';
const jar = new Map(); // จำลองคุกกี้ของเบราว์เซอร์

async function call(method, path, { body, form, key, headers = {}, noCookie } = {}) {
  const h = new Headers(headers);
  if (jar.size && !noCookie) h.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
  if (key) h.set('x-setup-key', key);
  let b;
  if (form) b = form;
  else if (body !== undefined) { h.set('content-type', 'application/json'); b = JSON.stringify(body); }
  const res = await worker.fetch(new Request(BASE + path, { method, headers: h, body: b }), env, ctx);
  await Promise.all(pending.splice(0));
  for (const sc of res.headers.getSetCookie()) {
    const [kv] = sc.split(';');
    const i = kv.indexOf('=');
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    if (!v || /Max-Age=0/.test(sc)) jar.delete(k); else jar.set(k, v);
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data, headers: res.headers };
}
const ok = (r, s = 200) => assert.equal(r.status, s, JSON.stringify(r.data));
let n = 0;
const step = (name) => console.log(`${String(++n).padStart(2, '0')} ${name}`);

// ---- ก่อนตั้งค่า ----
step('ยังไม่ล็อกอินเรียก API ไม่ได้');
assert.equal((await call('GET', '/api/documents')).status, 401);
step('ล็อกอินก่อนตั้งค่าระบบ = 503 (ยังไม่มีชีต)');
assert.equal((await call('POST', '/api/login', { body: { username: 'a', password: 'b' } })).status, 503);

step('setup ผิดรหัส = 403');
ok(await call('POST', '/api/setup', { key: 'wrong', body: {} }), 403);

step('setup ครั้งแรก: สร้างชีต ผู้ดูแล ซิงก์ของเดิม');
let r = await call('POST', '/api/setup', { key: 'setup-key-123', body: { admin_username: 'Admin', admin_password: 'Passw0rd!x', admin_name: 'ผู้ดูแล' } });
ok(r);
assert.equal(r.data.admin_created, true);
assert.equal(r.data.synced.documents_added, 2);
assert.equal(r.data.synced.folders_added, 2);
const sheetId = r.data.sheet_id;
assert.ok([...mock.sheets.get(sheetId).tabs.keys()].includes('เอกสาร'));
assert.ok(![...mock.sheets.get(sheetId).tabs.keys()].includes('Sheet1'), 'ลบ Sheet1 เริ่มต้น');
assert.equal(mock.files.get(sheetId).parents.includes('ROOT'), true, 'ชีตอยู่ในโฟลเดอร์หลัก');

step('setup ซ้ำ: ไม่สร้างของเดิมซ้ำ');
r = await call('POST', '/api/setup', { key: 'setup-key-123', body: { admin_username: 'other', admin_password: 'Passw0rd!x' } });
ok(r);
assert.equal(r.data.admin_created, false);
assert.equal(r.data.synced.documents_added, 0);
assert.equal(r.data.sheet_id, sheetId);

// ---- ล็อกอิน ----
step('ล็อกอินผิด = 401 / ถูก = 200 + คุกกี้');
ok(await call('POST', '/api/login', { body: { username: 'admin', password: 'wrongwrong' } }), 401);
r = await call('POST', '/api/login', { body: { username: 'ADMIN', password: 'Passw0rd!x' } });
ok(r);
assert.equal(r.data.user.role, 'admin');
assert.match(r.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
assert.match(r.headers.get('set-cookie'), /Max-Age=43200;/, 'ไม่ติ๊กจดจำ = 12 ชั่วโมง');
const rm = await call('POST', '/api/login', { body: { username: 'admin', password: 'Passw0rd!x', remember: true } });
ok(rm);
assert.match(rm.headers.get('set-cookie'), /Max-Age=2592000;/, 'ติ๊กจดจำ = 30 วัน');

step('bootstrap: โฟลเดอร์ + ตั้งค่า + จำนวนเอกสาร');
r = await call('GET', '/api/bootstrap'); ok(r);
assert.equal(r.data.folders.length, 2);
const letters = r.data.folders.find((f) => f.name === 'หนังสือราชการ');
assert.equal(letters.doc_count, 2);
assert.equal(letters.path, 'เอกสารส่วนการโยธา สำนักช่าง › หนังสือราชการ');
assert.deepEqual(r.data.settings.doc_types.slice(0, 2), ['หนังสือรับ', 'หนังสือส่ง']);

step('รายการเอกสารที่ซิงก์มา (ยังไม่กรอกรายละเอียด)');
r = await call('GET', '/api/documents'); ok(r);
assert.equal(r.data.documents.length, 2);
const synced = r.data.documents.find((d) => d.id === 'PDF1');
assert.equal(synced.title, 'หนังสือขอโอนมอบทางหลวงหมายเลข 3 ของแขวงกา');
assert.equal(synced.doc_type, '');
assert.equal(synced.uploader, 'บัญชีส่วนกลาง');

// ---- ตั้งค่า / ช่องเพิ่มเติม ----
step('แอดมินเพิ่มช่องรายละเอียดเอง (บังคับกรอก)');
r = await call('PUT', '/api/settings', { body: { fields: [{ label: 'หน่วยงานต้นเรื่อง', kind: 'text', required: true }, { label: 'ความเร่งด่วน', kind: 'select', options: ['ปกติ', 'ด่วน'] }] } });
ok(r);
const [fAgency, fUrgent] = r.data.settings.fields;
assert.match(fAgency.key, /^f_[a-z0-9]{8}$/);

// ---- อัปโหลด ----
const pdfBytes = new TextEncoder().encode('%PDF-1.4 hello');
function uploadForm(meta, name = 'a.pdf', bytes = pdfBytes) {
  const f = new FormData();
  f.set('meta', JSON.stringify(meta));
  f.set('file', new File([bytes], name, { type: 'application/pdf' }));
  return f;
}
const goodMeta = { title: 'บันทึกขออนุมัติปรับปรุงผิวจราจร', doc_no: 'รย 52004/123', doc_date: '2026-11-10', doc_type: 'หนังสือส่ง', fiscal_year: '2570', folder_id: letters.id, tags: 'ถนน, ผิวจราจร, ถนน', note: 'ทดสอบ', extra: { [fAgency.key]: 'กองช่าง', [fUrgent.key]: 'ด่วน' } };

step('อัปโหลดขาดช่องบังคับ = 400');
ok(await call('POST', '/api/documents', { form: uploadForm({ ...goodMeta, extra: {} }) }), 400);
step('อัปโหลดประเภทผิด/ไฟล์ .exe = 4xx');
ok(await call('POST', '/api/documents', { form: uploadForm({ ...goodMeta, doc_type: 'ไม่มีจริง' }) }), 400);
ok(await call('POST', '/api/documents', { form: uploadForm(goodMeta, 'virus.exe') }), 415);
step('อัปโหลดไฟล์ใหญ่เกินกำหนด = 413');
ok(await call('POST', '/api/documents', { form: uploadForm(goodMeta, 'big.pdf', new Uint8Array(1.5 * 1048576)) }), 413);
step('อัปโหลดโฟลเดอร์ที่ไม่อยู่ในระบบ = 400');
ok(await call('POST', '/api/documents', { form: uploadForm({ ...goodMeta, folder_id: 'ROOT_FAKE' }) }), 400);

step('อัปโหลดสำเร็จ → ไฟล์อยู่ใน Drive + มีแถวในชีต');
r = await call('POST', '/api/documents', { form: uploadForm(goodMeta) });
ok(r, 201);
const doc = r.data.document;
assert.equal(doc.tags, 'ถนน, ผิวจราจร');
assert.equal(doc.uploader, 'ผู้ดูแล');
assert.deepEqual(doc.extra[fUrgent.key], 'ด่วน');
const driveFile = mock.files.get(doc.id);
assert.equal(driveFile.name, 'บันทึกขออนุมัติปรับปรุงผิวจราจร.pdf');
assert.deepEqual(driveFile.parents, [letters.id]);
const docTab = mock.sheets.get(sheetId).tabs.get('เอกสาร').rows;
assert.ok(docTab.some((row) => row[0] === doc.id && row[1] === doc.title));

step('เปิดไฟล์ผ่าน Worker (inline) + ดาวน์โหลด');
r = await call('GET', `/api/documents/${doc.id}/file`);
ok(r);
assert.match(r.headers.get('content-disposition'), /^inline;/);
assert.equal(new TextDecoder().decode(r.data), '%PDF-1.4 hello');
r = await call('GET', `/api/documents/${doc.id}/file?download=1`);
assert.match(r.headers.get('content-disposition'), /^attachment;/);
assert.match(r.headers.get('content-disposition'), /filename\*=UTF-8''/);
step('ขอไฟล์ที่ไม่ได้อยู่ในระบบ (id ของ Drive แต่ไม่มีแถว) = 404');
ok(await call('GET', '/api/documents/ROOT/file'), 404);

step('แก้ไขรายละเอียด + เปลี่ยนชื่อ → เปลี่ยนชื่อใน Drive ด้วย');
r = await call('PATCH', `/api/documents/${doc.id}`, { body: { title: 'ขออนุมัติ (แก้ไข)', note: 'ใหม่' } });
ok(r);
assert.equal(mock.files.get(doc.id).name, 'ขออนุมัติ (แก้ไข).pdf');
assert.equal(r.data.document.note, 'ใหม่');
assert.equal(r.data.document.doc_no, 'รย 52004/123', 'ฟิลด์อื่นไม่หาย');

step('สร้างโฟลเดอร์ + ชื่อซ้ำ = 409');
r = await call('POST', '/api/folders', { body: { name: 'โครงการก่อสร้าง', parent_id: 'ROOT' } });
ok(r, 201);
const projects = r.data.folder;
assert.equal(mock.files.get(projects.id).parents[0], 'ROOT');
ok(await call('POST', '/api/folders', { body: { name: 'โครงการก่อสร้าง', parent_id: 'ROOT' } }), 409);
r = await call('POST', '/api/folders', { body: { name: 'ปี 2570', parent_id: projects.id } }); ok(r, 201);
const y2570 = r.data.folder;

step('ย้ายเอกสารไปโฟลเดอร์ใหม่');
r = await call('POST', `/api/documents/${doc.id}/move`, { body: { folder_id: y2570.id } });
ok(r);
assert.deepEqual(mock.files.get(doc.id).parents, [y2570.id]);

step('ย้ายโฟลเดอร์เข้าไปในลูกของตัวเอง = 400');
ok(await call('PATCH', `/api/folders/${projects.id}`, { body: { parent_id: y2570.id } }), 400);
step('เปลี่ยนชื่อโฟลเดอร์ / ย้ายโฟลเดอร์');
ok(await call('PATCH', `/api/folders/${y2570.id}`, { body: { name: 'ปีงบ 2570', parent_id: letters.id } }));
assert.equal(mock.files.get(y2570.id).name, 'ปีงบ 2570');
assert.deepEqual(mock.files.get(y2570.id).parents, [letters.id]);
step('ลบโฟลเดอร์ที่ยังมีเอกสาร = 409 / โฟลเดอร์หลัก = 400');
ok(await call('DELETE', `/api/folders/${y2570.id}`), 409);
ok(await call('DELETE', '/api/folders/ROOT'), 400);

step('อัปโหลดฉบับแก้ไขแทนไฟล์เดิม');
r = await call('POST', `/api/documents/${doc.id}/replace`, { form: uploadForm({}, 'new.pdf', new TextEncoder().encode('%PDF-1.4 v2')) });
ok(r);
assert.equal(new TextDecoder().decode(mock.files.get(doc.id).bytes), '%PDF-1.4 v2');

step('ประวัติของเอกสาร');
r = await call('GET', `/api/documents/${doc.id}/history`); ok(r);
assert.deepEqual(r.data.history.map((h) => h.action).sort(), ['อัปโหลดฉบับแก้ไข', 'อัปโหลดเอกสาร', 'แก้ไขรายละเอียด', 'ย้ายโฟลเดอร์'].sort());

// ---- ผู้ใช้ทั่วไป ----
step('แอดมินสร้างผู้ใช้ทั่วไป (ชื่อซ้ำ/รหัสสั้น = ปฏิเสธ)');
ok(await call('POST', '/api/users', { body: { username: 'somchai', display_name: 'สมชาย', role: 'user', password: 'short' } }), 400);
ok(await call('POST', '/api/users', { body: { username: 'somchai', display_name: 'สมชาย', role: 'user', password: 'Somchai#2570' } }), 201);
ok(await call('POST', '/api/users', { body: { username: 'SomChai', display_name: 'x', role: 'user', password: 'Somchai#2570' } }), 409);

const adminCookie = new Map(jar);
step('ผู้ใช้ทั่วไปล็อกอิน: อัปโหลดได้ แต่ทำงานผู้ดูแลไม่ได้');
jar.clear();
ok(await call('POST', '/api/login', { body: { username: 'somchai', password: 'Somchai#2570' } }));
ok(await call('GET', '/api/users'), 403);
ok(await call('PUT', '/api/settings', { body: { doc_types: ['x'] } }), 403);
ok(await call('DELETE', `/api/documents/${doc.id}`), 403);
ok(await call('PATCH', `/api/folders/${projects.id}`, { body: { name: 'x' } }), 403);
ok(await call('POST', '/api/admin/sync', { body: {} }), 403);
r = await call('POST', '/api/folders', { body: { name: 'โฟลเดอร์ของสมชาย', parent_id: 'ROOT' } }); ok(r, 201);
r = await call('POST', '/api/documents', { form: uploadForm({ ...goodMeta, title: 'ของสมชาย' }) }); ok(r, 201);
const somchaiDoc = r.data.document;
step('ผู้ใช้ทั่วไปแก้เอกสารของคนอื่นไม่ได้ แต่แก้ของตัวเองได้');
ok(await call('PATCH', `/api/documents/${doc.id}`, { body: { note: 'แก้ไม่ได้' } }), 403);
ok(await call('PATCH', `/api/documents/${somchaiDoc.id}`, { body: { note: 'แก้ได้' } }));
// เจ้าของเอกสารลบ/เปลี่ยนชื่อของตัวเองได้ แต่ลบของคนอื่นไม่ได้
r = await call('POST', '/api/documents', { form: uploadForm({ ...goodMeta, title: 'ไฟล์ที่สมชายจะลบเอง' }) }); ok(r, 201);
const mine = r.data.document;
ok(await call('PATCH', `/api/documents/${mine.id}`, { body: { title: 'ชื่อใหม่ของสมชาย' } }));
assert.equal(mock.files.get(mine.id).name, 'ชื่อใหม่ของสมชาย.pdf');
ok(await call('DELETE', `/api/documents/${mine.id}`));
assert.equal(mock.files.get(mine.id).trashed, true);
ok(await call('DELETE', `/api/documents/${doc.id}`), 403);
step('เปลี่ยนรหัสผ่านตนเอง');
ok(await call('POST', '/api/me/password', { body: { current: 'ผิด', next: 'NewPassw0rd!' } }), 400);
ok(await call('POST', '/api/me/password', { body: { current: 'Somchai#2570', next: 'NewPassw0rd!' } }));

step('CSRF: Origin ต่างโดเมน = 403');
ok(await call('POST', '/api/folders', { body: { name: 'x', parent_id: 'ROOT' }, headers: { origin: 'https://evil.example' } }), 403);

step('คุกกี้ปลอม/แก้ไข = 401');
const saved = new Map(jar);
jar.set('edms_session', jar.get('edms_session').slice(0, -3) + 'abc');
ok(await call('GET', '/api/bootstrap'), 401);

step('แอดมินปิดการใช้งานผู้ใช้ → ใช้งานต่อไม่ได้ + ล็อกอินไม่ได้');
jar.clear(); for (const [k, v] of adminCookie) jar.set(k, v);
ok(await call('PATCH', '/api/users/somchai', { body: { active: false } }));
jar.clear(); for (const [k, v] of saved) jar.set(k, v);
// worker แคชรายชื่อผู้ใช้ไว้ 30 วินาที แต่เขียนผ่าน isolate เดียวกันจึงล้างแคชแล้ว
ok(await call('GET', '/api/bootstrap'), 401);
ok(await call('POST', '/api/login', { body: { username: 'somchai', password: 'NewPassw0rd!' } }), 401);

step('กันแอดมินคนสุดท้ายปิดตัวเอง/ลดสิทธิ์ตัวเอง');
jar.clear(); for (const [k, v] of adminCookie) jar.set(k, v);
ok(await call('PATCH', '/api/users/admin', { body: { role: 'user' } }), 400);
ok(await call('PATCH', '/api/users/admin', { body: { active: false } }), 400);

step('ย้ายเอกสารไปถังขยะ (แอดมิน) → ไม่โผล่ในรายการ และอยู่ถังขยะใน Drive');
ok(await call('DELETE', `/api/documents/${somchaiDoc.id}`));
assert.equal(mock.files.get(somchaiDoc.id).trashed, true);
r = await call('GET', '/api/documents'); ok(r);
assert.ok(!r.data.documents.some((d) => d.id === somchaiDoc.id));
ok(await call('GET', `/api/documents/${somchaiDoc.id}`), 404);

step('ลบโฟลเดอร์ที่ว่าง = สำเร็จ');
r = await call('GET', '/api/folders'); ok(r);
const empty = r.data.folders.find((f) => f.name === 'โฟลเดอร์ของสมชาย');
ok(await call('DELETE', `/api/folders/${empty.id}`));
r = await call('GET', '/api/folders');
assert.ok(!r.data.folders.some((f) => f.id === empty.id));

step('ลบโฟลเดอร์ที่มีเอกสารและโฟลเดอร์ย่อย: ปกติ 409, ใส่ force = ลบทั้งหมดลงถังขยะ');
r = await call('POST', '/api/folders', { body: { name: 'โฟลเดอร์ที่จะลบทั้งชุด', parent_id: 'ROOT' } }); ok(r, 201);
const big = r.data.folder;
r = await call('POST', '/api/folders', { body: { name: 'ย่อย', parent_id: big.id } }); ok(r, 201);
const bigSub = r.data.folder;
r = await call('POST', '/api/documents', { form: uploadForm({ ...goodMeta, title: 'เอกสารในโฟลเดอร์ที่จะลบ', folder_id: bigSub.id }) }); ok(r, 201);
const inBig = r.data.document;
ok(await call('DELETE', `/api/folders/${big.id}`), 409);
ok(await call('DELETE', `/api/folders/${bigSub.id}`), 409);
r = await call('DELETE', `/api/folders/${big.id}?force=1`); ok(r);
assert.equal(r.data.folders_deleted, 2);
assert.equal(r.data.documents_deleted, 1);
assert.equal(mock.files.get(big.id).trashed, true);
r = await call('GET', '/api/folders');
assert.ok(!r.data.folders.some((f) => f.id === big.id || f.id === bigSub.id));
ok(await call('GET', `/api/documents/${inBig.id}`), 404);

step('ซิงก์จาก Drive: ไฟล์ที่เพิ่มใน Drive โดยตรงเข้ามาในระบบ');
mock.files.set('NEWPDF', { id: 'NEWPDF', name: 'ใบเสนอราคา.pdf', mimeType: 'application/pdf', parents: ['ROOT'], bytes: new ArrayBuffer(10), createdTime: '2026-11-16T01:00:00Z', modifiedTime: '2026-11-16T01:00:00Z', trashed: false });
r = await call('POST', '/api/admin/sync', { body: {} }); ok(r);
assert.equal(r.data.documents_added, 1);
r = await call('POST', '/api/admin/sync', { body: {} });
assert.equal(r.data.documents_added, 0);

step('ซิงก์สองทาง: แก้ในเว็บ → ชีตเปลี่ยนตาม');
const titleCol = 1; // คอลัมน์ "ชื่อเอกสาร" ในชีต
const sheetRow = (id) => mock.sheets.get(sheetId).tabs.get('เอกสาร').rows.find((x) => x[0] === id);
ok(await call('PATCH', `/api/documents/${doc.id}`, { body: { title: 'ชื่อใหม่จากเว็บ' } }));
assert.equal(sheetRow(doc.id)[titleCol], 'ชื่อใหม่จากเว็บ');

step('ซิงก์สองทาง: แก้ในชีต (AppSheet) → เว็บเห็นเมื่อซิงก์');
const v0 = (await call('GET', '/api/data-version')).data.data_version;
sheetRow(doc.id)[titleCol] = 'ชื่อที่แก้ใน AppSheet';
r = await call('POST', '/api/admin/sync-sheet', { body: {} });
ok(r);
assert.equal(r.data.inbound, 1);
assert.equal((await call('GET', `/api/documents/${doc.id}`)).data.document.title, 'ชื่อที่แก้ใน AppSheet');
assert.ok((await call('GET', '/api/data-version')).data.data_version > v0);
r = await call('POST', '/api/admin/sync-sheet', { body: {} });
assert.equal(r.data.inbound + r.data.outbound, 0, 'ซิงก์ซ้ำต้องไม่มีอะไรเปลี่ยน');

step('ซิงก์สองทาง: แก้พร้อมกันทั้งสองฝั่ง → เว็บชนะ และชีตถูกเขียนทับ');
await env.DB.prepare("UPDATE docs SET title = 'แก้ในเว็บ', _d = 1, _v = _v + 1 WHERE id = ?").bind(doc.id).run();
sheetRow(doc.id)[titleCol] = 'แก้ในชีตพร้อมกัน';
ok(await call('POST', '/api/admin/sync-sheet', { body: {} }));
assert.equal((await call('GET', `/api/documents/${doc.id}`)).data.document.title, 'แก้ในเว็บ');
assert.equal(sheetRow(doc.id)[titleCol], 'แก้ในเว็บ');

step('ซิงก์สองทาง: แถวใหม่ในชีต → เข้าเว็บ / ลบแถวในชีต → หายจากเว็บ / ช่องที่ขาดถูกเติมหัวตาราง');
const docsTab = mock.sheets.get(sheetId).tabs.get('เอกสาร');
const before = (await call('GET', '/api/documents')).data.documents.length;
const newRow = docsTab.rows[0].map(() => '');
newRow[0] = 'APPSHEET_ROW_1'; newRow[1] = 'เพิ่มจาก AppSheet'; newRow[6] = letters.id; newRow[17] = 'active'; newRow[15] = new Date().toISOString();
docsTab.rows.push(newRow);
ok(await call('POST', '/api/admin/sync-sheet', { body: {} }));
let list = (await call('GET', '/api/documents')).data.documents;
assert.equal(list.length, before + 1);
assert.ok(list.some((d) => d.id === 'APPSHEET_ROW_1' && d.title === 'เพิ่มจาก AppSheet'));
docsTab.rows.splice(docsTab.rows.findIndex((x) => x[0] === 'APPSHEET_ROW_1'), 1);
ok(await call('POST', '/api/admin/sync-sheet', { body: {} }));
list = (await call('GET', '/api/documents')).data.documents;
assert.equal(list.length, before);

step('ซิงก์สองทาง: แถวใหม่จากเว็บ (โฟลเดอร์/ประวัติ) ไปอยู่ในชีต');
assert.ok(mock.sheets.get(sheetId).tabs.get('ประวัติ').rows.length > 3);
assert.ok(mock.sheets.get(sheetId).tabs.get('โฟลเดอร์').rows.some((x) => x[1] === letters.name));

step('ย้ายมาใช้ D1: ฐานข้อมูลใหม่ว่างเปล่า → นำเข้าข้อมูลเดิมจากชีตอัตโนมัติ และเข้าสู่ระบบได้');
const env2 = { ...env, DB: createD1() };
const w2 = async (method, path, body, cookie) => worker.fetch(new Request(BASE + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }), env2, ctx);
const l2 = await w2('POST', '/api/login', { username: 'admin', password: 'Passw0rd!x' });
assert.equal(l2.status, 200);
const ck2 = l2.headers.getSetCookie()[0].split(';')[0];
const d2 = await (await w2('GET', '/api/documents', null, ck2)).json();
assert.equal(d2.documents.length, before);

step('ออกจากระบบ');
ok(await call('POST', '/api/logout', { body: {} }));
assert.equal(jar.has('edms_session'), false);
ok(await call('GET', '/api/bootstrap'), 401);

step('หน้าเว็บ (ไม่ใช่ /api) ส่งต่อไปที่ไฟล์ static');
{ const res = await worker.fetch(new Request(BASE + '/login.html'), env, ctx); assert.equal(await res.text(), 'static'); }

console.log(`\n✔ ผ่านทั้งหมด ${n} ขั้น, เรียก Google จำลอง ${mock.calls.length} ครั้ง`);
