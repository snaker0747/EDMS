// ชั้นข้อมูล: ใช้ Google Sheet เป็นฐานข้อมูล (AppSheet อ่านไฟล์เดียวกันนี้ได้)
import { HttpError, nowIso } from './util.js';
import * as G from './google.js';

export const SHEET_NAME = 'EDMS ข้อมูลระบบ';

// [คีย์ในโค้ด, หัวคอลัมน์ภาษาไทยในชีต]
export const SCHEMA = {
  docs: {
    title: 'เอกสาร',
    cols: [
      ['id', 'รหัสไฟล์ Drive'],
      ['title', 'ชื่อเอกสาร'],
      ['doc_no', 'เลขที่หนังสือ'],
      ['doc_date', 'ลงวันที่'],
      ['doc_type', 'ประเภทเอกสาร'],
      ['fiscal_year', 'ปีงบประมาณ'],
      ['folder_id', 'รหัสโฟลเดอร์'],
      ['tags', 'คำค้น'],
      ['note', 'รายละเอียด'],
      ['extra', 'ช่องเพิ่มเติม (JSON)'],
      ['file_name', 'ชื่อไฟล์'],
      ['mime', 'ชนิดไฟล์'],
      ['size', 'ขนาด (ไบต์)'],
      ['drive_url', 'ลิงก์ Google Drive'],
      ['uploader', 'ผู้อัปโหลด'],
      ['uploaded_at', 'วันที่อัปโหลด'],
      ['updated_at', 'แก้ไขล่าสุด'],
      ['status', 'สถานะ'],
    ],
  },
  folders: {
    title: 'โฟลเดอร์',
    cols: [
      ['id', 'รหัสโฟลเดอร์ Drive'],
      ['name', 'ชื่อโฟลเดอร์'],
      ['parent_id', 'อยู่ภายใต้ (รหัส)'],
      ['created_by', 'ผู้สร้าง'],
      ['created_at', 'วันที่สร้าง'],
      ['status', 'สถานะ'],
    ],
  },
  settings: {
    title: 'ตั้งค่า',
    cols: [
      ['key', 'หัวข้อ'],
      ['value', 'ค่า (JSON)'],
    ],
  },
  users: {
    title: 'ผู้ใช้',
    cols: [
      ['username', 'ชื่อผู้ใช้'],
      ['display_name', 'ชื่อที่แสดง'],
      ['role', 'สิทธิ์'],
      ['password_hash', 'รหัสผ่าน (เข้ารหัส)'],
      ['active', 'ใช้งาน'],
      ['created_at', 'วันที่สร้าง'],
    ],
  },
  history: {
    title: 'ประวัติ',
    cols: [
      ['time', 'เวลา'],
      ['user', 'ผู้ใช้'],
      ['action', 'การกระทำ'],
      ['target_id', 'รหัสอ้างอิง'],
      ['target_name', 'ชื่อรายการ'],
      ['detail', 'รายละเอียด'],
    ],
  },
};

export const DEFAULT_DOC_TYPES = ['หนังสือรับ', 'หนังสือส่ง', 'แบบแปลน', 'ประมาณราคา', 'สัญญา', 'รายงาน', 'เอกสารอื่นๆ'];
// ประเภทสำรองสำหรับเอกสารที่ไม่เข้าพวก: มีเสมอและอยู่ท้ายสุด
export const OTHER_DOC_TYPE = 'เอกสารอื่นๆ';

export function colLetter(n) {
  // n เริ่มที่ 1
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ---------- ฐานข้อมูล D1 (อ่านเขียนที่นี่ เร็ว) + ซิงก์ไป/กลับ Google Sheet (ดู sync.js) ----------
// คอลัมน์ _h = แฮชของแถวตอนซิงก์กับชีตครั้งล่าสุด, _d = 1 เมื่อแก้ในเว็บและยังไม่ได้ส่งไปชีต, _v = เลขเวอร์ชันของแถว
export const PK = { docs: 'id', folders: 'id', settings: 'key', users: 'username' };
export const SYNC_KEYS = ['docs', 'folders', 'settings', 'users'];
const q = (s) => `"${s}"`;

export function ddl() {
  const out = [];
  for (const [key, t] of Object.entries(SCHEMA)) {
    const cols = t.cols.map(([k]) => (PK[key] === k ? `${q(k)} TEXT PRIMARY KEY` : `${q(k)} TEXT NOT NULL DEFAULT ''`));
    const lead = key === 'history' ? ['_id INTEGER PRIMARY KEY AUTOINCREMENT'] : [];
    out.push(`CREATE TABLE IF NOT EXISTS ${q(key)} (${[...lead, ...cols, "_h TEXT NOT NULL DEFAULT ''", '_d INTEGER NOT NULL DEFAULT 0', '_v INTEGER NOT NULL DEFAULT 0'].join(', ')})`);
  }
  out.push('CREATE INDEX IF NOT EXISTS idx_docs_folder ON docs (folder_id)');
  out.push('CREATE INDEX IF NOT EXISTS idx_docs_status ON docs (status)');
  out.push('CREATE INDEX IF NOT EXISTS idx_history_target ON history (target_id)');
  out.push('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT \'\')');
  for (const [k, v] of [['data_version', '0'], ['lock_until', '0'], ['last_sync_at', '0'], ['sync_pending', '0']]) {
    out.push(`INSERT OR IGNORE INTO meta (k, v) VALUES ('${k}', '${v}')`);
  }
  return out;
}

// ---------- ตัวช่วยระดับคำขอ ----------
// c = { env, ctx, cache: Map, user, pending: [], dirty }
export function makeCtx(env, ctx) {
  return { env, ctx, cache: new Map(), user: null, pending: [], dirty: false };
}

export async function getMeta(c, k) {
  const r = await c.env.DB.prepare('SELECT v FROM meta WHERE k = ?').bind(k).first();
  return r ? r.v : null;
}
export const setMeta = (c, k, v) =>
  c.env.DB.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, String(v)).run();

let sheetIdCache = null;
export function resetCaches() {
  sheetIdCache = null;
}

export async function getSheetId(c, { create = false } = {}) {
  const { env } = c;
  if (env.SHEET_ID) return env.SHEET_ID;
  if (sheetIdCache) return sheetIdCache;
  const saved = await getMeta(c, 'sheet_id').catch(() => null);
  if (saved) {
    sheetIdCache = saved;
    return saved;
  }
  const q1 = `name='${SHEET_NAME}' and '${env.ROOT_FOLDER_ID}' in parents and mimeType='${G.SHEET_MIME}' and trashed=false`;
  const found = await G.driveList(env, q1);
  if (found.length) {
    sheetIdCache = found[0].id;
  } else {
    if (!create) throw new HttpError(503, 'ระบบยังไม่ได้ตั้งค่าเริ่มต้น (ผู้ดูแลต้องเรียก /api/setup ก่อน)');
    const created = await G.sheetsCreate(env, SHEET_NAME);
    // ย้ายชีตจากหน้าแรกของ Drive เข้าไปไว้ในโฟลเดอร์หลัก
    const cur = await G.driveGet(env, created.spreadsheetId, 'id,parents');
    await G.drivePatch(env, created.spreadsheetId, {}, { addParents: env.ROOT_FOLDER_ID, removeParents: (cur.parents || []).join(',') || undefined });
    sheetIdCache = created.spreadsheetId;
  }
  await setMeta(c, 'sheet_id', sheetIdCache).catch(() => {});
  return sheetIdCache;
}

// สร้างแท็บและหัวตารางที่ยังไม่มี
export async function ensureSchema(c, sheetId) {
  const meta = await G.sheetsMeta(c.env, sheetId);
  const existing = new Map(meta.sheets.map((s) => [s.properties.title, s.properties]));
  const adds = [];
  for (const t of Object.values(SCHEMA)) {
    if (!existing.has(t.title)) {
      adds.push({ addSheet: { properties: { title: t.title, gridProperties: { frozenRowCount: 1, columnCount: Math.max(t.cols.length, 6) } } } });
    }
  }
  if (adds.length) await G.sheetsBatch(c.env, sheetId, adds);
  for (const t of Object.values(SCHEMA)) {
    const head = await G.sheetsGet(c.env, sheetId, `'${t.title}'!1:1`);
    const row = head.values?.[0] || [];
    if (!row.length) {
      await G.sheetsUpdate(c.env, sheetId, `'${t.title}'!A1:${colLetter(t.cols.length)}1`, [t.cols.map((x) => x[1])]);
    } else {
      // เพิ่มหัวคอลัมน์ที่ขาดไว้ท้ายตาราง (กรณีอัปเดตระบบเพิ่มช่องใหม่)
      const missing = t.cols.filter((x) => !row.includes(x[1])).map((x) => x[1]);
      if (missing.length) {
        await G.sheetsUpdate(c.env, sheetId, `'${t.title}'!${colLetter(row.length + 1)}1:${colLetter(row.length + missing.length)}1`, [missing]);
      }
    }
  }
  // ลบแท็บ "Sheet1" เริ่มต้นถ้ามี
  const def = meta.sheets.find((s) => ['Sheet1', 'ชีต1'].includes(s.properties.title));
  if (def) {
    await G.sheetsBatch(c.env, sheetId, [{ deleteSheet: { sheetId: def.properties.sheetId } }]).catch(() => {});
  }
}

// ---------- อ่าน/เขียนตาราง (D1) ----------
const colsOf = (key) => SCHEMA[key].cols.map(([k]) => k);
const BUMP = "UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k = 'data_version'";

export async function listRows(c, key) {
  if (c.cache.has(key)) return c.cache.get(key);
  const { results } = await c.env.DB.prepare(`SELECT * FROM ${q(key)}${key === 'history' ? ' ORDER BY _id' : ''}`).all();
  c.cache.set(key, results);
  return results;
}

function insertStmt(c, key, obj, h = '', d = 1) {
  const cols = colsOf(key);
  return c.env.DB.prepare(`INSERT INTO ${q(key)} (${[...cols.map(q), '_h', '_d', '_v'].join(', ')}) VALUES (${[...cols.map(() => '?'), '?', '?', '?'].join(', ')})`).bind(
    ...cols.map((k) => String(obj[k] ?? '')),
    h,
    d,
    1
  );
}

export async function appendRow(c, key, obj) {
  const stmts = [insertStmt(c, key, obj, '', key === 'history' ? 0 : 1)];
  if (key !== 'history') stmts.push(c.env.DB.prepare(BUMP));
  await c.env.DB.batch(stmts);
  c.cache.delete(key);
  c.dirty = true;
  return obj;
}

// เพิ่มหลายแถวในคำขอเดียว (ใช้ตอนซิงก์จาก Drive)
export async function appendRows(c, key, objs) {
  if (!objs.length) return;
  for (let i = 0; i < objs.length; i += 40) {
    await c.env.DB.batch(objs.slice(i, i + 40).map((o) => insertStmt(c, key, o)));
  }
  await c.env.DB.prepare(BUMP).run();
  c.cache.delete(key);
  c.dirty = true;
}

export async function updateRow(c, key, row, patch) {
  const pk = PK[key];
  const keys = Object.keys(patch).filter((k) => colsOf(key).includes(k) && k !== pk);
  if (keys.length) {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE ${q(key)} SET ${keys.map((k) => `${q(k)} = ?`).join(', ')}, _d = 1, _v = _v + 1 WHERE ${q(pk)} = ?`).bind(...keys.map((k) => String(patch[k] ?? '')), row[pk]),
      c.env.DB.prepare(BUMP),
    ]);
  }
  c.cache.delete(key);
  c.dirty = true;
  return { ...row, ...patch };
}

// ---------- ผู้ใช้ ----------
export const getUsers = (c) => listRows(c, 'users');

export async function findUser(c, username) {
  const u = String(username || '').trim().toLowerCase();
  return (await getUsers(c)).find((r) => r.username.toLowerCase() === u) || null;
}

export const isActive = (u) => !['false', 'no', '0', 'ไม่'].includes(String(u.active).trim().toLowerCase());

// ---------- ตั้งค่า ----------
export async function getSettings(c) {
  const rows = await listRows(c, 'settings');
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const parse = (k, d) => {
    try {
      const v = JSON.parse(map[k]);
      return Array.isArray(v) ? v : d;
    } catch {
      return d;
    }
  };
  const types = parse('doc_types', DEFAULT_DOC_TYPES).filter((t) => t !== OTHER_DOC_TYPE);
  return { doc_types: [...types, OTHER_DOC_TYPE], fields: parse('fields', []) };
}

export async function saveSetting(c, key, value) {
  const rows = await listRows(c, 'settings');
  const found = rows.find((r) => r.key === key);
  const text = JSON.stringify(value);
  if (found) await updateRow(c, 'settings', found, { value: text });
  else await appendRow(c, 'settings', { key, value: text });
}

// ---------- โฟลเดอร์ ----------
export async function getFolders(c) {
  const rows = (await listRows(c, 'folders')).filter((r) => r.status !== 'deleted');
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pathOf = (f) => {
    const names = [];
    const seen = new Set();
    let cur = f;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      names.unshift(cur.name);
      cur = byId.get(cur.parent_id);
    }
    return names.join(' › ');
  };
  return rows.map((r) => ({ id: r.id, name: r.name, parent_id: r.parent_id, created_by: r.created_by, created_at: r.created_at, path: pathOf(r) }));
}

// ---------- ประวัติ ----------
export function logHistory(c, action, targetId, targetName, detail = '') {
  const p = appendRow(c, 'history', {
    time: nowIso(),
    user: c.user?.display_name || c.user?.username || 'ระบบ',
    action,
    target_id: targetId || '',
    target_name: targetName || '',
    detail,
  }).catch((e) => console.error('history failed', e));
  c.pending.push(p);
  c.ctx?.waitUntil?.(p);
  return p;
}
